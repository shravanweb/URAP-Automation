// Case API. Builders (workflows.write / workflows.publish, project members) design case types: a
// draft definition (fields, stages, tasks, SLAs, escalations) and published versions. People who
// work cases (cases.work, and the roles the case type allows) open cases, update fields, comment,
// attach files, hold and resume, and act on stage tasks. Case managers (cases.manage, or the case
// owner) move stages by hand, resolve, cancel, close, and reopen. External systems open cases with
// POST /api/cases (API token) or the case type webhook (X-URAP-Case-Token).
import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import { z } from 'zod';
import { writeAudit } from '../db/audit.js';
import { AppError, validationError } from '../lib/errors.js';
import { sha256 } from '../lib/cryptoSecrets.js';
import { can } from '../lib/permissions.js';
import { resolveInside } from '../lib/paths.js';
import {
  CASE_STATUSES, PRIORITIES, canManageCase, canWorkCases, emptyDefinition, validateCaseFields, validateCaseTypeDefinition,
} from '../case/definition.js';
import {
  activeUser, addCaseEvent, advanceCase, cancelCase, closeCase, createCase, holdCase, loadCaseDefinition, moveCase, presentCase, presentCaseTask,
  reopenCase, resolveCase, resumeCase, retryCaseTask, skipCaseTask, startCaseTask,
} from '../case/engine.js';

const parse = (value) => (typeof value === 'string' ? JSON.parse(value) : value);
const DEFINITION_LIMIT = 300000;
const PREFIX = /^[A-Z][A-Z0-9]{0,7}$/;

const id80 = z.string().max(80);
const condition = z.object({ path: z.string().max(200), op: z.string().max(20).optional(), value: z.any().optional() });
const sla = z.object({ hours: z.number().finite(), warnAt: z.number().finite().optional() }).nullable().optional().default(null);
const escalation = z.object({ id: id80, when: z.string().max(20), action: z.string().max(30), config: z.record(z.any()).optional().default({}) });
const taskSchema = z.object({
  id: id80, name: z.string().max(200), kind: z.string().max(20), required: z.boolean().optional().default(true), auto: z.boolean().optional().default(true),
  config: z.record(z.any()).optional().default({}),
});
const stageSchema = z.object({
  id: id80, name: z.string().max(120),
  entryConditions: z.array(condition).max(20).optional().default([]),
  exitConditions: z.array(condition).max(20).optional().default([]),
  allowSkip: z.boolean().optional().default(false),
  sla, escalations: z.array(escalation).max(20).optional().default([]),
  tasks: z.array(taskSchema).max(30).optional().default([]),
});
const fieldSchema = z.object({
  name: z.string().max(63), label: z.string().max(200), type: z.string().max(20), required: z.boolean().optional().default(false),
  options: z.array(z.string().max(200)).max(100).optional(), help: z.string().max(500).optional(),
});
const definitionSchema = z.object({
  fields: z.array(fieldSchema).max(100),
  stages: z.array(stageSchema).max(30),
  sla, escalations: z.array(escalation).max(20).optional().default([]),
  settings: z.object({
    defaultPriority: z.string().max(10).optional().default('medium'),
    defaultOwnerUserId: z.string().max(36).nullable().optional().default(''),
    workerRoles: z.array(z.string().max(40)).max(10).optional(),
  }).optional().default({}),
});

export function presentCaseType(row, extra = {}) {
  return {
    id: row.id, projectId: row.project_id, projectName: row.project_name || undefined, name: row.name, description: row.description || '',
    prefix: row.prefix, status: row.status, currentVersionId: row.current_version_id, versionNumber: row.version_number ?? undefined,
    hasWebhook: Boolean(row.webhook_token_hash), definition: parse(row.draft_json), createdBy: row.created_by, createdAt: row.created_at, updatedAt: row.updated_at,
    openCases: row.open_cases === undefined ? undefined : Number(row.open_cases || 0),
    atRiskCases: row.at_risk_cases === undefined ? undefined : Number(row.at_risk_cases || 0),
    ...extra,
  };
}

function presentComment(row) {
  return { id: row.id, body: row.body, userId: row.user_id, userEmail: row.email, userName: row.display_name, createdAt: row.created_at };
}

function suggestPrefix(name) {
  const words = String(name).toUpperCase().replace(/[^A-Z0-9 ]/g, ' ').split(/\s+/).filter(Boolean);
  const letters = words.length > 1 ? words.map((word) => word[0]).join('') : (words[0] || 'CASE').slice(0, 4);
  const prefix = letters.replace(/^[0-9]+/, '').slice(0, 4);
  return PREFIX.test(prefix) ? prefix : 'CASE';
}

export function registerCaseRoutes(app, { pool, cfg, wrap, paging, requireUser, requirePermission, loadProject, scope, scopeSql, like, upload }) {
  const TYPE_SELECT = `SELECT t.*, p.name AS project_name, v.version_number,
      (SELECT COUNT(*) FROM cases c WHERE c.case_type_id = t.id AND c.status IN ('open', 'on_hold')) AS open_cases,
      (SELECT COUNT(*) FROM cases c WHERE c.case_type_id = t.id AND c.status = 'open' AND (c.sla_state IN ('at_risk', 'breached') OR c.stage_sla_state IN ('at_risk', 'breached'))) AS at_risk_cases
    FROM case_types t
    JOIN projects p ON p.id = t.project_id
    LEFT JOIN case_type_versions v ON v.id = t.current_version_id`;
  const CASE_SELECT = `SELECT c.*, t.name AS case_type_name, ou.email AS owner_email, ou.display_name AS owner_name, au.email AS assignee_email, au.display_name AS assignee_name
    FROM cases c
    JOIN case_types t ON t.id = c.case_type_id
    LEFT JOIN users ou ON ou.id = c.owner_user_id
    LEFT JOIN users au ON au.id = c.assignee_user_id`;

  async function loadCaseType(user, id, writable = false) {
    const [rows] = await pool.query(`${TYPE_SELECT} WHERE t.id = ? AND t.tenant_id = ?`, [id, user.tenant_id]);
    if (!rows[0]) throw new AppError(404, 'NOT_FOUND', 'Case type not found');
    await loadProject(user, rows[0].project_id, writable);
    return rows[0];
  }

  async function lookups(projectId, tenantId) {
    const [workflows] = await pool.query(`SELECT id, name, status FROM workflows WHERE project_id = ?`, [projectId]);
    const [flows] = await pool.query(`SELECT id, name, status FROM flows WHERE project_id = ?`, [projectId]);
    const [agents] = await pool.query(`SELECT id, name, status, agent_type FROM agents WHERE project_id = ?`, [projectId]);
    const [users] = await pool.query(`SELECT id FROM users WHERE tenant_id = ? AND status = 'active'`, [tenantId]);
    return {
      workflows: new Map(workflows.map((row) => [row.id, row])),
      flows: new Map(flows.map((row) => [row.id, row])),
      agents: new Map(agents.map((row) => [row.id, row])),
      users: new Set(users.map((row) => row.id)),
    };
  }

  async function people(projectId, tenantId) {
    const [rows] = await pool.query(
      `SELECT u.id, u.email, u.display_name, u.role FROM users u
       WHERE u.tenant_id = ? AND u.status = 'active' AND (u.role = 'administrator' OR u.id IN (SELECT m.user_id FROM project_members m WHERE m.project_id = ?))
       ORDER BY u.display_name, u.email`,
      [tenantId, projectId],
    );
    return rows.map((row) => ({ id: row.id, email: row.email, name: row.display_name, role: row.role }));
  }

  // ---- Case types --------------------------------------------------------------------------

  app.get('/api/case-types', requireUser, wrap(async (req, res) => {
    const { limit, offset } = paging(req.query);
    const range = await scope(req.user);
    const visible = scopeSql(range, 't.project_id');
    const where = ['t.tenant_id = ?', visible.sql];
    const params = [req.user.tenant_id, ...visible.params];
    if (req.query.projectId) { where.push('t.project_id = ?'); params.push(String(req.query.projectId)); }
    if (req.query.status) { where.push('t.status = ?'); params.push(String(req.query.status)); }
    if (req.query.search) { where.push(`t.name LIKE ? ESCAPE '\\\\'`); params.push(like(req.query.search)); }
    const [[count]] = await pool.query(`SELECT COUNT(*) AS total FROM case_types t WHERE ${where.join(' AND ')}`, params);
    const [rows] = await pool.query(`${TYPE_SELECT} WHERE ${where.join(' AND ')} ORDER BY t.updated_at DESC LIMIT ${limit} OFFSET ${offset}`, params);
    const withPublished = req.query.published === '1';
    const data = [];
    for (const row of rows) {
      const extra = {};
      if (withPublished && row.current_version_id) {
        const definition = await loadCaseDefinition(pool, row.current_version_id);
        extra.published = { fields: definition.fields, stages: definition.stages.map((stage) => ({ id: stage.id, name: stage.name })), settings: definition.settings || {} };
        extra.canOpen = can(req.user.role, 'cases.work') && canWorkCases(req.user, definition.settings);
      }
      data.push(presentCaseType(row, extra));
    }
    res.json({ data, meta: { limit, offset, total: Number(count.total) } });
  }));

  app.post('/api/case-types', requireUser, requirePermission('workflows.write'), wrap(async (req, res) => {
    const body = z.object({
      projectId: z.string().uuid(),
      name: z.string().trim().min(1).max(200),
      description: z.string().max(4000).optional().default(''),
      prefix: z.string().trim().toUpperCase().regex(PREFIX, 'Use 1-8 capital letters or digits, starting with a letter').optional(),
    }).safeParse(req.body || {});
    if (!body.success) throw validationError(body.error.issues);
    const project = await loadProject(req.user, body.data.projectId, true);
    const id = crypto.randomUUID();
    const prefix = body.data.prefix || suggestPrefix(body.data.name);
    await pool.query(
      `INSERT INTO case_types (id, tenant_id, project_id, name, description, prefix, status, draft_json, created_by, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, 'draft', ?, ?, UTC_TIMESTAMP(3), UTC_TIMESTAMP(3))`,
      [id, project.tenant_id, project.id, body.data.name, body.data.description, prefix, JSON.stringify(emptyDefinition()), req.user.id],
    );
    await writeAudit(pool, { tenantId: req.user.tenant_id, userId: req.user.id, action: 'case_type.create', entityType: 'case_type', entityId: id, projectId: project.id, ip: req.ip });
    res.status(201).json({ data: presentCaseType(await loadCaseType(req.user, id)) });
  }));

  app.get('/api/case-types/:id', requireUser, wrap(async (req, res) => {
    const row = await loadCaseType(req.user, req.params.id);
    const [versions] = await pool.query(`SELECT id, version_number, published_by, published_at FROM case_type_versions WHERE case_type_id = ? ORDER BY version_number DESC`, [row.id]);
    const validation = validateCaseTypeDefinition(parse(row.draft_json), await lookups(row.project_id, row.tenant_id));
    res.json({
      data: presentCaseType(row, {
        validation,
        people: await people(row.project_id, row.tenant_id),
        versions: versions.map((item) => ({ id: item.id, versionNumber: item.version_number, publishedBy: item.published_by, publishedAt: item.published_at })),
      }),
    });
  }));

  app.patch('/api/case-types/:id', requireUser, requirePermission('workflows.write'), wrap(async (req, res) => {
    const row = await loadCaseType(req.user, req.params.id, true);
    const body = z.object({
      name: z.string().trim().min(1).max(200).optional(),
      description: z.string().max(4000).optional(),
      prefix: z.string().trim().toUpperCase().regex(PREFIX, 'Use 1-8 capital letters or digits, starting with a letter').optional(),
    }).strict().safeParse(req.body || {});
    if (!body.success) throw validationError(body.error.issues);
    await pool.query(`UPDATE case_types SET name = ?, description = ?, prefix = ?, updated_at = UTC_TIMESTAMP(3) WHERE id = ?`, [body.data.name ?? row.name, body.data.description ?? row.description, body.data.prefix ?? row.prefix, row.id]);
    await writeAudit(pool, { tenantId: req.user.tenant_id, userId: req.user.id, action: 'case_type.update', entityType: 'case_type', entityId: row.id, projectId: row.project_id, ip: req.ip });
    res.json({ data: presentCaseType(await loadCaseType(req.user, row.id)) });
  }));

  app.put('/api/case-types/:id/draft', requireUser, requirePermission('workflows.write'), wrap(async (req, res) => {
    const row = await loadCaseType(req.user, req.params.id, true);
    const body = z.object({ definition: definitionSchema }).safeParse(req.body || {});
    if (!body.success) throw validationError(body.error.issues);
    const text = JSON.stringify(body.data.definition);
    if (text.length > DEFINITION_LIMIT) throw new AppError(413, 'TOO_LARGE', 'The case type definition is too large');
    await pool.query(`UPDATE case_types SET draft_json = ?, updated_at = UTC_TIMESTAMP(3) WHERE id = ?`, [text, row.id]);
    await writeAudit(pool, { tenantId: req.user.tenant_id, userId: req.user.id, action: 'case_type.save_draft', entityType: 'case_type', entityId: row.id, projectId: row.project_id, ip: req.ip, metadata: { stages: body.data.definition.stages.length } });
    const validation = validateCaseTypeDefinition(body.data.definition, await lookups(row.project_id, row.tenant_id));
    res.json({ data: presentCaseType(await loadCaseType(req.user, row.id), { validation }) });
  }));

  app.post('/api/case-types/:id/publish', requireUser, requirePermission('workflows.publish'), wrap(async (req, res) => {
    const row = await loadCaseType(req.user, req.params.id, true);
    const definition = parse(row.draft_json);
    const validation = validateCaseTypeDefinition(definition, await lookups(row.project_id, row.tenant_id));
    if (validation.errors.length) throw new AppError(400, 'VALIDATION', 'Fix the case type before publishing', validation.errors);
    const [[max]] = await pool.query(`SELECT COALESCE(MAX(version_number), 0) AS n FROM case_type_versions WHERE case_type_id = ?`, [row.id]);
    const versionId = crypto.randomUUID();
    const versionNumber = Number(max.n) + 1;
    await pool.query(
      `INSERT INTO case_type_versions (id, case_type_id, version_number, definition_json, published_by, published_at) VALUES (?, ?, ?, ?, ?, UTC_TIMESTAMP(3))`,
      [versionId, row.id, versionNumber, JSON.stringify(definition), req.user.id],
    );
    await pool.query(`UPDATE case_types SET status = 'published', current_version_id = ?, updated_at = UTC_TIMESTAMP(3) WHERE id = ?`, [versionId, row.id]);
    await writeAudit(pool, { tenantId: req.user.tenant_id, userId: req.user.id, action: 'case_type.publish', entityType: 'case_type', entityId: row.id, projectId: row.project_id, ip: req.ip, metadata: { version: versionNumber } });
    res.json({ data: presentCaseType(await loadCaseType(req.user, row.id), { validation }) });
  }));

  for (const [verb, status] of [['disable', 'disabled'], ['enable', 'published']]) {
    app.post(`/api/case-types/:id/${verb}`, requireUser, requirePermission('workflows.publish'), wrap(async (req, res) => {
      const row = await loadCaseType(req.user, req.params.id, true);
      if (status === 'published' && !row.current_version_id) throw new AppError(409, 'INVALID_STATE', 'Publish the case type before enabling it');
      await pool.query(`UPDATE case_types SET status = ?, updated_at = UTC_TIMESTAMP(3) WHERE id = ?`, [status, row.id]);
      await writeAudit(pool, { tenantId: req.user.tenant_id, userId: req.user.id, action: `case_type.${verb}`, entityType: 'case_type', entityId: row.id, projectId: row.project_id, ip: req.ip });
      res.json({ data: presentCaseType(await loadCaseType(req.user, row.id)) });
    }));
  }

  app.post('/api/case-types/:id/webhook-token', requireUser, requirePermission('workflows.publish'), wrap(async (req, res) => {
    const row = await loadCaseType(req.user, req.params.id, true);
    const token = crypto.randomBytes(24).toString('hex');
    await pool.query(`UPDATE case_types SET webhook_token_hash = ?, updated_at = UTC_TIMESTAMP(3) WHERE id = ?`, [sha256(token), row.id]);
    await writeAudit(pool, { tenantId: req.user.tenant_id, userId: req.user.id, action: 'case_type.webhook_rotate', entityType: 'case_type', entityId: row.id, projectId: row.project_id, ip: req.ip });
    res.json({ data: { webhookToken: token, url: `/api/hooks/cases/${row.id}` } });
  }));

  // Webhook: POST /api/hooks/cases/:caseTypeId with header X-URAP-Case-Token.
  // Body: { title?, priority?, reference?, fields: {...} } (or the fields at the top level).
  app.post('/api/hooks/cases/:id', wrap(async (req, res) => {
    const token = String(req.get('X-URAP-Case-Token') || '');
    const [rows] = await pool.query(`SELECT * FROM case_types WHERE id = ?`, [req.params.id]);
    const caseType = rows[0];
    const expected = caseType?.webhook_token_hash || '';
    const given = sha256(token);
    if (!caseType || !token || expected.length !== given.length || !crypto.timingSafeEqual(Buffer.from(expected), Buffer.from(given))) {
      throw new AppError(401, 'UNAUTHORIZED', 'Invalid case webhook token');
    }
    const body = req.body && typeof req.body === 'object' && !Array.isArray(req.body) ? req.body : {};
    const fields = body.fields && typeof body.fields === 'object' ? body.fields : body;
    const created = await createCase(pool, cfg, {
      caseType, user: null, title: typeof body.title === 'string' ? body.title : undefined, fields,
      priority: PRIORITIES.includes(body.priority) ? body.priority : undefined, source: 'webhook', sourceRef: typeof body.reference === 'string' ? body.reference : null,
    });
    res.status(201).json({ data: { id: created.id, reference: created.reference, status: created.status, stage: created.current_stage_id } });
  }));

  // ---- Cases -------------------------------------------------------------------------------

  async function loadCaseRecord(user, id) {
    const [rows] = await pool.query(`${CASE_SELECT} WHERE c.id = ? AND c.tenant_id = ?`, [id, user.tenant_id]);
    if (!rows[0]) throw new AppError(404, 'NOT_FOUND', 'Case not found');
    await loadProject(user, rows[0].project_id);
    const definition = await loadCaseDefinition(pool, rows[0].case_type_version_id);
    return { row: rows[0], definition };
  }

  function permissions(user, row, definition) {
    const mine = row.owner_user_id === user.id || row.assignee_user_id === user.id;
    const canWork = user.role !== 'viewer' && ((can(user.role, 'cases.work') && canWorkCases(user, definition.settings)) || mine);
    const canManage = user.role !== 'viewer' && (can(user.role, 'cases.manage') || canManageCase(user, row));
    return { canWork, canManage };
  }

  function requireWork(user, row, definition) {
    if (!permissions(user, row, definition).canWork) throw new AppError(403, 'FORBIDDEN', 'You cannot work on cases of this type');
  }
  function requireManage(user, row, definition) {
    if (!permissions(user, row, definition).canManage) throw new AppError(403, 'FORBIDDEN', 'Only case managers or the case owner can do this');
  }

  async function filters(req, alias = 'c') {
    const range = await scope(req.user);
    const visible = scopeSql(range, `${alias}.project_id`);
    const where = [`${alias}.tenant_id = ?`, visible.sql];
    const params = [req.user.tenant_id, ...visible.params];
    const q = req.query;
    if (q.projectId) { where.push(`${alias}.project_id = ?`); params.push(String(q.projectId)); }
    if (q.caseTypeId) { where.push(`${alias}.case_type_id = ?`); params.push(String(q.caseTypeId)); }
    if (q.status) {
      const statuses = String(q.status) === 'active' ? ['open', 'on_hold'] : String(q.status).split(',').filter((status) => CASE_STATUSES.includes(status));
      if (statuses.length) { where.push(`${alias}.status IN (${statuses.map(() => '?').join(',')})`); params.push(...statuses); }
    }
    if (q.stageId) { where.push(`${alias}.current_stage_id = ?`); params.push(String(q.stageId)); }
    if (q.sla) {
      const state = String(q.sla);
      if (state === 'at_risk') { where.push(`${alias}.status = 'open' AND ('at_risk' IN (${alias}.sla_state, ${alias}.stage_sla_state)) AND 'breached' NOT IN (${alias}.sla_state, ${alias}.stage_sla_state)`); }
      else if (state === 'breached') { where.push(`'breached' IN (${alias}.sla_state, ${alias}.stage_sla_state)`); }
      else if (state === 'on_track') { where.push(`${alias}.status IN ('open', 'on_hold') AND ${alias}.sla_state IN ('on_track', 'none') AND ${alias}.stage_sla_state IN ('on_track', 'none')`); }
    }
    if (q.owner) {
      const owner = String(q.owner);
      if (owner === 'me') { where.push(`(${alias}.owner_user_id = ? OR ${alias}.assignee_user_id = ?)`); params.push(req.user.id, req.user.id); }
      else if (owner === 'unassigned') where.push(`${alias}.owner_user_id IS NULL AND ${alias}.assignee_user_id IS NULL`);
      else { where.push(`(${alias}.owner_user_id = ? OR ${alias}.assignee_user_id = ?)`); params.push(owner, owner); }
    }
    if (q.priority && PRIORITIES.includes(String(q.priority))) { where.push(`${alias}.priority = ?`); params.push(String(q.priority)); }
    if (q.search) { where.push(`(${alias}.title LIKE ? ESCAPE '\\\\' OR ${alias}.reference LIKE ? ESCAPE '\\\\')`); params.push(like(q.search), like(q.search)); }
    return { where, params };
  }

  async function presentRows(rows) {
    const out = [];
    for (const row of rows) out.push(presentCase(row, await loadCaseDefinition(pool, row.case_type_version_id).catch(() => null)));
    return out;
  }

  app.get('/api/cases', requireUser, wrap(async (req, res) => {
    const { limit, offset } = paging(req.query);
    const { where, params } = await filters(req);
    const order = req.query.sort === 'due' ? `COALESCE(c.stage_due_at, c.due_at) IS NULL, COALESCE(c.stage_due_at, c.due_at) ASC` : 'c.updated_at DESC';
    const [[count]] = await pool.query(`SELECT COUNT(*) AS total FROM cases c WHERE ${where.join(' AND ')}`, params);
    const [rows] = await pool.query(`${CASE_SELECT} WHERE ${where.join(' AND ')} ORDER BY ${order} LIMIT ${limit} OFFSET ${offset}`, params);
    res.json({ data: await presentRows(rows), meta: { limit, offset, total: Number(count.total) } });
  }));

  app.get('/api/cases/summary', requireUser, wrap(async (req, res) => {
    const { where, params } = await filters({ ...req, query: { projectId: req.query.projectId, caseTypeId: req.query.caseTypeId } });
    const [[row]] = await pool.query(
      `SELECT
         SUM(c.status = 'open') AS open_count,
         SUM(c.status = 'on_hold') AS on_hold,
         SUM(c.status = 'open' AND 'at_risk' IN (c.sla_state, c.stage_sla_state) AND 'breached' NOT IN (c.sla_state, c.stage_sla_state)) AS at_risk,
         SUM(c.status IN ('open', 'on_hold') AND 'breached' IN (c.sla_state, c.stage_sla_state)) AS breached,
         SUM(c.status IN ('open', 'on_hold') AND (c.owner_user_id = ? OR c.assignee_user_id = ?)) AS mine,
         SUM(c.status IN ('resolved', 'closed') AND c.resolved_at >= DATE_SUB(UTC_TIMESTAMP(3), INTERVAL 7 DAY)) AS resolved_week
       FROM cases c WHERE ${where.join(' AND ')}`,
      [req.user.id, req.user.id, ...params],
    );
    res.json({ data: { open: Number(row.open_count || 0), onHold: Number(row.on_hold || 0), atRisk: Number(row.at_risk || 0), breached: Number(row.breached || 0), mine: Number(row.mine || 0), resolvedThisWeek: Number(row.resolved_week || 0) } });
  }));

  app.get('/api/cases/board', requireUser, wrap(async (req, res) => {
    if (!req.query.caseTypeId) throw validationError([{ path: ['caseTypeId'], message: 'caseTypeId is required' }]);
    const type = await loadCaseType(req.user, String(req.query.caseTypeId));
    if (!type.current_version_id) throw new AppError(409, 'CASE_TYPE_NOT_PUBLISHED', 'Publish the case type to see its board');
    const definition = await loadCaseDefinition(pool, type.current_version_id);
    const { where, params } = await filters({ ...req, query: { ...req.query, status: undefined, stageId: undefined } });
    const [rows] = await pool.query(
      `${CASE_SELECT} WHERE ${where.join(' AND ')} AND (c.status IN ('open', 'on_hold') OR (c.status IN ('resolved', 'closed') AND c.resolved_at >= DATE_SUB(UTC_TIMESTAMP(3), INTERVAL 7 DAY)))
       ORDER BY FIELD(c.priority, 'critical', 'high', 'medium', 'low'), COALESCE(c.stage_due_at, c.due_at) IS NULL, COALESCE(c.stage_due_at, c.due_at) ASC LIMIT 500`,
      params,
    );
    const cases = await presentRows(rows);
    const columns = definition.stages.map((stage) => ({ id: stage.id, name: stage.name, sla: stage.sla || null, taskCount: (stage.tasks || []).length, cases: [] }));
    const resolved = { id: '__resolved', name: 'Resolved', cases: [] };
    const other = { id: '__other', name: 'Other stages', cases: [] };
    for (const item of cases) {
      if (['resolved', 'closed'].includes(item.status)) { resolved.cases.push(item); continue; }
      const column = columns.find((col) => col.id === item.currentStageId);
      (column || other).cases.push(item);
    }
    res.json({ data: { caseType: presentCaseType(type, { definition: undefined }), columns: [...columns, ...(other.cases.length ? [other] : []), resolved] } });
  }));

  app.post('/api/cases', requireUser, requirePermission('cases.work'), wrap(async (req, res) => {
    const body = z.object({
      caseTypeId: z.string().uuid(),
      title: z.string().max(300).optional(),
      fields: z.record(z.any()).optional().default({}),
      priority: z.enum(PRIORITIES).optional(),
      ownerUserId: z.string().uuid().nullable().optional(),
      assigneeUserId: z.string().uuid().nullable().optional(),
      source: z.enum(['manual', 'api']).optional().default('api'),
      reference: z.string().max(80).optional(),
    }).safeParse(req.body || {});
    if (!body.success) throw validationError(body.error.issues);
    const type = await loadCaseType(req.user, body.data.caseTypeId, true);
    if (type.status !== 'published' || !type.current_version_id) throw new AppError(409, 'CASE_TYPE_NOT_PUBLISHED', `${type.name} is not published`);
    const definition = await loadCaseDefinition(pool, type.current_version_id);
    if (!canWorkCases(req.user, definition.settings)) throw new AppError(403, 'FORBIDDEN', 'Your role cannot open cases of this type');
    const created = await createCase(pool, cfg, {
      caseType: type, user: req.user, title: body.data.title, fields: body.data.fields, priority: body.data.priority,
      ownerUserId: body.data.ownerUserId || undefined, assigneeUserId: body.data.assigneeUserId || undefined, source: body.data.source, sourceRef: body.data.reference || null,
    });
    const { row } = await loadCaseRecord(req.user, created.id);
    res.status(201).json({ data: presentCase(row, definition) });
  }));

  async function detail(user, id) {
    let { row, definition } = await loadCaseRecord(user, id);
    const [tasks] = await pool.query(`SELECT * FROM case_tasks WHERE case_id = ? ORDER BY created_at, attempt`, [row.id]);
    if (row.status === 'open' && (tasks.some((task) => task.status === 'in_progress') || !row.current_stage_id)) {
      // Opportunistic advance so the page stays live between worker ticks.
      await advanceCase(pool, cfg, row.id).catch(() => {});
      ({ row, definition } = await loadCaseRecord(user, id));
    }
    const [freshTasks] = await pool.query(`SELECT * FROM case_tasks WHERE case_id = ? ORDER BY created_at, attempt`, [row.id]);
    const [events] = await pool.query(
      `SELECT e.*, u.email, u.display_name FROM case_events e LEFT JOIN users u ON u.id = e.actor_user_id WHERE e.case_id = ? ORDER BY e.seq DESC LIMIT 300`,
      [row.id],
    );
    const [comments] = await pool.query(`SELECT c.*, u.email, u.display_name FROM case_comments c LEFT JOIN users u ON u.id = c.user_id WHERE c.case_id = ? ORDER BY c.created_at`, [row.id]);
    const [attachments] = await pool.query(
      `SELECT a.id, a.artifact_id, a.created_at, art.file_name, art.size_bytes, art.mime_type, u.email, u.display_name
       FROM case_attachments a JOIN artifacts art ON art.id = a.artifact_id LEFT JOIN users u ON u.id = a.user_id WHERE a.case_id = ? ORDER BY a.created_at`,
      [row.id],
    );
    return {
      ...presentCase(row, definition),
      definition,
      tasks: freshTasks.map(presentCaseTask),
      events: events.map((event) => ({ id: event.id, event: event.event, message: event.message, actorUserId: event.actor_user_id, actorEmail: event.email, actorName: event.display_name, data: parse(event.data_json), createdAt: event.created_at })),
      comments: comments.map(presentComment),
      attachments: attachments.map((item) => ({ id: item.id, artifactId: item.artifact_id, fileName: item.file_name, size: Number(item.size_bytes), mimeType: item.mime_type, userEmail: item.email, userName: item.display_name, createdAt: item.created_at })),
      people: await people(row.project_id, row.tenant_id),
      permissions: permissions(user, row, definition),
    };
  }

  app.get('/api/cases/:id', requireUser, wrap(async (req, res) => {
    res.json({ data: await detail(req.user, req.params.id) });
  }));

  app.patch('/api/cases/:id', requireUser, wrap(async (req, res) => {
    const { row, definition } = await loadCaseRecord(req.user, req.params.id);
    const body = z.object({
      title: z.string().trim().min(1).max(300).optional(),
      priority: z.enum(PRIORITIES).optional(),
      fields: z.record(z.any()).optional(),
      ownerUserId: z.string().uuid().nullable().optional(),
      assigneeUserId: z.string().uuid().nullable().optional(),
    }).strict().safeParse(req.body || {});
    if (!body.success) throw validationError(body.error.issues);
    if (!['open', 'on_hold'].includes(row.status)) throw new AppError(409, 'INVALID_STATE', `A ${row.status} case cannot be edited; reopen it first`);
    requireWork(req.user, row, definition);
    const data = body.data;
    if (data.priority !== undefined || data.ownerUserId !== undefined) requireManage(req.user, row, definition);
    const sets = [];
    const params = [];
    const changes = [];
    if (data.title !== undefined && data.title !== row.title) { sets.push('title = ?'); params.push(data.title); changes.push('title'); }
    if (data.priority !== undefined && data.priority !== row.priority) { sets.push('priority = ?'); params.push(data.priority); changes.push(`priority → ${data.priority}`); }
    for (const [key, column, label] of [['ownerUserId', 'owner_user_id', 'owner'], ['assigneeUserId', 'assignee_user_id', 'assignee']]) {
      if (data[key] === undefined || data[key] === row[column]) continue;
      let email = 'nobody';
      if (data[key]) {
        const user = await activeUser(pool, row.tenant_id, data[key]);
        if (!user) throw new AppError(400, 'VALIDATION', `The ${label} must be an active user`);
        email = user.email;
      }
      sets.push(`${column} = ?`); params.push(data[key]); changes.push(`${label} → ${email}`);
    }
    let fieldNames = [];
    if (data.fields) {
      const unknown = Object.keys(data.fields).filter((key) => !(definition.fields || []).some((field) => field.name === key));
      if (unknown.length) throw new AppError(400, 'VALIDATION', `Unknown fields: ${unknown.join(', ')}`);
      const checked = validateCaseFields(definition.fields, data.fields, { partial: true });
      if (checked.errors.length) throw new AppError(400, 'VALIDATION', checked.errors.map((error) => error.message).join('; '), checked.errors);
      const current = parse(row.fields_json) || {};
      fieldNames = Object.keys(checked.values).filter((key) => JSON.stringify(current[key]) !== JSON.stringify(checked.values[key]));
      if (fieldNames.length) { sets.push('fields_json = ?'); params.push(JSON.stringify({ ...current, ...checked.values })); }
    }
    if (sets.length) {
      await pool.query(`UPDATE cases SET ${sets.join(', ')}, updated_at = UTC_TIMESTAMP(3) WHERE id = ?`, [...params, row.id]);
      if (changes.length) await addCaseEvent(pool, row.id, 'case.updated', `Changed ${changes.join(', ')}`, { actor: req.user });
      if (fieldNames.length) await addCaseEvent(pool, row.id, 'fields.updated', `Updated ${fieldNames.map((name) => (definition.fields.find((field) => field.name === name)?.label || name)).join(', ')}`, { actor: req.user, data: { fields: Object.fromEntries(fieldNames.map((name) => [name, data.fields[name]])) } });
      await writeAudit(pool, { tenantId: req.user.tenant_id, userId: req.user.id, action: 'case.update', entityType: 'case', entityId: row.id, projectId: row.project_id, ip: req.ip, metadata: { changes, fields: fieldNames } });
      if (row.status === 'open') await advanceCase(pool, cfg, row.id, { actor: req.user });
    }
    res.json({ data: await detail(req.user, row.id) });
  }));

  const ACTIONS = {
    hold: { manage: false, run: (row, user, body) => holdCase(pool, row, user, { reason: body.reason }) },
    resume: { manage: false, run: (row, user) => resumeCase(pool, cfg, row, user) },
    resolve: { manage: true, run: (row, user, body) => resolveCase(pool, row, user, { comment: body.comment, cfg }) },
    cancel: { manage: true, run: (row, user, body) => cancelCase(pool, row, user, { comment: body.comment, cfg }) },
    close: { manage: true, run: (row, user) => closeCase(pool, row, user) },
    reopen: { manage: true, run: (row, user, body) => reopenCase(pool, cfg, row, user, { stageId: body.stageId || null }) },
    move: { manage: true, run: (row, user, body) => moveCase(pool, cfg, row, user, { stageId: body.stageId, reason: body.reason }) },
  };

  app.post('/api/cases/:id/:action(hold|resume|resolve|cancel|close|reopen|move)', requireUser, wrap(async (req, res) => {
    const { row, definition } = await loadCaseRecord(req.user, req.params.id);
    const action = ACTIONS[req.params.action];
    const body = z.object({ reason: z.string().max(500).optional(), comment: z.string().max(2000).optional(), stageId: z.string().max(80).optional() }).safeParse(req.body || {});
    if (!body.success) throw validationError(body.error.issues);
    if (req.params.action === 'move' && !body.data.stageId) throw validationError([{ path: ['stageId'], message: 'Choose the stage to move to' }]);
    if (action.manage) requireManage(req.user, row, definition); else requireWork(req.user, row, definition);
    await action.run(row, req.user, body.data);
    res.json({ data: await detail(req.user, row.id) });
  }));

  app.post('/api/cases/:id/tasks/:taskId/:action(start|retry|skip)', requireUser, wrap(async (req, res) => {
    const { row, definition } = await loadCaseRecord(req.user, req.params.id);
    requireWork(req.user, row, definition);
    const { action, taskId } = req.params;
    if (action === 'start') await startCaseTask(pool, cfg, row, taskId, req.user);
    if (action === 'retry') await retryCaseTask(pool, cfg, row, taskId, req.user);
    if (action === 'skip') await skipCaseTask(pool, cfg, row, taskId, req.user, { manager: permissions(req.user, row, definition).canManage, reason: String(req.body?.reason || '').slice(0, 500) });
    await writeAudit(pool, { tenantId: req.user.tenant_id, userId: req.user.id, action: `case.task_${action}`, entityType: 'case', entityId: row.id, projectId: row.project_id, ip: req.ip, metadata: { taskId } });
    res.json({ data: await detail(req.user, row.id) });
  }));

  app.post('/api/cases/:id/comments', requireUser, wrap(async (req, res) => {
    const { row, definition } = await loadCaseRecord(req.user, req.params.id);
    requireWork(req.user, row, definition);
    const body = z.object({ body: z.string().trim().min(1).max(5000) }).safeParse(req.body || {});
    if (!body.success) throw validationError(body.error.issues);
    await pool.query(`INSERT INTO case_comments (id, case_id, user_id, body, created_at) VALUES (?, ?, ?, ?, UTC_TIMESTAMP(3))`, [crypto.randomUUID(), row.id, req.user.id, body.data.body]);
    await pool.query(`UPDATE cases SET updated_at = UTC_TIMESTAMP(3) WHERE id = ?`, [row.id]);
    await addCaseEvent(pool, row.id, 'comment.added', `Commented: ${body.data.body.slice(0, 140)}${body.data.body.length > 140 ? '…' : ''}`, { actor: req.user });
    res.status(201).json({ data: await detail(req.user, row.id) });
  }));

  app.post('/api/cases/:id/attachments', requireUser, upload.single('file'), wrap(async (req, res) => {
    const { row, definition } = await loadCaseRecord(req.user, req.params.id);
    requireWork(req.user, row, definition);
    if (!req.file) throw validationError([{ path: ['file'], message: 'file is required' }]);
    const original = path.basename(req.file.originalname);
    if (!/^[A-Za-z0-9._ -]{1,120}$/.test(original) || !/\.(csv|xlsx|pdf|txt|json|png|jpe?g|docx)$/i.test(original)) {
      throw new AppError(400, 'FILE_TYPE', 'Attach csv, xlsx, docx, pdf, txt, json, png, or jpg files with a simple file name');
    }
    const head = req.file.buffer.subarray(0, 5);
    const extension = original.split('.').pop().toLowerCase();
    if (extension === 'pdf' && head.toString() !== '%PDF-') throw new AppError(400, 'FILE_TYPE', 'The file did not look like a PDF');
    if (extension === 'png' && head.subarray(0, 4).toString('hex') !== '89504e47') throw new AppError(400, 'FILE_TYPE', 'The file did not look like a PNG image');
    if (['jpg', 'jpeg'].includes(extension) && head.subarray(0, 3).toString('hex') !== 'ffd8ff') throw new AppError(400, 'FILE_TYPE', 'The file did not look like a JPG image');
    if (['xlsx', 'docx'].includes(extension) && head.subarray(0, 2).toString() !== 'PK') throw new AppError(400, 'FILE_TYPE', 'The file did not look like an Office document');
    const relative = path.join('uploads', 'cases', `${crypto.randomUUID()}-${original}`);
    const absolute = resolveInside(path.join(cfg.storageRoot, row.tenant_id, row.project_id), relative);
    await fs.mkdir(path.dirname(absolute), { recursive: true });
    await fs.writeFile(absolute, req.file.buffer);
    const artifactId = crypto.randomUUID();
    await pool.query(
      `INSERT INTO artifacts (id, tenant_id, project_id, file_name, storage_path, mime_type, size_bytes, checksum_sha256, created_by, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, UTC_TIMESTAMP(3))`,
      [artifactId, row.tenant_id, row.project_id, original, relative, req.file.mimetype || 'application/octet-stream', req.file.size, sha256(req.file.buffer), req.user.id],
    );
    await pool.query(`INSERT INTO case_attachments (id, case_id, artifact_id, user_id, created_at) VALUES (?, ?, ?, ?, UTC_TIMESTAMP(3))`, [crypto.randomUUID(), row.id, artifactId, req.user.id]);
    await addCaseEvent(pool, row.id, 'attachment.added', `Attached ${original}`, { actor: req.user, data: { artifactId } });
    await writeAudit(pool, { tenantId: req.user.tenant_id, userId: req.user.id, action: 'case.attach', entityType: 'case', entityId: row.id, projectId: row.project_id, ip: req.ip, metadata: { artifactId, size: req.file.size } });
    res.status(201).json({ data: await detail(req.user, row.id) });
  }));
}
