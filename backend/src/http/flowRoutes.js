// Flow API: CRUD for flows (draft + published versions), runs, cancel/retry, and webhook start.
// Uses the same auth, permissions, project scoping, and audit log as workflows and jobs.
import crypto from 'node:crypto';
import { z } from 'zod';
import { writeAudit } from '../db/audit.js';
import { AppError, validationError } from '../lib/errors.js';
import { sha256 } from '../lib/cryptoSecrets.js';
import { nextRun, parseCron } from '../scheduler/cron.js';
import { apiOrchestrationDefinition, emptyDefinition, validateDefinition } from '../flow/definition.js';
import { advanceRun, cancelRun, retryRun, startRun } from '../flow/engine.js';

const parse = (value) => (typeof value === 'string' ? JSON.parse(value) : value);
const sqlDate = (date) => new Date(date).toISOString().slice(0, 23).replace('T', ' ');

const nodeSchema = z.object({
  id: z.string().regex(/^[A-Za-z0-9_-]{1,80}$/),
  type: z.string().max(20),
  name: z.string().max(120).optional().default(''),
  x: z.number().finite().optional().default(0),
  y: z.number().finite().optional().default(0),
  config: z.record(z.any()).optional().default({}),
});
const edgeSchema = z.object({
  id: z.string().regex(/^[A-Za-z0-9_-]{1,80}$/),
  from: z.string().max(80),
  to: z.string().max(80),
  label: z.string().max(80).optional(),
  isDefault: z.boolean().optional(),
  condition: z.object({ left: z.string().max(300), op: z.string().max(20), right: z.any().optional() }).nullable().optional(),
});
const definitionSchema = z.object({
  nodes: z.array(nodeSchema).max(200),
  edges: z.array(edgeSchema).max(400),
  variables: z.array(z.object({ name: z.string().max(63), defaultValue: z.any().optional() })).max(100).optional().default([]),
});

export function presentFlow(row, extra = {}) {
  return {
    id: row.id,
    projectId: row.project_id,
    projectName: row.project_name || undefined,
    name: row.name,
    description: row.description || '',
    status: row.status,
    triggerType: row.trigger_type,
    scheduleCron: row.schedule_cron,
    nextRunAt: row.next_run_at,
    hasWebhook: Boolean(row.webhook_token_hash),
    currentVersionId: row.current_version_id,
    versionNumber: row.version_number ?? undefined,
    definition: parse(row.draft_json),
    createdBy: row.created_by,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    lastRun: row.last_run_id ? { id: row.last_run_id, status: row.last_run_status, startedAt: row.last_run_started_at } : null,
    ...extra,
  };
}

export function presentRun(row) {
  return {
    id: row.id,
    flowId: row.flow_id,
    flowName: row.flow_name || undefined,
    projectId: row.project_id,
    versionId: row.flow_version_id,
    versionNumber: row.version_number ?? undefined,
    status: row.status,
    triggerSource: row.trigger_source,
    input: parse(row.input_json) || {},
    variables: parse(row.variables_json) || {},
    error: row.error_summary,
    startedBy: row.started_by,
    startedAt: row.started_at,
    finishedAt: row.finished_at,
    updatedAt: row.updated_at,
  };
}

export function presentNode(row) {
  return {
    id: row.id, nodeId: row.node_id, type: row.node_type, status: row.status, attempt: row.attempt, arrivals: row.arrivals,
    jobId: row.job_id, taskId: row.task_id, agentRunId: row.agent_run_id || null, wakeAt: row.wake_at, input: parse(row.input_json), output: parse(row.output_json),
    error: row.error_message, startedAt: row.started_at, finishedAt: row.finished_at, updatedAt: row.updated_at,
  };
}

export function registerFlowRoutes(app, { pool, cfg, wrap, paging, requireUser, requirePermission, loadProject, scope, scopeSql, like }) {
  const FLOW_SELECT = `SELECT f.*, p.name AS project_name, v.version_number,
      r.id AS last_run_id, r.status AS last_run_status, r.started_at AS last_run_started_at
    FROM flows f
    JOIN projects p ON p.id = f.project_id
    LEFT JOIN flow_versions v ON v.id = f.current_version_id
    LEFT JOIN flow_runs r ON r.id = (SELECT r2.id FROM flow_runs r2 WHERE r2.flow_id = f.id ORDER BY r2.created_at DESC LIMIT 1)`;

  async function loadFlow(user, id, writable = false) {
    const [rows] = await pool.query(`${FLOW_SELECT} WHERE f.id = ? AND f.tenant_id = ?`, [id, user.tenant_id]);
    if (!rows[0]) throw new AppError(404, 'NOT_FOUND', 'Flow not found');
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
      caseTypes: new Map(caseTypes.map((row) => [row.id, row])),
      agents: new Map(agents.map((row) => [row.id, row])),
      workflows: new Map(workflows.map((row) => [row.id, row])),
      connections: new Map(connections.map((row) => [row.id, row])),
      users: new Set(users.map((row) => row.id)),
    };
  }

  app.get('/api/flows', requireUser, wrap(async (req, res) => {
    const { limit, offset } = paging(req.query);
    const range = await scope(req.user);
    const visible = scopeSql(range, 'f.project_id');
    const where = ['f.tenant_id = ?', visible.sql];
    const params = [req.user.tenant_id, ...visible.params];
    // Flows that run a BPMN process are managed from Studio → Processes.
    if (req.query.includeProcesses !== '1') where.push('f.bpmn_process_id IS NULL');
    if (req.query.projectId) { where.push('f.project_id = ?'); params.push(String(req.query.projectId)); }
    if (req.query.status) { where.push('f.status = ?'); params.push(String(req.query.status)); }
    if (req.query.search) { where.push(`f.name LIKE ? ESCAPE '\\\\'`); params.push(like(req.query.search)); }
    const [[count]] = await pool.query(`SELECT COUNT(*) AS total FROM flows f WHERE ${where.join(' AND ')}`, params);
    const [rows] = await pool.query(`${FLOW_SELECT} WHERE ${where.join(' AND ')} ORDER BY f.updated_at DESC LIMIT ${limit} OFFSET ${offset}`, params);
    res.json({ data: rows.map((row) => presentFlow(row)), meta: { limit, offset, total: Number(count.total) } });
  }));

  app.post('/api/flows', requireUser, requirePermission('workflows.write'), wrap(async (req, res) => {
    const body = z.object({
      projectId: z.string().uuid(),
      name: z.string().trim().min(1).max(200),
      description: z.string().max(4000).optional().default(''),
      template: z.enum(['blank', 'api']).optional().default('blank'),
    }).safeParse(req.body || {});
    if (!body.success) throw validationError(body.error.issues);
    const project = await loadProject(req.user, body.data.projectId, true);
    const id = crypto.randomUUID();
    const definition = body.data.template === 'api' ? apiOrchestrationDefinition() : emptyDefinition();
    await pool.query(
      `INSERT INTO flows (id, tenant_id, project_id, name, description, status, draft_json, created_by, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, 'draft', ?, ?, UTC_TIMESTAMP(3), UTC_TIMESTAMP(3))`,
      [id, project.tenant_id, project.id, body.data.name, body.data.description, JSON.stringify(definition), req.user.id],
    );
    await writeAudit(pool, { tenantId: req.user.tenant_id, userId: req.user.id, action: 'flow.create', entityType: 'flow', entityId: id, projectId: project.id, ip: req.ip, metadata: { template: body.data.template } });
    res.status(201).json({ data: presentFlow(await loadFlow(req.user, id)) });
  }));

  app.get('/api/flows/:id', requireUser, wrap(async (req, res) => {
    const flow = await loadFlow(req.user, req.params.id);
    const [versions] = await pool.query(`SELECT id, version_number, published_by, published_at FROM flow_versions WHERE flow_id = ? ORDER BY version_number DESC`, [flow.id]);
    const validation = validateDefinition(parse(flow.draft_json), await lookups(flow.project_id, flow.tenant_id));
    res.json({ data: presentFlow(flow, { versions: versions.map((row) => ({ id: row.id, versionNumber: row.version_number, publishedBy: row.published_by, publishedAt: row.published_at })), validation }) });
  }));

  app.patch('/api/flows/:id', requireUser, requirePermission('workflows.write'), wrap(async (req, res) => {
    const flow = await loadFlow(req.user, req.params.id, true);
    const body = z.object({ name: z.string().trim().min(1).max(200).optional(), description: z.string().max(4000).optional() }).strict().safeParse(req.body || {});
    if (!body.success) throw validationError(body.error.issues);
    await pool.query(`UPDATE flows SET name = ?, description = ?, updated_at = UTC_TIMESTAMP(3) WHERE id = ?`, [body.data.name ?? flow.name, body.data.description ?? flow.description, flow.id]);
    await writeAudit(pool, { tenantId: req.user.tenant_id, userId: req.user.id, action: 'flow.update', entityType: 'flow', entityId: flow.id, projectId: flow.project_id, ip: req.ip });
    res.json({ data: presentFlow(await loadFlow(req.user, flow.id)) });
  }));

  app.put('/api/flows/:id/draft', requireUser, requirePermission('workflows.write'), wrap(async (req, res) => {
    const flow = await loadFlow(req.user, req.params.id, true);
    const body = z.object({ definition: definitionSchema }).safeParse(req.body || {});
    if (!body.success) throw validationError(body.error.issues);
    await pool.query(`UPDATE flows SET draft_json = ?, updated_at = UTC_TIMESTAMP(3) WHERE id = ?`, [JSON.stringify(body.data.definition), flow.id]);
    await writeAudit(pool, { tenantId: req.user.tenant_id, userId: req.user.id, action: 'flow.save_draft', entityType: 'flow', entityId: flow.id, projectId: flow.project_id, ip: req.ip, metadata: { nodes: body.data.definition.nodes.length } });
    const validation = validateDefinition(body.data.definition, await lookups(flow.project_id, flow.tenant_id));
    res.json({ data: presentFlow(await loadFlow(req.user, flow.id), { validation }) });
  }));

  app.post('/api/flows/:id/publish', requireUser, requirePermission('workflows.publish'), wrap(async (req, res) => {
    const flow = await loadFlow(req.user, req.params.id, true);
    const definition = parse(flow.draft_json);
    const validation = validateDefinition(definition, await lookups(flow.project_id, flow.tenant_id));
    if (validation.errors.length) throw new AppError(400, 'VALIDATION', 'Fix the flow before publishing', validation.errors);
    const start = definition.nodes.find((node) => node.type === 'start');
    const trigger = start.config?.trigger || 'manual';
    let nextRunAt = null;
    if (trigger === 'schedule') {
      try {
        parseCron(start.config.cron);
        nextRunAt = sqlDate(nextRun(start.config.cron, new Date(), start.config.timezone || 'UTC'));
      } catch (error) {
        throw new AppError(400, 'VALIDATION', 'Fix the flow before publishing', [{ nodeId: start.id, message: `Invalid cron expression: ${error.message}` }]);
      }
    }
    let webhookToken = null;
    if (trigger === 'webhook' && !flow.webhook_token_hash) webhookToken = crypto.randomBytes(24).toString('hex');
    const [[max]] = await pool.query(`SELECT COALESCE(MAX(version_number), 0) AS n FROM flow_versions WHERE flow_id = ?`, [flow.id]);
    const versionId = crypto.randomUUID();
    const versionNumber = Number(max.n) + 1;
    await pool.query(
      `INSERT INTO flow_versions (id, flow_id, version_number, definition_json, published_by, published_at) VALUES (?, ?, ?, ?, ?, UTC_TIMESTAMP(3))`,
      [versionId, flow.id, versionNumber, JSON.stringify(definition), req.user.id],
    );
    await pool.query(
      `UPDATE flows SET status = 'published', current_version_id = ?, trigger_type = ?, schedule_cron = ?, schedule_timezone = ?, next_run_at = ?,
         webhook_token_hash = COALESCE(?, webhook_token_hash), updated_at = UTC_TIMESTAMP(3) WHERE id = ?`,
      [versionId, trigger, trigger === 'schedule' ? start.config.cron : null, trigger === 'schedule' ? (start.config.timezone || 'UTC') : null, nextRunAt, webhookToken ? sha256(webhookToken) : null, flow.id],
    );
    await writeAudit(pool, { tenantId: req.user.tenant_id, userId: req.user.id, action: 'flow.publish', entityType: 'flow', entityId: flow.id, projectId: flow.project_id, ip: req.ip, metadata: { version: versionNumber, trigger } });
    res.json({ data: presentFlow(await loadFlow(req.user, flow.id), { validation, ...(webhookToken ? { webhookToken } : {}) }) });
  }));

  app.post('/api/flows/:id/webhook-token', requireUser, requirePermission('workflows.publish'), wrap(async (req, res) => {
    const flow = await loadFlow(req.user, req.params.id, true);
    const token = crypto.randomBytes(24).toString('hex');
    await pool.query(`UPDATE flows SET webhook_token_hash = ?, updated_at = UTC_TIMESTAMP(3) WHERE id = ?`, [sha256(token), flow.id]);
    await writeAudit(pool, { tenantId: req.user.tenant_id, userId: req.user.id, action: 'flow.webhook_rotate', entityType: 'flow', entityId: flow.id, projectId: flow.project_id, ip: req.ip });
    res.json({ data: { webhookToken: token, url: `/api/hooks/flows/${flow.id}` } });
  }));

  app.post('/api/flows/:id/disable', requireUser, requirePermission('workflows.publish'), wrap(async (req, res) => {
    const flow = await loadFlow(req.user, req.params.id, true);
    await pool.query(`UPDATE flows SET status = 'disabled', updated_at = UTC_TIMESTAMP(3) WHERE id = ?`, [flow.id]);
    await writeAudit(pool, { tenantId: req.user.tenant_id, userId: req.user.id, action: 'flow.disable', entityType: 'flow', entityId: flow.id, projectId: flow.project_id, ip: req.ip });
    res.json({ data: presentFlow(await loadFlow(req.user, flow.id)) });
  }));

  app.post('/api/flows/:id/enable', requireUser, requirePermission('workflows.publish'), wrap(async (req, res) => {
    const flow = await loadFlow(req.user, req.params.id, true);
    if (!flow.current_version_id) throw new AppError(409, 'INVALID_STATE', 'Publish the flow before enabling it');
    await pool.query(`UPDATE flows SET status = 'published', updated_at = UTC_TIMESTAMP(3) WHERE id = ?`, [flow.id]);
    await writeAudit(pool, { tenantId: req.user.tenant_id, userId: req.user.id, action: 'flow.enable', entityType: 'flow', entityId: flow.id, projectId: flow.project_id, ip: req.ip });
    res.json({ data: presentFlow(await loadFlow(req.user, flow.id)) });
  }));

  app.post('/api/flows/:id/run', requireUser, requirePermission('jobs.run'), wrap(async (req, res) => {
    const flow = await loadFlow(req.user, req.params.id);
    const input = req.body?.input && typeof req.body.input === 'object' && !Array.isArray(req.body.input) ? req.body.input : {};
    const run = await startRun(pool, cfg, { flow, user: req.user, input, triggerSource: req.body?.testRun ? 'test' : 'manual' });
    res.status(202).json({ data: presentRun(run) });
  }));

  // Webhook start: POST /api/hooks/flows/:id with header X-URAP-Flow-Token. The JSON body is the run input.
  app.post('/api/hooks/flows/:id', wrap(async (req, res) => {
    const token = String(req.get('X-URAP-Flow-Token') || '');
    const [rows] = await pool.query(`SELECT * FROM flows WHERE id = ?`, [req.params.id]);
    const flow = rows[0];
    const expected = flow?.webhook_token_hash || '';
    const given = sha256(token);
    if (!flow || !token || flow.trigger_type !== 'webhook' || expected.length !== given.length || !crypto.timingSafeEqual(Buffer.from(expected), Buffer.from(given))) {
      throw new AppError(401, 'UNAUTHORIZED', 'Invalid flow webhook token');
    }
    const input = req.body && typeof req.body === 'object' && !Array.isArray(req.body) ? req.body : {};
    const run = await startRun(pool, cfg, { flow, user: null, input, triggerSource: 'webhook' });
    res.status(202).json({ data: { id: run.id, status: run.status } });
  }));

  const RUN_SELECT = `SELECT r.*, f.name AS flow_name, v.version_number FROM flow_runs r JOIN flows f ON f.id = r.flow_id JOIN flow_versions v ON v.id = r.flow_version_id`;

  async function loadRun(user, id) {
    const [rows] = await pool.query(`${RUN_SELECT} WHERE r.id = ? AND r.tenant_id = ?`, [id, user.tenant_id]);
    if (!rows[0]) throw new AppError(404, 'NOT_FOUND', 'Flow run not found');
    await loadProject(user, rows[0].project_id);
    return rows[0];
  }

  app.get('/api/flow-runs', requireUser, wrap(async (req, res) => {
    const { limit, offset } = paging(req.query);
    const range = await scope(req.user);
    const visible = scopeSql(range, 'r.project_id');
    const where = ['r.tenant_id = ?', visible.sql];
    const params = [req.user.tenant_id, ...visible.params];
    for (const [key, column] of [['flowId', 'r.flow_id'], ['projectId', 'r.project_id'], ['status', 'r.status']]) {
      if (req.query[key]) { where.push(`${column} = ?`); params.push(String(req.query[key])); }
    }
    const [[count]] = await pool.query(`SELECT COUNT(*) AS total FROM flow_runs r WHERE ${where.join(' AND ')}`, params);
    const [rows] = await pool.query(`${RUN_SELECT} WHERE ${where.join(' AND ')} ORDER BY r.created_at DESC LIMIT ${limit} OFFSET ${offset}`, params);
    res.json({ data: rows.map(presentRun), meta: { limit, offset, total: Number(count.total) } });
  }));

  app.get('/api/flow-runs/:id', requireUser, wrap(async (req, res) => {
    let run = await loadRun(req.user, req.params.id);
    if (run.status === 'RUNNING') {
      // Opportunistic advance so the monitor stays live even between worker ticks.
      await advanceRun(pool, cfg, run.id).catch(() => {});
      run = await loadRun(req.user, run.id);
    }
    const [versions] = await pool.query(`SELECT definition_json FROM flow_versions WHERE id = ?`, [run.flow_version_id]);
    const [nodes] = await pool.query(`SELECT * FROM flow_run_nodes WHERE run_id = ? ORDER BY started_at, id`, [run.id]);
    const [events] = await pool.query(`SELECT * FROM flow_run_events WHERE run_id = ? ORDER BY seq`, [run.id]);
    res.json({
      data: {
        ...presentRun(run),
        definition: parse(versions[0]?.definition_json),
        nodes: nodes.map(presentNode),
        events: events.map((row) => ({ id: row.id, nodeId: row.node_id, event: row.event, message: row.message, data: parse(row.data_json), createdAt: row.created_at })),
      },
    });
  }));

  app.post('/api/flow-runs/:id/cancel', requireUser, requirePermission('jobs.control'), wrap(async (req, res) => {
    const run = await loadRun(req.user, req.params.id);
    await cancelRun(pool, run, req.user);
    res.json({ data: presentRun(await loadRun(req.user, run.id)) });
  }));

  app.post('/api/flow-runs/:id/retry', requireUser, requirePermission('jobs.control'), wrap(async (req, res) => {
    const run = await loadRun(req.user, req.params.id);
    await retryRun(pool, cfg, run, req.user);
    res.json({ data: presentRun(await loadRun(req.user, run.id)) });
  }));
}
