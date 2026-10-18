// BPMN process API: draft XML, publish (compile to a Flow definition and publish it on the
// process's backing flow), runs, and the run monitor with per-element state. Same auth,
// permissions, project scoping, and audit log as flows.
import crypto from 'node:crypto';
import { z } from 'zod';
import { writeAudit } from '../db/audit.js';
import { AppError, validationError } from '../lib/errors.js';
import { sha256 } from '../lib/cryptoSecrets.js';
import { nextRun, parseCron } from '../scheduler/cron.js';
import { compileBpmn, elementStates, mapFlowIssues } from '../bpmn/compile.js';
import { blankProcessXml, purchaseRequestXml } from '../bpmn/templates.js';
import { validateDefinition } from '../flow/definition.js';
import { advanceRun, startRun } from '../flow/engine.js';
import { presentNode, presentRun } from './flowRoutes.js';

const parse = (value) => (typeof value === 'string' ? JSON.parse(value) : value);
const sqlDate = (date) => new Date(date).toISOString().slice(0, 23).replace('T', ' ');
const XML_LIMIT = 900000;

export function presentProcess(row, extra = {}) {
  return {
    id: row.id, projectId: row.project_id, projectName: row.project_name || undefined, name: row.name, description: row.description || '',
    status: row.status, flowId: row.flow_id, currentVersionId: row.current_version_id, versionNumber: row.version_number ?? undefined,
    triggerType: row.trigger_type || 'manual', scheduleCron: row.schedule_cron || null, nextRunAt: row.next_run_at || null, hasWebhook: Boolean(row.webhook_token_hash),
    createdBy: row.created_by, createdAt: row.created_at, updatedAt: row.updated_at,
    lastRun: row.last_run_id ? { id: row.last_run_id, status: row.last_run_status, startedAt: row.last_run_started_at } : null,
    runCount: row.run_count === undefined ? undefined : Number(row.run_count || 0),
    ...extra,
  };
}

/** Compile + structural/lookup validation, with every issue pointing at a BPMN element. */
export function validateProcessXml(xml, lookups = null) {
  const compiled = compileBpmn(xml);
  // Flow rules (reachability, branches, lookups) run once the BPMN itself compiles cleanly, so one
  // unsupported element does not also produce a cascade of follow-on problems.
  const flow = compiled.definition && !compiled.errors.length ? validateDefinition(compiled.definition, lookups) : { errors: [], warnings: [] };
  const seen = new Set();
  const unique = (items) => items.filter((item) => { const key = `${item.elementId || ''}|${item.message}`; if (seen.has(key)) return false; seen.add(key); return true; });
  // Compile errors explain BPMN problems better than the generic flow checks for the same element.
  const compileIds = new Set(compiled.errors.map((item) => item.elementId).filter(Boolean));
  const flowErrors = mapFlowIssues(flow.errors, compiled.definition).filter((item) => !item.elementId || !compileIds.has(item.elementId));
  return {
    compiled,
    errors: unique([...compiled.errors, ...flowErrors]),
    warnings: unique([...compiled.warnings, ...mapFlowIssues(flow.warnings, compiled.definition)]),
  };
}

export function registerBpmnRoutes(app, { pool, cfg, wrap, paging, requireUser, requirePermission, loadProject, scope, scopeSql, like }) {
  const SELECT = `SELECT b.*, p.name AS project_name, v.version_number, f.trigger_type, f.schedule_cron, f.next_run_at, f.webhook_token_hash,
      r.id AS last_run_id, r.status AS last_run_status, r.started_at AS last_run_started_at,
      (SELECT COUNT(*) FROM flow_runs rc WHERE rc.flow_id = b.flow_id) AS run_count
    FROM bpmn_processes b
    JOIN projects p ON p.id = b.project_id
    LEFT JOIN bpmn_process_versions v ON v.id = b.current_version_id
    LEFT JOIN flows f ON f.id = b.flow_id
    LEFT JOIN flow_runs r ON r.id = (SELECT r2.id FROM flow_runs r2 WHERE r2.flow_id = b.flow_id ORDER BY r2.created_at DESC LIMIT 1)`;

  async function loadProcess(user, id, writable = false) {
    const [rows] = await pool.query(`${SELECT} WHERE b.id = ? AND b.tenant_id = ?`, [id, user.tenant_id]);
    if (!rows[0]) throw new AppError(404, 'NOT_FOUND', 'Process not found');
    await loadProject(user, rows[0].project_id, writable);
    return rows[0];
  }

  async function lookups(projectId, tenantId) {
    const [workflows] = await pool.query(`SELECT id, name, status, current_version_id FROM workflows WHERE project_id = ?`, [projectId]);
    const [connections] = await pool.query(`SELECT id, connector_type FROM connections WHERE project_id = ?`, [projectId]);
    const [users] = await pool.query(`SELECT id FROM users WHERE tenant_id = ? AND status = 'active'`, [tenantId]);
    const [agents] = await pool.query(`SELECT id, name, status, current_version_id FROM agents WHERE project_id = ?`, [projectId]);
    const [caseTypes] = await pool.query(`SELECT id, name, status, current_version_id FROM case_types WHERE project_id = ?`, [projectId]);
    return {
      workflows: new Map(workflows.map((row) => [row.id, row])),
      connections: new Map(connections.map((row) => [row.id, row])),
      users: new Set(users.map((row) => row.id)),
      agents: new Map(agents.map((row) => [row.id, row])),
      caseTypes: new Map(caseTypes.map((row) => [row.id, row])),
    };
  }

  const audit = (req, row, action, metadata) => writeAudit(pool, { tenantId: req.user.tenant_id, userId: req.user.id, action, entityType: 'bpmn_process', entityId: row.id, projectId: row.project_id, ip: req.ip, metadata });

  app.get('/api/bpmn', requireUser, wrap(async (req, res) => {
    const { limit, offset } = paging(req.query);
    const range = await scope(req.user);
    const visible = scopeSql(range, 'b.project_id');
    const where = ['b.tenant_id = ?', visible.sql];
    const params = [req.user.tenant_id, ...visible.params];
    if (req.query.projectId) { where.push('b.project_id = ?'); params.push(String(req.query.projectId)); }
    if (req.query.status) { where.push('b.status = ?'); params.push(String(req.query.status)); }
    if (req.query.search) { where.push(`b.name LIKE ? ESCAPE '\\\\'`); params.push(like(req.query.search)); }
    const [[count]] = await pool.query(`SELECT COUNT(*) AS total FROM bpmn_processes b WHERE ${where.join(' AND ')}`, params);
    const [rows] = await pool.query(`${SELECT} WHERE ${where.join(' AND ')} ORDER BY b.updated_at DESC LIMIT ${limit} OFFSET ${offset}`, params);
    res.json({ data: rows.map((row) => presentProcess(row)), meta: { limit, offset, total: Number(count.total) } });
  }));

  app.post('/api/bpmn', requireUser, requirePermission('workflows.write'), wrap(async (req, res) => {
    const body = z.object({
      projectId: z.string().uuid(),
      name: z.string().trim().min(1).max(200),
      description: z.string().max(4000).optional().default(''),
      template: z.enum(['blank', 'purchase']).optional().default('blank'),
      xml: z.string().max(XML_LIMIT).optional(),
      workflowId: z.string().uuid().optional(),
    }).safeParse(req.body || {});
    if (!body.success) throw validationError(body.error.issues);
    const project = await loadProject(req.user, body.data.projectId, true);
    let xml = body.data.xml;
    if (xml) {
      const compiled = compileBpmn(xml);
      if (!compiled.definition && compiled.errors.length) throw new AppError(400, 'VALIDATION', compiled.errors[0].message, compiled.errors);
    } else xml = body.data.template === 'purchase' ? purchaseRequestXml({ name: body.data.name, workflowId: body.data.workflowId || '' }) : blankProcessXml(body.data.name);
    const id = crypto.randomUUID();
    await pool.query(
      `INSERT INTO bpmn_processes (id, tenant_id, project_id, name, description, status, draft_xml, created_by, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, 'draft', ?, ?, UTC_TIMESTAMP(3), UTC_TIMESTAMP(3))`,
      [id, project.tenant_id, project.id, body.data.name, body.data.description, xml, req.user.id],
    );
    await writeAudit(pool, { tenantId: req.user.tenant_id, userId: req.user.id, action: 'bpmn.create', entityType: 'bpmn_process', entityId: id, projectId: project.id, ip: req.ip, metadata: { template: body.data.xml ? 'import' : body.data.template } });
    res.status(201).json({ data: presentProcess(await loadProcess(req.user, id)) });
  }));

  app.get('/api/bpmn/:id', requireUser, wrap(async (req, res) => {
    const row = await loadProcess(req.user, req.params.id);
    const [versions] = await pool.query(`SELECT id, version_number, published_by, published_at FROM bpmn_process_versions WHERE process_id = ? ORDER BY version_number DESC`, [row.id]);
    const { errors, warnings, compiled } = validateProcessXml(row.draft_xml, await lookups(row.project_id, row.tenant_id));
    res.json({
      data: presentProcess(row, {
        xml: row.draft_xml,
        validation: { errors, warnings },
        trigger: compiled.trigger,
        webhookUrl: row.flow_id ? `/api/hooks/flows/${row.flow_id}` : null,
        versions: versions.map((item) => ({ id: item.id, versionNumber: item.version_number, publishedBy: item.published_by, publishedAt: item.published_at })),
      }),
    });
  }));

  app.patch('/api/bpmn/:id', requireUser, requirePermission('workflows.write'), wrap(async (req, res) => {
    const row = await loadProcess(req.user, req.params.id, true);
    const body = z.object({ name: z.string().trim().min(1).max(200).optional(), description: z.string().max(4000).optional() }).strict().safeParse(req.body || {});
    if (!body.success) throw validationError(body.error.issues);
    await pool.query(`UPDATE bpmn_processes SET name = ?, description = ?, updated_at = UTC_TIMESTAMP(3) WHERE id = ?`, [body.data.name ?? row.name, body.data.description ?? row.description, row.id]);
    if (row.flow_id && body.data.name) await pool.query(`UPDATE flows SET name = ? WHERE id = ?`, [`${body.data.name} (BPMN)`, row.flow_id]);
    await audit(req, row, 'bpmn.update');
    res.json({ data: presentProcess(await loadProcess(req.user, row.id)) });
  }));

  app.put('/api/bpmn/:id/draft', requireUser, requirePermission('workflows.write'), wrap(async (req, res) => {
    const row = await loadProcess(req.user, req.params.id, true);
    const body = z.object({ xml: z.string().min(1).max(XML_LIMIT) }).safeParse(req.body || {});
    if (!body.success) throw validationError(body.error.issues);
    const { errors, warnings, compiled } = validateProcessXml(body.data.xml, await lookups(row.project_id, row.tenant_id));
    if (!compiled.definition && errors.length) throw new AppError(400, 'VALIDATION', errors[0].message, errors);
    await pool.query(`UPDATE bpmn_processes SET draft_xml = ?, updated_at = UTC_TIMESTAMP(3) WHERE id = ?`, [body.data.xml, row.id]);
    await audit(req, row, 'bpmn.save_draft', { elements: compiled.elements.length });
    res.json({ data: presentProcess(await loadProcess(req.user, row.id), { validation: { errors, warnings }, trigger: compiled.trigger }) });
  }));

  app.post('/api/bpmn/:id/publish', requireUser, requirePermission('workflows.publish'), wrap(async (req, res) => {
    const row = await loadProcess(req.user, req.params.id, true);
    const { errors, warnings, compiled } = validateProcessXml(row.draft_xml, await lookups(row.project_id, row.tenant_id));
    if (errors.length) throw new AppError(400, 'VALIDATION', 'Fix the process before publishing', errors);
    const definition = compiled.definition;
    const start = definition.nodes.find((node) => node.type === 'start');
    const trigger = start.config?.trigger || 'manual';
    let nextRunAt = null;
    if (trigger === 'schedule') {
      try {
        parseCron(start.config.cron);
        nextRunAt = sqlDate(nextRun(start.config.cron, new Date(), start.config.timezone || 'UTC'));
      } catch (error) {
        throw new AppError(400, 'VALIDATION', 'Fix the process before publishing', [{ elementId: start.config.bpmnId, message: `Invalid timer cycle: ${error.message}` }]);
      }
    }
    let flowId = row.flow_id;
    if (!flowId) {
      flowId = crypto.randomUUID();
      await pool.query(
        `INSERT INTO flows (id, tenant_id, project_id, name, description, status, draft_json, bpmn_process_id, created_by, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, 'draft', ?, ?, ?, UTC_TIMESTAMP(3), UTC_TIMESTAMP(3))`,
        [flowId, row.tenant_id, row.project_id, `${row.name} (BPMN)`, 'Runs the BPMN process of the same name. Edit it in Studio → Processes.', JSON.stringify(definition), row.id, req.user.id],
      );
      await pool.query(`UPDATE bpmn_processes SET flow_id = ? WHERE id = ?`, [flowId, row.id]);
    }
    const [flows] = await pool.query(`SELECT webhook_token_hash FROM flows WHERE id = ?`, [flowId]);
    let webhookToken = null;
    if (trigger === 'webhook' && !flows[0]?.webhook_token_hash) webhookToken = crypto.randomBytes(24).toString('hex');
    const [[maxFlow]] = await pool.query(`SELECT COALESCE(MAX(version_number), 0) AS n FROM flow_versions WHERE flow_id = ?`, [flowId]);
    const flowVersionId = crypto.randomUUID();
    await pool.query(
      `INSERT INTO flow_versions (id, flow_id, version_number, definition_json, published_by, published_at) VALUES (?, ?, ?, ?, ?, UTC_TIMESTAMP(3))`,
      [flowVersionId, flowId, Number(maxFlow.n) + 1, JSON.stringify(definition), req.user.id],
    );
    await pool.query(
      `UPDATE flows SET status = 'published', draft_json = ?, current_version_id = ?, trigger_type = ?, schedule_cron = ?, schedule_timezone = ?, next_run_at = ?,
         webhook_token_hash = COALESCE(?, webhook_token_hash), updated_at = UTC_TIMESTAMP(3) WHERE id = ?`,
      [JSON.stringify(definition), flowVersionId, trigger, trigger === 'schedule' ? start.config.cron : null, trigger === 'schedule' ? (start.config.timezone || 'UTC') : null, nextRunAt, webhookToken ? sha256(webhookToken) : null, flowId],
    );
    const [[max]] = await pool.query(`SELECT COALESCE(MAX(version_number), 0) AS n FROM bpmn_process_versions WHERE process_id = ?`, [row.id]);
    const versionId = crypto.randomUUID();
    const versionNumber = Number(max.n) + 1;
    await pool.query(
      `INSERT INTO bpmn_process_versions (id, process_id, version_number, xml, definition_json, flow_version_id, published_by, published_at) VALUES (?, ?, ?, ?, ?, ?, ?, UTC_TIMESTAMP(3))`,
      [versionId, row.id, versionNumber, row.draft_xml, JSON.stringify(definition), flowVersionId, req.user.id],
    );
    await pool.query(`UPDATE bpmn_processes SET status = 'published', current_version_id = ?, updated_at = UTC_TIMESTAMP(3) WHERE id = ?`, [versionId, row.id]);
    await audit(req, row, 'bpmn.publish', { version: versionNumber, trigger, steps: definition.nodes.length });
    res.json({ data: presentProcess(await loadProcess(req.user, row.id), { validation: { errors, warnings }, trigger: compiled.trigger, webhookUrl: `/api/hooks/flows/${flowId}`, ...(webhookToken ? { webhookToken } : {}) }) });
  }));

  for (const [verb, status] of [['disable', 'disabled'], ['enable', 'published']]) {
    app.post(`/api/bpmn/:id/${verb}`, requireUser, requirePermission('workflows.publish'), wrap(async (req, res) => {
      const row = await loadProcess(req.user, req.params.id, true);
      if (status === 'published' && !row.current_version_id) throw new AppError(409, 'INVALID_STATE', 'Publish the process before enabling it');
      await pool.query(`UPDATE bpmn_processes SET status = ?, updated_at = UTC_TIMESTAMP(3) WHERE id = ?`, [status, row.id]);
      if (row.flow_id) await pool.query(`UPDATE flows SET status = ?, updated_at = UTC_TIMESTAMP(3) WHERE id = ?`, [status, row.flow_id]);
      await audit(req, row, `bpmn.${verb}`);
      res.json({ data: presentProcess(await loadProcess(req.user, row.id)) });
    }));
  }

  app.post('/api/bpmn/:id/webhook-token', requireUser, requirePermission('workflows.publish'), wrap(async (req, res) => {
    const row = await loadProcess(req.user, req.params.id, true);
    if (!row.flow_id) throw new AppError(409, 'INVALID_STATE', 'Publish the process with a message start event first');
    const token = crypto.randomBytes(24).toString('hex');
    await pool.query(`UPDATE flows SET webhook_token_hash = ?, updated_at = UTC_TIMESTAMP(3) WHERE id = ?`, [sha256(token), row.flow_id]);
    await audit(req, row, 'bpmn.webhook_rotate');
    res.json({ data: { webhookToken: token, url: `/api/hooks/flows/${row.flow_id}` } });
  }));

  app.post('/api/bpmn/:id/run', requireUser, requirePermission('jobs.run'), wrap(async (req, res) => {
    const row = await loadProcess(req.user, req.params.id);
    if (row.status !== 'published' || !row.flow_id) throw new AppError(409, 'PROCESS_NOT_PUBLISHED', row.status === 'disabled' ? 'The process is disabled' : 'Publish the process before running it');
    const [flows] = await pool.query(`SELECT * FROM flows WHERE id = ?`, [row.flow_id]);
    const input = req.body?.input && typeof req.body.input === 'object' && !Array.isArray(req.body.input) ? req.body.input : {};
    const run = await startRun(pool, cfg, { flow: flows[0], user: req.user, input, triggerSource: 'manual' });
    await audit(req, row, 'bpmn.run', { runId: run.id });
    res.status(202).json({ data: presentRun(run) });
  }));

  app.get('/api/bpmn/:id/runs', requireUser, wrap(async (req, res) => {
    const row = await loadProcess(req.user, req.params.id);
    const { limit, offset } = paging(req.query);
    if (!row.flow_id) { res.json({ data: [], meta: { limit, offset, total: 0 } }); return; }
    const [[count]] = await pool.query(`SELECT COUNT(*) AS total FROM flow_runs WHERE flow_id = ?`, [row.flow_id]);
    const [rows] = await pool.query(
      `SELECT r.*, v.version_number, bv.version_number AS process_version FROM flow_runs r JOIN flow_versions v ON v.id = r.flow_version_id
       LEFT JOIN bpmn_process_versions bv ON bv.flow_version_id = r.flow_version_id WHERE r.flow_id = ? ORDER BY r.created_at DESC LIMIT ${limit} OFFSET ${offset}`,
      [row.flow_id],
    );
    res.json({ data: rows.map((item) => ({ ...presentRun(item), versionNumber: item.process_version ?? item.version_number })), meta: { limit, offset, total: Number(count.total) } });
  }));

  // Run monitor: the run, the BPMN XML of the version it runs, and the state of every element.
  app.get('/api/bpmn-runs/:runId', requireUser, wrap(async (req, res) => {
    const load = async () => {
      const [rows] = await pool.query(
        `SELECT r.*, b.id AS process_id, b.name AS process_name, bv.xml, bv.version_number AS process_version, bv.definition_json
         FROM flow_runs r JOIN flows f ON f.id = r.flow_id JOIN bpmn_processes b ON b.id = f.bpmn_process_id
         JOIN bpmn_process_versions bv ON bv.flow_version_id = r.flow_version_id
         WHERE r.id = ? AND r.tenant_id = ?`,
        [req.params.runId, req.user.tenant_id],
      );
      if (!rows[0]) throw new AppError(404, 'NOT_FOUND', 'Process run not found');
      await loadProject(req.user, rows[0].project_id);
      return rows[0];
    };
    let run = await load();
    if (run.status === 'RUNNING') {
      await advanceRun(pool, cfg, run.id).catch(() => {});
      run = await load();
    }
    const definition = parse(run.definition_json);
    const [nodes] = await pool.query(`SELECT * FROM flow_run_nodes WHERE run_id = ? ORDER BY started_at, id`, [run.id]);
    const [events] = await pool.query(`SELECT * FROM flow_run_events WHERE run_id = ? ORDER BY seq`, [run.id]);
    const presentedNodes = nodes.map(presentNode);
    res.json({
      data: {
        ...presentRun(run),
        processId: run.process_id, processName: run.process_name, versionNumber: run.process_version,
        xml: run.xml, definition, nodes: presentedNodes,
        states: elementStates(definition, presentedNodes).elements,
        events: events.map((item) => ({ id: item.id, nodeId: item.node_id, elementId: definition.nodes.find((n) => n.id === item.node_id)?.config?.bpmnId || item.node_id, event: item.event, message: item.message, data: parse(item.data_json), createdAt: item.created_at })),
      },
    });
  }));
}
