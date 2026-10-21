import { stringify } from 'csv-stringify/sync';
import { z } from 'zod';
import { validationError } from '../lib/errors.js';

// Entity name resolution: one query per entity type present on the page (never per row).
const ENTITY_SOURCES = {
  workflow: { table: 'workflows', name: 'name' },
  project: { table: 'projects', name: 'name' },
  job: { sql: `SELECT j.id, w.name AS name, j.workflow_id AS parent_id FROM automation_jobs j LEFT JOIN workflows w ON w.id = j.workflow_id` },
  flow: { table: 'flows', name: 'name' },
  flow_run: { sql: `SELECT r.id, f.name AS name, r.flow_id AS parent_id FROM flow_runs r LEFT JOIN flows f ON f.id = r.flow_id` },
  agent: { table: 'agents', name: 'name' },
  agent_run: { sql: `SELECT r.id, COALESCE(NULLIF(r.title, ''), a.name) AS name, r.agent_id AS parent_id FROM agent_runs r LEFT JOIN agents a ON a.id = r.agent_id` },
  app: { table: 'apps', name: 'name' },
  case_type: { table: 'case_types', name: 'name' },
  case: { sql: `SELECT c.id, CONCAT(c.reference, ' · ', c.title) AS name, NULL AS parent_id FROM cases c` },
  bpmn_process: { table: 'bpmn_processes', name: 'name' },
  work_queue: { table: 'work_queues', name: 'name' },
  queue_item: { sql: `SELECT i.id, COALESCE(i.reference, q.name) AS name, i.queue_id AS parent_id FROM queue_items i LEFT JOIN work_queues q ON q.id = i.queue_id` },
  task: { table: 'action_tasks', name: 'title' },
  schedule: { table: 'schedules', name: 'name' },
  connection: { table: 'connections', name: 'name' },
  robot: { table: 'automation_robots', name: 'name' },
  user: { table: 'users', name: 'display_name' },
};

export const AUDIT_CATEGORIES = ['auth', 'workflow', 'job', 'task', 'project', 'user', 'connection', 'schedule', 'queue', 'flow', 'agent', 'app', 'case', 'bpmn', 'robot', 'recorder'];

const filterSchema = z.object({
  q: z.string().trim().max(200).optional(),
  category: z.string().trim().max(40).optional(),
  action: z.string().trim().max(80).optional(),
  userId: z.string().trim().max(36).optional(),
  entityType: z.string().trim().max(40).optional(),
  projectId: z.string().trim().max(36).optional(),
  result: z.enum(['success', 'failure']).optional(),
  from: z.string().datetime({ offset: true }).optional(),
  to: z.string().datetime({ offset: true }).optional(),
}).passthrough();

function sqlTime(iso) { return new Date(iso).toISOString().slice(0, 23).replace('T', ' '); }

export function registerAuditRoutes(app, { pool, wrap, paging, requireUser, scope, like, auditScope, csvCell }) {
  async function buildWhere(req) {
    const parsed = filterSchema.safeParse(Object.fromEntries(Object.entries(req.query).filter(([, v]) => v !== '')));
    if (!parsed.success) throw validationError(parsed.error.issues);
    const f = parsed.data;
    const range = await scope(req.user);
    const visible = auditScope(range, req.user);
    const where = ['a.tenant_id = ?', visible.sql.replaceAll('project_id', 'a.project_id').replaceAll('actor_user_id', 'a.actor_user_id')];
    const params = [req.user.tenant_id, ...visible.params];
    if (f.category) {
      // "flow" must not match "flow_run"? It should: categories group by the action prefix family.
      where.push(`(a.action LIKE ? OR a.action LIKE ?)`); params.push(`${f.category}.%`, `${f.category}\\_%`);
    }
    if (f.action) { where.push(`a.action LIKE ? ESCAPE '\\\\'`); params.push(like(f.action)); }
    if (f.userId) { where.push('a.actor_user_id = ?'); params.push(f.userId); }
    if (f.entityType) { where.push('a.entity_type = ?'); params.push(f.entityType); }
    if (f.projectId) { where.push('a.project_id = ?'); params.push(f.projectId); }
    if (f.result) { where.push('a.result = ?'); params.push(f.result); }
    if (f.from) { where.push('a.created_at >= ?'); params.push(sqlTime(f.from)); }
    if (f.to) { where.push('a.created_at < ?'); params.push(sqlTime(f.to)); }
    if (f.q) {
      const term = like(f.q);
      where.push(`(a.action LIKE ? ESCAPE '\\\\' OR a.entity_type LIKE ? ESCAPE '\\\\' OR a.entity_id LIKE ? ESCAPE '\\\\' OR u.email LIKE ? ESCAPE '\\\\' OR u.display_name LIKE ? ESCAPE '\\\\' OR a.ip_address LIKE ? ESCAPE '\\\\' OR a.request_id LIKE ? ESCAPE '\\\\')`);
      params.push(term, term, term, term, term, term, term);
    }
    return { where: where.join(' AND '), params };
  }

  const SELECT = `SELECT a.id, a.actor_user_id, u.email AS actor_email, u.display_name AS actor_name, a.actor_robot_id, r.name AS actor_robot_name,
      a.action, a.entity_type, a.entity_id, a.project_id, p.name AS project_name, a.metadata_json, a.ip_address, a.user_agent, a.request_id, a.result, a.created_at
    FROM audit_logs a
    LEFT JOIN users u ON u.id = a.actor_user_id
    LEFT JOIN automation_robots r ON r.id = a.actor_robot_id
    LEFT JOIN projects p ON p.id = a.project_id`;

  async function resolveEntities(rows, tenantId) {
    const byType = new Map();
    for (const row of rows) {
      if (!row.entity_id || !ENTITY_SOURCES[row.entity_type]) continue;
      if (!byType.has(row.entity_type)) byType.set(row.entity_type, new Set());
      byType.get(row.entity_type).add(row.entity_id);
    }
    const names = new Map();
    for (const [type, ids] of byType) {
      const src = ENTITY_SOURCES[type];
      const list = [...ids];
      const marks = list.map(() => '?').join(',');
      const base = src.sql || `SELECT t.id, t.${src.name} AS name, NULL AS parent_id FROM ${src.table} t`;
      const alias = base.match(/FROM \w+ (\w+)/)[1];
      try {
        const [found] = await pool.query(`${base} WHERE ${alias}.id IN (${marks}) AND ${alias}.tenant_id = ?`, [...list, tenantId]);
        for (const item of found) names.set(`${type}:${item.id}`, { name: item.name, parentId: item.parent_id });
      } catch {
        // Tables without tenant_id (or missing in older schemas): fall back to an id-only lookup.
        try {
          const [found] = await pool.query(`${base} WHERE ${alias}.id IN (${marks})`, list);
          for (const item of found) names.set(`${type}:${item.id}`, { name: item.name, parentId: item.parent_id });
        } catch { /* leave unresolved */ }
      }
    }
    return names;
  }

  function present(row, names) {
    const resolved = names.get(`${row.entity_type}:${row.entity_id}`);
    let metadata = row.metadata_json;
    if (typeof metadata === 'string') { try { metadata = JSON.parse(metadata); } catch { /* keep text */ } }
    return {
      id: row.id,
      createdAt: row.created_at,
      action: row.action,
      category: String(row.action).split(/[._]/)[0],
      result: row.result || null,
      actor: row.actor_user_id
        ? { type: 'user', id: row.actor_user_id, name: row.actor_name || null, email: row.actor_email || null }
        : row.actor_robot_id ? { type: 'robot', id: row.actor_robot_id, name: row.actor_robot_name || null, email: null } : { type: 'system', id: null, name: 'System', email: null },
      entity: { type: row.entity_type, id: row.entity_id, name: resolved?.name ?? null, parentId: resolved?.parentId ?? null, exists: Boolean(resolved) },
      project: row.project_id ? { id: row.project_id, name: row.project_name || null } : null,
      metadata: metadata && typeof metadata === 'object' && Object.keys(metadata).length ? metadata : null,
      ip: row.ip_address || null,
      userAgent: row.user_agent || null,
      requestId: row.request_id || null,
      // Flat fields kept for existing API consumers.
      actor_user_id: row.actor_user_id, actor_email: row.actor_email || null, actor_robot_id: row.actor_robot_id,
      entity_type: row.entity_type, entity_id: row.entity_id, project_id: row.project_id, created_at: row.created_at,
    };
  }

  app.get('/api/audit', requireUser, wrap(async (req, res) => {
    const { limit, offset } = paging(req.query);
    const { where, params } = await buildWhere(req);
    const [[count]] = await pool.query(`SELECT COUNT(*) AS total FROM audit_logs a LEFT JOIN users u ON u.id = a.actor_user_id WHERE ${where}`, params);
    const [rows] = await pool.query(`${SELECT} WHERE ${where} ORDER BY a.created_at DESC, a.id DESC LIMIT ${limit} OFFSET ${offset}`, params);
    const names = await resolveEntities(rows, req.user.tenant_id);
    res.json({ data: rows.map((row) => present(row, names)), meta: { limit, offset, total: Number(count.total) } });
  }));

  // Headline numbers for the page. `since` is the client's local midnight so "today" matches the user's zone.
  app.get('/api/audit/summary', requireUser, wrap(async (req, res) => {
    const since = z.string().datetime({ offset: true }).safeParse(req.query.since);
    const from = since.success ? sqlTime(since.data) : sqlTime(new Date(Date.now() - 86400000).toISOString());
    const range = await scope(req.user);
    const visible = auditScope(range, req.user);
    const where = `a.tenant_id = ? AND ${visible.sql.replaceAll('project_id', 'a.project_id').replaceAll('actor_user_id', 'a.actor_user_id')} AND a.created_at >= ?`;
    const [[row]] = await pool.query(
      `SELECT COUNT(*) AS events,
              SUM(a.action = 'auth.login' AND COALESCE(a.result, 'success') = 'success') AS sign_ins,
              SUM(a.result = 'failure' OR a.action LIKE '%fail%') AS failures,
              COUNT(DISTINCT a.actor_user_id) AS users
       FROM audit_logs a WHERE ${where}`,
      [req.user.tenant_id, ...visible.params, from],
    );
    res.json({ data: { events: Number(row.events || 0), signIns: Number(row.sign_ins || 0), failures: Number(row.failures || 0), uniqueUsers: Number(row.users || 0) } });
  }));

  // Options for the filter dropdowns, limited to what this user can see.
  app.get('/api/audit/facets', requireUser, wrap(async (req, res) => {
    const range = await scope(req.user);
    const visible = auditScope(range, req.user);
    const where = `a.tenant_id = ? AND ${visible.sql.replaceAll('project_id', 'a.project_id').replaceAll('actor_user_id', 'a.actor_user_id')}`;
    const params = [req.user.tenant_id, ...visible.params];
    const [users] = await pool.query(`SELECT DISTINCT u.id, u.display_name, u.email FROM audit_logs a JOIN users u ON u.id = a.actor_user_id WHERE ${where} ORDER BY u.display_name LIMIT 500`, params);
    const [types] = await pool.query(`SELECT DISTINCT a.entity_type FROM audit_logs a WHERE ${where} ORDER BY a.entity_type`, params);
    const [actions] = await pool.query(`SELECT DISTINCT a.action FROM audit_logs a WHERE ${where} ORDER BY a.action`, params);
    const categories = [...new Set(actions.map((r) => String(r.action).split(/[._]/)[0]))].sort();
    res.json({ data: { users: users.map((u) => ({ id: u.id, name: u.display_name, email: u.email })), entityTypes: types.map((t) => t.entity_type), categories } });
  }));

  app.get('/api/audit/export.csv', requireUser, wrap(async (req, res) => {
    const { where, params } = await buildWhere(req);
    const [rows] = await pool.query(`${SELECT} WHERE ${where} ORDER BY a.created_at DESC, a.id DESC LIMIT 10000`, params);
    const names = await resolveEntities(rows, req.user.tenant_id);
    const items = rows.map((row) => present(row, names));
    const csv = stringify([
      ['time_utc', 'action', 'result', 'actor_name', 'actor_email', 'entity_type', 'entity_name', 'entity_id', 'project', 'ip', 'user_agent', 'request_id'],
      ...items.map((i) => [new Date(i.createdAt).toISOString(), i.action, i.result || '', i.actor.name || '', i.actor.email || '', i.entity.type, i.entity.name || '', i.entity.id || '', i.project?.name || '', i.ip || '', i.userAgent || '', i.requestId || ''].map(csvCell)),
    ]);
    res.set('Content-Type', 'text/csv; charset=utf-8');
    res.set('Content-Disposition', 'attachment; filename="audit-log.csv"');
    res.send(csv);
  }));
}
