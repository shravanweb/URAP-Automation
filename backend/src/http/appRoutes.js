// App API. Builders (workflows.write / workflows.publish, project members) create apps, save the
// draft definition, set who may open the app, and publish versions. End users open published apps
// through the /runtime endpoints: the server only runs data sources and actions that exist in the
// app definition, scoped to the app's project, after checking the app's access settings. The
// designer's preview uses the same endpoints against the draft (builders only).
import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import { z } from 'zod';
import { writeAudit } from '../db/audit.js';
import { AppError, validationError } from '../lib/errors.js';
import { sha256 } from '../lib/cryptoSecrets.js';
import { can } from '../lib/permissions.js';
import { resolveInside } from '../lib/paths.js';
import { enqueueJob } from '../services/jobService.js';
import { addQueueItem, findQueue } from '../services/queueService.js';
import { createTask, presentTask } from '../services/taskService.js';
import { createRuntime } from '../services/runtime.js';
import { advanceRun, startRun } from '../flow/engine.js';
import { kickAgentRun, postAgentMessage, startAgentRun } from '../agent/runtime.js';
import { createCase } from '../case/engine.js';
import { presentMessage } from './agentRoutes.js';
import {
  ACCESS_MODES, APP_ROLES, NAME, SERVER_ACTIONS, allComponents, canOpenApp, defaultSettings, emptyDefinition,
  findAction, findComponent, safePath, validateAppDefinition,
} from '../app/definition.js';

const parse = (value) => (typeof value === 'string' ? JSON.parse(value) : value);
const JOB_DONE = ['SUCCEEDED', 'FAILED', 'CANCELLED', 'SKIPPED'];
const AGENT_DONE = ['SUCCEEDED', 'FAILED', 'CANCELLED'];
const DEFINITION_LIMIT = 500000;

const looseObject = z.record(z.any());
const componentSchema = z.object({
  id: z.string().max(80),
  type: z.string().max(30),
  span: z.number().int().optional(),
  props: looseObject.optional().default({}),
  visibleWhen: z.object({ path: z.string().max(300), op: z.string().max(20).optional(), value: z.any().optional() }).nullable().optional(),
  events: z.record(z.array(z.object({ id: z.string().max(80), type: z.string().max(30), config: looseObject.optional().default({}), resultVar: z.string().max(63).optional() }).passthrough()).max(40)).optional(),
}).passthrough();
const definitionSchema = z.object({
  pages: z.array(z.object({
    id: z.string().max(80),
    name: z.string().max(80),
    inputs: z.array(z.string().max(63)).max(20).optional().default([]),
    components: z.array(componentSchema.extend({ children: z.array(componentSchema).max(120).optional() })).max(120),
  })).max(30),
  dataSources: z.array(z.object({ id: z.string().max(80), name: z.string().max(63), type: z.string().max(30), config: looseObject.optional().default({}), autoLoad: z.boolean().optional().default(true) })).max(30).optional().default([]),
  variables: z.array(z.object({ name: z.string().max(63), defaultValue: z.any().optional() })).max(50).optional().default([]),
});
const settingsSchema = z.object({
  access: z.enum(ACCESS_MODES),
  roles: z.array(z.enum(APP_ROLES)).max(5).optional().default([]),
  userIds: z.array(z.string().uuid()).max(500).optional().default([]),
});

export function presentApp(row, extra = {}) {
  const definition = parse(row.draft_json) || { pages: [] };
  return {
    id: row.id,
    projectId: row.project_id,
    projectName: row.project_name || undefined,
    name: row.name,
    description: row.description || '',
    status: row.status,
    currentVersionId: row.current_version_id,
    versionNumber: row.version_number ?? undefined,
    publishedAt: row.published_at ?? undefined,
    definition,
    settings: { ...defaultSettings(), ...(parse(row.settings_json) || {}) },
    pageCount: definition.pages?.length || 0,
    componentCount: allComponents(definition).length,
    createdBy: row.created_by,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    ...extra,
  };
}

function pick(values, keys) {
  const out = {};
  const source = values && typeof values === 'object' && !Array.isArray(values) ? values : {};
  for (const key of keys) if (source[key] !== undefined) out[key] = source[key];
  return out;
}
const mappingKeys = (mapping) => (Array.isArray(mapping) ? mapping.map((row) => row?.key).filter((key) => NAME.test(String(key || ''))) : []);
const pseudoJob = (app) => ({ id: null, tenant_id: app.tenant_id, project_id: app.project_id, workflow_id: null });
const asObject = (value) => (value && typeof value === 'object' && !Array.isArray(value) ? value : {});

export function registerAppRoutes(app, { pool, cfg, wrap, paging, requireUser, requirePermission, loadProject, scope, scopeSql, like, upload }) {
  const APP_SELECT = `SELECT a.*, p.name AS project_name, v.version_number, v.published_at
    FROM apps a
    JOIN projects p ON p.id = a.project_id
    LEFT JOIN app_versions v ON v.id = a.current_version_id`;

  async function loadApp(user, id, writable = false) {
    const [rows] = await pool.query(`${APP_SELECT} WHERE a.id = ? AND a.tenant_id = ?`, [id, user.tenant_id]);
    if (!rows[0]) throw new AppError(404, 'NOT_FOUND', 'App not found');
    await loadProject(user, rows[0].project_id, writable);
    return rows[0];
  }

  async function lookups(projectId) {
    const [workflows] = await pool.query(`SELECT id, name, status FROM workflows WHERE project_id = ?`, [projectId]);
    const [flows] = await pool.query(`SELECT id, name, status FROM flows WHERE project_id = ?`, [projectId]);
    const [agents] = await pool.query(`SELECT id, name, status, agent_type FROM agents WHERE project_id = ?`, [projectId]);
    const [queues] = await pool.query(`SELECT id, name, status FROM work_queues WHERE project_id = ?`, [projectId]);
    const [connections] = await pool.query(`SELECT id, name, connector_type FROM connections WHERE project_id = ? AND connector_type = 'rest_api'`, [projectId]);
    const [caseTypes] = await pool.query(`SELECT id, name, status FROM case_types WHERE project_id = ?`, [projectId]);
    const map = (rows) => new Map(rows.map((row) => [row.id, row]));
    return { workflows: map(workflows), flows: map(flows), agents: map(agents), queues: map(queues), connections: map(connections), caseTypes: map(caseTypes) };
  }

  async function membershipOf(user, projectId) {
    const [rows] = await pool.query(`SELECT role FROM project_members WHERE project_id = ? AND user_id = ?`, [projectId, user.id]);
    return rows[0]?.role || null;
  }

  async function checkUsers(tenantId, userIds) {
    if (!userIds.length) return;
    const [rows] = await pool.query(`SELECT id FROM users WHERE tenant_id = ? AND id IN (${userIds.map(() => '?').join(',')})`, [tenantId, ...userIds]);
    if (rows.length !== new Set(userIds).size) throw new AppError(400, 'VALIDATION', 'Some selected users are not in this organization', [{ path: 'userIds', message: 'Unknown user' }]);
  }

  // ---- Builder endpoints --------------------------------------------------------------------

  app.get('/api/apps', requireUser, wrap(async (req, res) => {
    const { limit, offset } = paging(req.query);
    const range = await scope(req.user);
    const visible = scopeSql(range, 'a.project_id');
    const where = ['a.tenant_id = ?', visible.sql];
    const params = [req.user.tenant_id, ...visible.params];
    if (req.query.projectId) { where.push('a.project_id = ?'); params.push(String(req.query.projectId)); }
    if (req.query.status) { where.push('a.status = ?'); params.push(String(req.query.status)); }
    if (req.query.search) { where.push(`a.name LIKE ? ESCAPE '\\\\'`); params.push(like(req.query.search)); }
    const [[count]] = await pool.query(`SELECT COUNT(*) AS total FROM apps a WHERE ${where.join(' AND ')}`, params);
    const [rows] = await pool.query(`${APP_SELECT} WHERE ${where.join(' AND ')} ORDER BY a.updated_at DESC LIMIT ${limit} OFFSET ${offset}`, params);
    res.json({ data: rows.map((row) => presentApp(row)), meta: { limit, offset, total: Number(count.total) } });
  }));

  // Published apps this user may open (Home, the Apps page, the launcher).
  app.get('/api/apps/available', requireUser, wrap(async (req, res) => {
    const [rows] = await pool.query(`${APP_SELECT} WHERE a.tenant_id = ? AND a.status = 'published' ORDER BY a.name`, [req.user.tenant_id]);
    const [members] = await pool.query(`SELECT project_id, role FROM project_members WHERE user_id = ?`, [req.user.id]);
    const roles = new Map(members.map((row) => [row.project_id, row.role]));
    const data = rows
      .filter((row) => canOpenApp(req.user, { ...defaultSettings(), ...(parse(row.settings_json) || {}) }, roles.get(row.project_id) || null))
      .map((row) => ({ id: row.id, name: row.name, description: row.description || '', projectName: row.project_name, versionNumber: row.version_number, publishedAt: row.published_at, updatedAt: row.updated_at }));
    res.json({ data });
  }));

  app.post('/api/apps', requireUser, requirePermission('workflows.write'), wrap(async (req, res) => {
    const body = z.object({
      projectId: z.string().uuid(),
      name: z.string().trim().min(1).max(200),
      description: z.string().max(4000).optional().default(''),
    }).safeParse(req.body || {});
    if (!body.success) throw validationError(body.error.issues);
    const project = await loadProject(req.user, body.data.projectId, true);
    const id = crypto.randomUUID();
    await pool.query(
      `INSERT INTO apps (id, tenant_id, project_id, name, description, status, draft_json, settings_json, created_by, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, 'draft', ?, ?, ?, UTC_TIMESTAMP(3), UTC_TIMESTAMP(3))`,
      [id, project.tenant_id, project.id, body.data.name, body.data.description, JSON.stringify(emptyDefinition(body.data.name)), JSON.stringify(defaultSettings()), req.user.id],
    );
    await writeAudit(pool, { tenantId: req.user.tenant_id, userId: req.user.id, action: 'app.create', entityType: 'app', entityId: id, projectId: project.id, ip: req.ip });
    res.status(201).json({ data: presentApp(await loadApp(req.user, id)) });
  }));

  app.get('/api/apps/:id', requireUser, wrap(async (req, res) => {
    const row = await loadApp(req.user, req.params.id);
    const [versions] = await pool.query(`SELECT id, version_number, published_by, published_at FROM app_versions WHERE app_id = ? ORDER BY version_number DESC`, [row.id]);
    const validation = validateAppDefinition(parse(row.draft_json), await lookups(row.project_id));
    res.json({ data: presentApp(row, { validation, versions: versions.map((item) => ({ id: item.id, versionNumber: item.version_number, publishedBy: item.published_by, publishedAt: item.published_at })) }) });
  }));

  app.patch('/api/apps/:id', requireUser, requirePermission('workflows.write'), wrap(async (req, res) => {
    const row = await loadApp(req.user, req.params.id, true);
    const body = z.object({ name: z.string().trim().min(1).max(200).optional(), description: z.string().max(4000).optional() }).strict().safeParse(req.body || {});
    if (!body.success) throw validationError(body.error.issues);
    await pool.query(`UPDATE apps SET name = ?, description = ?, updated_at = UTC_TIMESTAMP(3) WHERE id = ?`, [body.data.name ?? row.name, body.data.description ?? row.description, row.id]);
    await writeAudit(pool, { tenantId: req.user.tenant_id, userId: req.user.id, action: 'app.update', entityType: 'app', entityId: row.id, projectId: row.project_id, ip: req.ip });
    res.json({ data: presentApp(await loadApp(req.user, row.id)) });
  }));

  app.put('/api/apps/:id/draft', requireUser, requirePermission('workflows.write'), wrap(async (req, res) => {
    const row = await loadApp(req.user, req.params.id, true);
    const body = z.object({ definition: definitionSchema }).safeParse(req.body || {});
    if (!body.success) throw validationError(body.error.issues);
    const json = JSON.stringify(body.data.definition);
    if (json.length > DEFINITION_LIMIT) throw new AppError(400, 'VALIDATION', 'The app definition is too large (500 KB limit)');
    await pool.query(`UPDATE apps SET draft_json = ?, updated_at = UTC_TIMESTAMP(3) WHERE id = ?`, [json, row.id]);
    await writeAudit(pool, { tenantId: req.user.tenant_id, userId: req.user.id, action: 'app.save_draft', entityType: 'app', entityId: row.id, projectId: row.project_id, ip: req.ip, metadata: { pages: body.data.definition.pages.length, components: allComponents(body.data.definition).length } });
    const validation = validateAppDefinition(body.data.definition, await lookups(row.project_id));
    res.json({ data: presentApp(await loadApp(req.user, row.id), { validation }) });
  }));

  app.put('/api/apps/:id/settings', requireUser, requirePermission('workflows.publish'), wrap(async (req, res) => {
    const row = await loadApp(req.user, req.params.id, true);
    const body = settingsSchema.safeParse(req.body?.settings || {});
    if (!body.success) throw validationError(body.error.issues);
    const settings = { access: body.data.access, roles: body.data.access === 'roles' ? [...new Set(body.data.roles)] : [], userIds: body.data.access === 'users' ? [...new Set(body.data.userIds)] : [] };
    if (settings.access === 'roles' && !settings.roles.length) throw new AppError(400, 'VALIDATION', 'Pick at least one role', [{ path: 'roles', message: 'Pick at least one role' }]);
    if (settings.access === 'users' && !settings.userIds.length) throw new AppError(400, 'VALIDATION', 'Pick at least one person', [{ path: 'userIds', message: 'Pick at least one person' }]);
    await checkUsers(row.tenant_id, settings.userIds);
    await pool.query(`UPDATE apps SET settings_json = ?, updated_at = UTC_TIMESTAMP(3) WHERE id = ?`, [JSON.stringify(settings), row.id]);
    await writeAudit(pool, { tenantId: req.user.tenant_id, userId: req.user.id, action: 'app.access', entityType: 'app', entityId: row.id, projectId: row.project_id, ip: req.ip, metadata: { access: settings.access, roles: settings.roles, users: settings.userIds.length } });
    res.json({ data: presentApp(await loadApp(req.user, row.id)) });
  }));

  app.post('/api/apps/:id/publish', requireUser, requirePermission('workflows.publish'), wrap(async (req, res) => {
    const row = await loadApp(req.user, req.params.id, true);
    const definition = parse(row.draft_json);
    const validation = validateAppDefinition(definition, await lookups(row.project_id));
    if (validation.errors.length) throw new AppError(400, 'VALIDATION', 'Fix the app before publishing', validation.errors);
    const [[max]] = await pool.query(`SELECT COALESCE(MAX(version_number), 0) AS n FROM app_versions WHERE app_id = ?`, [row.id]);
    const versionId = crypto.randomUUID();
    const versionNumber = Number(max.n) + 1;
    await pool.query(`INSERT INTO app_versions (id, app_id, version_number, definition_json, published_by, published_at) VALUES (?, ?, ?, ?, ?, UTC_TIMESTAMP(3))`, [versionId, row.id, versionNumber, JSON.stringify(definition), req.user.id]);
    await pool.query(`UPDATE apps SET status = 'published', current_version_id = ?, updated_at = UTC_TIMESTAMP(3) WHERE id = ?`, [versionId, row.id]);
    await writeAudit(pool, { tenantId: req.user.tenant_id, userId: req.user.id, action: 'app.publish', entityType: 'app', entityId: row.id, projectId: row.project_id, ip: req.ip, metadata: { version: versionNumber } });
    res.json({ data: presentApp(await loadApp(req.user, row.id), { validation }) });
  }));

  app.post('/api/apps/:id/disable', requireUser, requirePermission('workflows.publish'), wrap(async (req, res) => {
    const row = await loadApp(req.user, req.params.id, true);
    await pool.query(`UPDATE apps SET status = 'disabled', updated_at = UTC_TIMESTAMP(3) WHERE id = ?`, [row.id]);
    await writeAudit(pool, { tenantId: req.user.tenant_id, userId: req.user.id, action: 'app.disable', entityType: 'app', entityId: row.id, projectId: row.project_id, ip: req.ip });
    res.json({ data: presentApp(await loadApp(req.user, row.id)) });
  }));

  app.post('/api/apps/:id/enable', requireUser, requirePermission('workflows.publish'), wrap(async (req, res) => {
    const row = await loadApp(req.user, req.params.id, true);
    if (!row.current_version_id) throw new AppError(409, 'INVALID_STATE', 'Publish the app before turning it on');
    await pool.query(`UPDATE apps SET status = 'published', updated_at = UTC_TIMESTAMP(3) WHERE id = ?`, [row.id]);
    await writeAudit(pool, { tenantId: req.user.tenant_id, userId: req.user.id, action: 'app.enable', entityType: 'app', entityId: row.id, projectId: row.project_id, ip: req.ip });
    res.json({ data: presentApp(await loadApp(req.user, row.id)) });
  }));

  // ---- Runtime ------------------------------------------------------------------------------

  /** Loads the app for a runtime request: { row, definition, preview, builder }. */
  async function openApp(user, id, preview) {
    const [rows] = await pool.query(`${APP_SELECT} WHERE a.id = ? AND a.tenant_id = ?`, [id, user.tenant_id]);
    const row = rows[0];
    if (!row) throw new AppError(404, 'NOT_FOUND', 'App not found');
    const membership = user.role === 'administrator' ? 'administrator' : await membershipOf(user, row.project_id);
    const builder = can(user.role, 'workflows.write') && Boolean(membership);
    if (preview) {
      if (!builder) throw new AppError(403, 'FORBIDDEN', 'Only builders of this project can preview the draft');
      return { row, definition: parse(row.draft_json), preview: true, builder };
    }
    const settings = { ...defaultSettings(), ...(parse(row.settings_json) || {}) };
    if (!canOpenApp(user, settings, membership === 'administrator' ? null : membership)) throw new AppError(403, 'APP_ACCESS_DENIED', 'You do not have access to this app. Ask its owner to share it with you.');
    if (row.status === 'disabled') throw new AppError(409, 'APP_DISABLED', 'This app is turned off');
    if (!row.current_version_id) throw new AppError(409, 'APP_NOT_PUBLISHED', 'This app has not been published yet');
    const [versions] = await pool.query(`SELECT definition_json FROM app_versions WHERE id = ?`, [row.current_version_id]);
    return { row, definition: parse(versions[0].definition_json), preview: false, builder };
  }
  const wantsPreview = (req) => req.query.preview === '1' || req.query.preview === 'true' || req.body?.preview === true;

  app.get('/api/apps/:id/runtime', requireUser, wrap(async (req, res) => {
    const { row, definition, preview, builder } = await openApp(req.user, req.params.id, wantsPreview(req));
    res.json({
      data: {
        app: { id: row.id, name: row.name, description: row.description || '', projectName: row.project_name, status: row.status, versionNumber: preview ? null : row.version_number, publishedAt: row.published_at },
        definition,
        preview,
        canEdit: builder,
        user: { id: req.user.id, name: req.user.display_name, email: req.user.email, role: req.user.role },
      },
    });
  }));

  app.post('/api/apps/:id/runtime/data/:sourceId', requireUser, wrap(async (req, res) => {
    const { row, definition } = await openApp(req.user, req.params.id, wantsPreview(req));
    const source = (definition.dataSources || []).find((item) => item.id === req.params.sourceId);
    if (!source) throw new AppError(404, 'NOT_FOUND', 'Data source not found in this app');
    const config = source.config || {};
    const limit = Math.max(1, Math.min(100, Number(config.limit) || 10));
    const status = config.status ? String(config.status).slice(0, 30) : null;
    const where = (alias, filterColumn) => {
      const parts = [`${alias}.project_id = ?`];
      const params = [row.project_id];
      if (filterColumn && config[filterColumn.key]) { parts.push(`${alias}.${filterColumn.column} = ?`); params.push(String(config[filterColumn.key])); }
      if (status) { parts.push(`UPPER(${alias}.status) = UPPER(?)`); params.push(status); }
      return { sql: parts.join(' AND '), params };
    };
    let rows = [];
    let extra = {};
    if (source.type === 'jobs') {
      const w = where('j', { key: 'workflowId', column: 'workflow_id' });
      const [result] = await pool.query(
        `SELECT j.id, w.name AS workflow, j.status, j.trigger_source, j.error_summary, j.input_json, j.created_at, j.finished_at,
           (SELECT a.output_json FROM job_attempts a WHERE a.job_id = j.id ORDER BY a.attempt_number DESC LIMIT 1) AS output_json
         FROM automation_jobs j JOIN workflows w ON w.id = j.workflow_id WHERE ${w.sql} ORDER BY j.created_at DESC LIMIT ${limit}`, w.params);
      rows = result.map((r) => ({ id: r.id, workflow: r.workflow, status: r.status, triggerSource: r.trigger_source, error: r.error_summary, input: parse(r.input_json) || {}, output: parse(r.output_json) || null, createdAt: r.created_at, finishedAt: r.finished_at }));
    } else if (source.type === 'queue_items') {
      const w = where('i', { key: 'queueId', column: 'queue_id' });
      const [result] = await pool.query(`SELECT i.id, q.name AS queue, i.reference, i.status, i.priority, i.specific_content_json, i.created_at FROM queue_items i JOIN work_queues q ON q.id = i.queue_id WHERE ${w.sql} ORDER BY i.created_at DESC LIMIT ${limit}`, w.params);
      rows = result.map((r) => ({ id: r.id, queue: r.queue, reference: r.reference, status: r.status, priority: r.priority, content: parse(r.specific_content_json) || {}, createdAt: r.created_at }));
    } else if (source.type === 'tasks') {
      const w = where('t');
      const [result] = await pool.query(`SELECT t.* FROM action_tasks t WHERE ${w.sql} ORDER BY t.created_at DESC LIMIT ${limit}`, w.params);
      rows = result.map((r) => { const task = presentTask(r); return { id: task.id, title: task.title, status: task.status, priority: task.priority, type: task.type, outcome: task.outcome ?? null, assignedRole: task.assignedRole ?? null, createdAt: task.createdAt, completedAt: task.completedAt ?? null }; });
    } else if (source.type === 'flow_runs') {
      const w = where('r', { key: 'flowId', column: 'flow_id' });
      const [result] = await pool.query(`SELECT r.id, f.name AS flow, r.status, r.trigger_source, r.variables_json, r.error_summary, r.created_at, r.finished_at FROM flow_runs r JOIN flows f ON f.id = r.flow_id WHERE ${w.sql} ORDER BY r.created_at DESC LIMIT ${limit}`, w.params);
      rows = result.map((r) => ({ id: r.id, flow: r.flow, status: r.status, triggerSource: r.trigger_source, variables: parse(r.variables_json) || {}, error: r.error_summary, createdAt: r.created_at, finishedAt: r.finished_at }));
    } else if (source.type === 'agent_runs') {
      const w = where('r', { key: 'agentId', column: 'agent_id' });
      const [result] = await pool.query(`SELECT r.id, a.name AS agent, r.status, r.title, r.output_json, r.error_message, r.created_at, r.finished_at FROM agent_runs r JOIN agents a ON a.id = r.agent_id WHERE ${w.sql} ORDER BY r.created_at DESC LIMIT ${limit}`, w.params);
      rows = result.map((r) => ({ id: r.id, agent: r.agent, status: r.status, title: r.title, output: parse(r.output_json) || null, error: r.error_message, createdAt: r.created_at, finishedAt: r.finished_at }));
    } else if (source.type === 'http') {
      if (!safePath(config.path) || String(config.path).includes('{{')) throw new AppError(400, 'URL_NOT_ALLOWED', 'The data source path must be a fixed relative path');
      const runtime = createRuntime(pool, cfg, pseudoJob(row));
      try {
        const output = await runtime.httpRequest({ connectionId: config.connectionId, method: 'GET', path: config.path, query: pick(req.body?.query, mappingKeys(config.query)), failOnError: false });
        const body = output?.body;
        rows = Array.isArray(body) ? body : Array.isArray(body?.items) ? body.items : Array.isArray(body?.data) ? body.data : [];
        extra = { status: output?.status, body };
      } finally {
        await runtime.dispose();
      }
    } else {
      throw new AppError(400, 'VALIDATION', `Unknown data source type ${source.type}`);
    }
    res.json({ data: { rows, count: rows.length, loadedAt: new Date().toISOString(), ...extra } });
  }));

  app.post('/api/apps/:id/runtime/actions', requireUser, wrap(async (req, res) => {
    const preview = wantsPreview(req);
    const { row, definition } = await openApp(req.user, req.params.id, preview);
    const body = z.object({ componentId: z.string().max(80), event: z.string().max(30), actionId: z.string().max(80), values: looseObject.optional().default({}) }).safeParse(req.body || {});
    if (!body.success) throw validationError(body.error.issues);
    const found = findAction(definition, body.data.componentId, body.data.event, body.data.actionId);
    if (!found) throw new AppError(404, 'NOT_FOUND', 'This action is not part of the app');
    const { action } = found;
    if (!SERVER_ACTIONS.includes(action.type)) throw new AppError(400, 'VALIDATION', 'This action runs in the browser');
    const config = action.config || {};
    const values = body.data.values;
    const user = req.user;
    const [projects] = await pool.query(`SELECT * FROM projects WHERE id = ?`, [row.project_id]);
    if (projects[0]?.status !== 'active') throw new AppError(409, 'PROJECT_INACTIVE', 'The app’s project is archived');
    let result;
    switch (action.type) {
      case 'run_workflow': {
        const [workflows] = await pool.query(`SELECT * FROM workflows WHERE id = ? AND project_id = ?`, [config.workflowId, row.project_id]);
        if (!workflows[0]) throw new AppError(404, 'WORKFLOW_NOT_FOUND', 'The workflow is not in this project');
        const [versions] = await pool.query(`SELECT * FROM workflow_versions WHERE id = ?`, [workflows[0].current_version_id]);
        if (!versions[0]) throw new AppError(409, 'VERSION_NOT_PUBLISHED', `${workflows[0].name} has no published version`);
        const job = await enqueueJob(pool, cfg, { project: projects[0], workflow: workflows[0], version: versions[0], user, input: pick(values.inputs, mappingKeys(config.inputs)), triggerSource: 'app' });
        await pool.query(`UPDATE automation_jobs SET app_id = ? WHERE id = ?`, [row.id, job.id]);
        result = { kind: 'job', id: job.id, status: job.status, done: false };
        break;
      }
      case 'start_flow': {
        const [flows] = await pool.query(`SELECT * FROM flows WHERE id = ? AND project_id = ?`, [config.flowId, row.project_id]);
        if (!flows[0]) throw new AppError(404, 'FLOW_NOT_FOUND', 'The flow is not in this project');
        const run = await startRun(pool, cfg, { flow: flows[0], user, input: pick(values.inputs, mappingKeys(config.inputs)), triggerSource: 'app' });
        await pool.query(`UPDATE flow_runs SET app_id = ? WHERE id = ?`, [row.id, run.id]);
        result = { kind: 'flow_run', id: run.id, status: run.status, done: run.status !== 'RUNNING', output: parse(run.variables_json) || {}, error: run.error_summary || null };
        break;
      }
      case 'run_agent': {
        const [agents] = await pool.query(`SELECT * FROM agents WHERE id = ? AND project_id = ?`, [config.agentId, row.project_id]);
        const agent = agents[0];
        if (!agent) throw new AppError(404, 'AGENT_NOT_FOUND', 'The agent is not in this project');
        if (agent.status !== 'published' || !agent.current_version_id) throw new AppError(409, 'AGENT_NOT_PUBLISHED', `${agent.name} is not published`);
        const [versions] = await pool.query(`SELECT * FROM agent_versions WHERE id = ?`, [agent.current_version_id]);
        const chat = agent.agent_type === 'conversational';
        const run = await startAgentRun(pool, cfg, {
          agent, config: parse(versions[0].config_json), versionId: versions[0].id, user, source: 'app', mode: chat ? 'chat' : 'task',
          input: chat ? {} : pick(values.inputs, mappingKeys(config.inputs)), message: chat ? String(values.message ?? '').slice(0, 20000) : '',
        });
        await pool.query(`UPDATE agent_runs SET app_id = ? WHERE id = ?`, [row.id, run.id]);
        result = { kind: 'agent_run', id: run.id, status: run.status, done: false };
        break;
      }
      case 'add_queue_item': {
        const queue = await findQueue(pool, { tenantId: row.tenant_id, projectId: row.project_id, queueId: config.queueId });
        const item = await addQueueItem(pool, queue, { reference: values.reference ? String(values.reference).slice(0, 200) : null, specificContent: pick(values.content, mappingKeys(config.content)), priority: config.priority || 'medium', userId: user.id });
        await pool.query(`UPDATE queue_items SET app_id = ? WHERE id = ?`, [row.id, item.id]);
        result = { kind: 'queue_item', id: item.id, status: item.status, done: true, output: { id: item.id, reference: item.reference, queue: queue.name } };
        break;
      }
      case 'create_task': {
        const task = await createTask(pool, pseudoJob(row), `app:${found.component.id}`.slice(0, 80), {
          taskType: 'approval',
          title: String(values.title || config.title || 'Review request').slice(0, 200),
          description: values.description ? String(values.description) : undefined,
          priority: config.priority,
          assignedRole: config.assignedRole || undefined,
          data: pick(values.data, mappingKeys(config.data)),
        });
        await pool.query(`UPDATE action_tasks SET app_id = ? WHERE id = ?`, [row.id, task.id]);
        result = { kind: 'task', id: task.id, status: task.status, done: true, output: { id: task.id, title: task.title } };
        break;
      }
      case 'create_case': {
        const [types] = await pool.query(`SELECT * FROM case_types WHERE id = ? AND project_id = ?`, [config.caseTypeId, row.project_id]);
        if (!types[0]) throw new AppError(404, 'CASE_TYPE_NOT_FOUND', 'The case type is not in this project');
        const created = await createCase(pool, cfg, {
          caseType: types[0], user, title: values.title ? String(values.title).slice(0, 300) : undefined,
          fields: pick(values.fields, mappingKeys(config.fields)), priority: config.priority || undefined, source: 'app', sourceRef: row.id,
        });
        result = { kind: 'case', id: created.id, status: created.status, done: true, output: { id: created.id, reference: created.reference, status: created.status, stage: created.current_stage_id } };
        break;
      }
      case 'call_http': {
        const rendered = String(values.path ?? config.path ?? '');
        const prefix = String(config.path || '/').split('{{')[0];
        const fixed = !String(config.path || '').includes('{{');
        if (!safePath(rendered) || /:\/\/|\.\.|\\/.test(rendered) || (fixed ? rendered !== config.path : !rendered.startsWith(prefix))) throw new AppError(400, 'URL_NOT_ALLOWED', `The path must start with ${prefix}`);
        const method = String(config.method || 'GET').toUpperCase();
        const runtime = createRuntime(pool, cfg, pseudoJob(row));
        try {
          const output = await runtime.httpRequest({
            connectionId: config.connectionId, method, path: rendered,
            query: pick(values.query, mappingKeys(config.query)),
            body: ['POST', 'PUT', 'PATCH'].includes(method) ? pick(values.body, mappingKeys(config.body)) : undefined,
            failOnError: false,
          });
          result = { kind: 'http', id: null, status: output?.status, done: true, output };
        } finally {
          await runtime.dispose();
        }
        break;
      }
      default:
        throw new AppError(400, 'VALIDATION', `Unsupported action ${action.type}`);
    }
    await writeAudit(pool, { tenantId: user.tenant_id, userId: user.id, action: 'app.action', entityType: 'app', entityId: row.id, projectId: row.project_id, ip: req.ip, metadata: { type: action.type, componentId: found.component.id, actionId: action.id, preview, resultKind: result.kind, resultId: result.id } });
    res.json({ data: result });
  }));

  async function loadOwnedRun(user, appRow, kind, runId, builder) {
    const table = { job: 'automation_jobs', flow_run: 'flow_runs', agent_run: 'agent_runs' }[kind];
    if (!table) throw new AppError(404, 'NOT_FOUND', 'Unknown run kind');
    const owner = table === 'automation_jobs' ? 'created_by' : 'started_by';
    const [rows] = await pool.query(`SELECT * FROM ${table} WHERE id = ? AND app_id = ? AND tenant_id = ?`, [runId, appRow.id, appRow.tenant_id]);
    const run = rows[0];
    if (!run || (run[owner] !== user.id && !builder && user.role !== 'administrator')) throw new AppError(404, 'NOT_FOUND', 'Run not found');
    return run;
  }

  async function describeRun(kind, run) {
    if (kind === 'job') {
      const [attempts] = await pool.query(`SELECT output_json FROM job_attempts WHERE job_id = ? ORDER BY attempt_number DESC LIMIT 1`, [run.id]);
      return { kind, id: run.id, status: run.status, done: JOB_DONE.includes(run.status), output: parse(attempts[0]?.output_json) || null, error: run.error_summary || null };
    }
    if (kind === 'flow_run') return { kind, id: run.id, status: run.status, done: run.status !== 'RUNNING', output: parse(run.variables_json) || {}, error: run.error_summary || null };
    const [messages] = await pool.query(`SELECT * FROM agent_messages WHERE run_id = ? AND role IN ('user', 'assistant') ORDER BY seq`, [run.id]);
    const visible = messages.map(presentMessage).filter((message) => message.role === 'user' || (message.content && message.content.trim()));
    return {
      kind, id: run.id, status: run.status, done: AGENT_DONE.includes(run.status) || run.status === 'IDLE',
      output: parse(run.output_json) || null, error: run.error_message || null,
      messages: visible.map((message) => ({ id: message.id, role: message.role, content: message.content, createdAt: message.createdAt })),
    };
  }

  app.get('/api/apps/:id/runtime/runs/:kind/:runId', requireUser, wrap(async (req, res) => {
    const { row, builder } = await openApp(req.user, req.params.id, wantsPreview(req));
    let run = await loadOwnedRun(req.user, row, req.params.kind, req.params.runId, builder);
    if (req.params.kind === 'flow_run' && run.status === 'RUNNING') {
      await advanceRun(pool, cfg, run.id).catch(() => {});
      run = await loadOwnedRun(req.user, row, req.params.kind, run.id, builder);
    }
    if (req.params.kind === 'agent_run' && ['RUNNING', 'WAITING'].includes(run.status)) kickAgentRun(pool, cfg, run.id);
    res.json({ data: await describeRun(req.params.kind, run) });
  }));

  // Agent chat component: starts a conversation with the component's agent, or continues one.
  app.post('/api/apps/:id/runtime/agent-chat', requireUser, wrap(async (req, res) => {
    const { row, definition, builder } = await openApp(req.user, req.params.id, wantsPreview(req));
    const body = z.object({ componentId: z.string().max(80), message: z.string().trim().min(1).max(20000), runId: z.string().uuid().optional() }).safeParse(req.body || {});
    if (!body.success) throw validationError(body.error.issues);
    const found = findComponent(definition, body.data.componentId);
    if (!found || found.component.type !== 'agent_chat') throw new AppError(404, 'NOT_FOUND', 'This chat is not part of the app');
    if (body.data.runId) {
      const run = await loadOwnedRun(req.user, row, 'agent_run', body.data.runId, builder);
      if (run.agent_id !== found.component.props?.agentId) throw new AppError(404, 'NOT_FOUND', 'Run not found');
      const next = await postAgentMessage(pool, cfg, run, req.user, body.data.message);
      res.json({ data: await describeRun('agent_run', next) });
      return;
    }
    const [agents] = await pool.query(`SELECT * FROM agents WHERE id = ? AND project_id = ?`, [found.component.props?.agentId, row.project_id]);
    const agent = agents[0];
    if (!agent || agent.status !== 'published' || !agent.current_version_id) throw new AppError(409, 'AGENT_NOT_PUBLISHED', 'The agent behind this chat is not published');
    const [versions] = await pool.query(`SELECT * FROM agent_versions WHERE id = ?`, [agent.current_version_id]);
    const run = await startAgentRun(pool, cfg, { agent, config: parse(versions[0].config_json), versionId: versions[0].id, user: req.user, source: 'app', mode: 'chat', message: body.data.message });
    await pool.query(`UPDATE agent_runs SET app_id = ? WHERE id = ?`, [row.id, run.id]);
    await writeAudit(pool, { tenantId: req.user.tenant_id, userId: req.user.id, action: 'app.agent_chat', entityType: 'app', entityId: row.id, projectId: row.project_id, ip: req.ip, metadata: { componentId: found.component.id, agentRunId: run.id } });
    res.json({ data: await describeRun('agent_run', { ...run, app_id: row.id }) });
  }));

  // File upload component: stores the file with the project's other artifacts.
  app.post('/api/apps/:id/runtime/files', requireUser, upload.single('file'), wrap(async (req, res) => {
    const { row } = await openApp(req.user, req.params.id, wantsPreview(req));
    if (!req.file) throw validationError([{ path: 'file', message: 'file is required' }]);
    const original = path.basename(req.file.originalname);
    if (!/^[A-Za-z0-9._ -]{1,120}$/.test(original) || !/\.(csv|xlsx|pdf|txt|json|png|jpe?g)$/i.test(original)) {
      throw new AppError(400, 'FILE_TYPE', 'Upload csv, xlsx, pdf, txt, json, png, or jpg files with a simple file name');
    }
    const head = req.file.buffer.subarray(0, 5);
    const extension = original.split('.').pop().toLowerCase();
    if (extension === 'pdf' && head.toString() !== '%PDF-') throw new AppError(400, 'FILE_TYPE', 'The file did not look like a PDF');
    if (extension === 'png' && head.subarray(0, 4).toString('hex') !== '89504e47') throw new AppError(400, 'FILE_TYPE', 'The file did not look like a PNG image');
    if (['jpg', 'jpeg'].includes(extension) && head.subarray(0, 3).toString('hex') !== 'ffd8ff') throw new AppError(400, 'FILE_TYPE', 'The file did not look like a JPG image');
    const relative = path.join('uploads', 'apps', `${crypto.randomUUID()}-${original}`);
    const absolute = resolveInside(path.join(cfg.storageRoot, row.tenant_id, row.project_id), relative);
    await fs.mkdir(path.dirname(absolute), { recursive: true });
    await fs.writeFile(absolute, req.file.buffer);
    const id = crypto.randomUUID();
    await pool.query(
      `INSERT INTO artifacts (id, tenant_id, project_id, file_name, storage_path, mime_type, size_bytes, checksum_sha256, created_by, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, UTC_TIMESTAMP(3))`,
      [id, row.tenant_id, row.project_id, original, relative, req.file.mimetype || 'application/octet-stream', req.file.size, sha256(req.file.buffer), req.user.id],
    );
    await writeAudit(pool, { tenantId: req.user.tenant_id, userId: req.user.id, action: 'app.upload', entityType: 'artifact', entityId: id, projectId: row.project_id, ip: req.ip, metadata: { appId: row.id, size: req.file.size } });
    res.status(201).json({ data: { artifactId: id, fileName: original, size: req.file.size } });
  }));
}
