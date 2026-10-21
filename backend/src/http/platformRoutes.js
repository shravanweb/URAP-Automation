import crypto from 'node:crypto';
import { z } from 'zod';
import { AppError, validationError } from '../lib/errors.js';

// Platform (Super Admin) console. Separate from tenant administration: only users with
// users.is_super_admin = 1 can reach it, and everyone else (tenant admins included, and callers
// without a valid session) gets a plain 404 so the endpoints are not discoverable.
// Read-only views never return secrets, connection values, file contents or audit metadata.

const notFound = () => new AppError(404, 'NOT_FOUND', 'Not found');
const confirmSchema = z.object({ confirm: z.literal(true), reason: z.string().trim().max(500).optional() });
const WORKSPACE_SORTS = { name: 't.name', created: 't.created_at', users: 'users', projects: 'projects', jobs: 'jobs30d', activity: 'last_activity' };

export function registerPlatformRoutes(app, { pool, wrap, paging, requireUser, like }) {
  function requireSuperAdmin(req, res, next) {
    requireUser(req, res, (error) => {
      if (error || !req.user?.is_super_admin) return next(notFound());
      return next();
    });
  }

  async function platformAudit(req, { action, targetType, targetId, targetLabel, tenantId, metadata }) {
    await pool.query(
      `INSERT INTO platform_audit_logs (id, actor_user_id, actor_email, action, target_type, target_id, target_label, tenant_id, metadata_json, ip, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, UTC_TIMESTAMP(3))`,
      [crypto.randomUUID(), req.user.id, req.user.email, action, targetType, targetId || null, targetLabel || null, tenantId || null, metadata ? JSON.stringify(metadata) : null, req.ip || null],
    );
  }

  const confirmed = (req) => {
    const body = confirmSchema.safeParse(req.body || {});
    if (!body.success) throw validationError([{ path: ['confirm'], message: 'Confirm this action by sending confirm: true' }]);
    return body.data;
  };

  app.get('/api/platform/overview', requireSuperAdmin, wrap(async (_req, res) => {
    const [[c]] = await pool.query(`SELECT
        (SELECT COUNT(*) FROM tenants) AS workspaces,
        (SELECT COUNT(*) FROM tenants WHERE status = 'suspended') AS suspended,
        (SELECT COUNT(*) FROM users) AS users,
        (SELECT COUNT(*) FROM users WHERE last_login_at >= DATE_SUB(UTC_TIMESTAMP(3), INTERVAL 7 DAY)) AS active7d,
        (SELECT COUNT(*) FROM projects) AS projects,
        (SELECT COUNT(*) FROM workflows) AS workflows,
        (SELECT COUNT(*) FROM automation_jobs WHERE created_at >= DATE(UTC_TIMESTAMP())) AS jobsToday,
        (SELECT COUNT(*) FROM automation_jobs WHERE created_at >= DATE_SUB(UTC_TIMESTAMP(3), INTERVAL 7 DAY)) AS jobs7d,
        (SELECT COUNT(*) FROM automation_jobs WHERE status = 'FAILED' AND created_at >= DATE_SUB(UTC_TIMESTAMP(3), INTERVAL 7 DAY)) AS failures7d,
        (SELECT COUNT(*) FROM automation_robots WHERE last_heartbeat_at >= DATE_SUB(UTC_TIMESTAMP(3), INTERVAL 60 SECOND)) AS robotsOnline,
        (SELECT COUNT(*) FROM automation_robots) AS robots`);
    const [series] = await pool.query(
      `SELECT DATE_FORMAT(created_at, '%Y-%m-%d') AS day, COUNT(*) AS n FROM tenants
       WHERE created_at >= DATE_SUB(UTC_TIMESTAMP(3), INTERVAL 30 DAY) GROUP BY day ORDER BY day`);
    const [userSeries] = await pool.query(
      `SELECT DATE_FORMAT(created_at, '%Y-%m-%d') AS day, COUNT(*) AS n FROM users
       WHERE created_at >= DATE_SUB(UTC_TIMESTAMP(3), INTERVAL 30 DAY) GROUP BY day ORDER BY day`);
    const kpis = Object.fromEntries(Object.entries(c).map(([k, v]) => [k, Number(v)]));
    res.json({ data: { kpis, signups: series.map((r) => ({ day: r.day, workspaces: Number(r.n) })), newUsers: userSeries.map((r) => ({ day: r.day, users: Number(r.n) })) } });
  }));

  const WORKSPACE_SELECT = `SELECT t.id, t.name, t.slug, t.status, t.created_at, t.suspended_at, t.suspended_reason,
      (SELECT u.email FROM users u WHERE u.tenant_id = t.id AND u.role = 'administrator' ORDER BY u.created_at LIMIT 1) AS owner_email,
      (SELECT COUNT(*) FROM users u WHERE u.tenant_id = t.id) AS users,
      (SELECT COUNT(*) FROM projects p WHERE p.tenant_id = t.id) AS projects,
      (SELECT COUNT(*) FROM automation_jobs j WHERE j.tenant_id = t.id AND j.created_at >= DATE_SUB(UTC_TIMESTAMP(3), INTERVAL 30 DAY)) AS jobs30d,
      (SELECT MAX(a.created_at) FROM audit_logs a WHERE a.tenant_id = t.id) AS last_activity
    FROM tenants t`;
  const presentWorkspace = (r) => ({
    id: r.id, name: r.name, slug: r.slug, status: r.status, createdAt: r.created_at, suspendedAt: r.suspended_at, suspendedReason: r.suspended_reason,
    ownerEmail: r.owner_email, users: Number(r.users), projects: Number(r.projects), jobs30d: Number(r.jobs30d), lastActivityAt: r.last_activity,
  });

  app.get('/api/platform/workspaces', requireSuperAdmin, wrap(async (req, res) => {
    const { limit, offset } = paging(req.query);
    const where = []; const params = [];
    if (req.query.q) {
      where.push(`(t.name LIKE ? OR t.slug LIKE ? OR t.id = ? OR EXISTS (SELECT 1 FROM users u WHERE u.tenant_id = t.id AND u.email LIKE ?))`);
      params.push(like(req.query.q), like(req.query.q), String(req.query.q), like(req.query.q));
    }
    if (req.query.status === 'active' || req.query.status === 'suspended') { where.push('t.status = ?'); params.push(req.query.status); }
    const clause = where.length ? ` WHERE ${where.join(' AND ')}` : '';
    const sort = WORKSPACE_SORTS[req.query.sort] || 't.created_at';
    const dir = req.query.dir === 'asc' ? 'ASC' : 'DESC';
    const [[count]] = await pool.query(`SELECT COUNT(*) AS n FROM tenants t${clause}`, params);
    const [rows] = await pool.query(`SELECT * FROM (${WORKSPACE_SELECT}${clause}) t ORDER BY ${sort.replace('t.', '')} ${dir}, id LIMIT ${limit} OFFSET ${offset}`, params);
    res.json({ data: rows.map(presentWorkspace), meta: { limit, offset, total: Number(count.n) } });
  }));

  async function loadWorkspace(id) {
    const [rows] = await pool.query(`${WORKSPACE_SELECT} WHERE t.id = ?`, [id]);
    if (!rows[0]) throw new AppError(404, 'NOT_FOUND', 'Workspace not found');
    return rows[0];
  }

  app.get('/api/platform/workspaces/:id', requireSuperAdmin, wrap(async (req, res) => {
    const ws = await loadWorkspace(req.params.id);
    const id = ws.id;
    const [members] = await pool.query(`SELECT id, display_name, email, role, status, is_super_admin, created_at, last_login_at FROM users WHERE tenant_id = ? ORDER BY role = 'administrator' DESC, display_name LIMIT 500`, [id]);
    const [projects] = await pool.query(
      `SELECT p.id, p.name, p.status, p.created_at, (SELECT COUNT(*) FROM workflows w WHERE w.project_id = p.id) AS workflows,
              (SELECT COUNT(*) FROM project_members m WHERE m.project_id = p.id) AS members
       FROM projects p WHERE p.tenant_id = ? ORDER BY p.created_at DESC LIMIT 200`, [id]);
    const [jobs] = await pool.query(
      `SELECT j.id, j.status, j.trigger_source, j.created_at, j.finished_at, w.name AS workflow_name, p.name AS project_name
       FROM automation_jobs j LEFT JOIN workflows w ON w.id = j.workflow_id LEFT JOIN projects p ON p.id = j.project_id
       WHERE j.tenant_id = ? ORDER BY j.created_at DESC LIMIT 20`, [id]);
    const [robots] = await pool.query(
      `SELECT id, name, adapter, last_heartbeat_at, last_heartbeat_at >= DATE_SUB(UTC_TIMESTAMP(3), INTERVAL 60 SECOND) AS online
       FROM automation_robots WHERE tenant_id = ? ORDER BY name`, [id]);
    // Audit trail without metadata or IPs: action, entity type, who and when.
    const [audit] = await pool.query(
      `SELECT a.id, a.action, a.entity_type, a.result, a.created_at, u.email AS actor_email
       FROM audit_logs a LEFT JOIN users u ON u.id = a.actor_user_id WHERE a.tenant_id = ? ORDER BY a.created_at DESC LIMIT 50`, [id]);
    res.json({ data: {
      workspace: presentWorkspace(ws),
      members: members.map((m) => ({ id: m.id, name: m.display_name, email: m.email, role: m.role, status: m.status, isSuperAdmin: Boolean(m.is_super_admin), createdAt: m.created_at, lastLoginAt: m.last_login_at })),
      projects: projects.map((p) => ({ id: p.id, name: p.name, status: p.status, createdAt: p.created_at, workflows: Number(p.workflows), members: Number(p.members) })),
      jobs: jobs.map((j) => ({ id: j.id, status: j.status, trigger: j.trigger_source, createdAt: j.created_at, finishedAt: j.finished_at, workflow: j.workflow_name, project: j.project_name })),
      robots: robots.map((r) => ({ id: r.id, name: r.name, adapter: r.adapter, online: Boolean(r.online), lastHeartbeatAt: r.last_heartbeat_at })),
      audit: audit.map((a) => ({ id: a.id, action: a.action, entityType: a.entity_type, result: a.result || 'success', actorEmail: a.actor_email, createdAt: a.created_at })),
    } });
  }));

  app.get('/api/platform/users', requireSuperAdmin, wrap(async (req, res) => {
    const { limit, offset } = paging(req.query);
    const where = []; const params = [];
    if (req.query.q) { where.push('(u.email LIKE ? OR u.display_name LIKE ? OR t.name LIKE ?)'); params.push(like(req.query.q), like(req.query.q), like(req.query.q)); }
    if (req.query.tenantId) { where.push('u.tenant_id = ?'); params.push(String(req.query.tenantId)); }
    if (req.query.role) { where.push('u.role = ?'); params.push(String(req.query.role)); }
    if (req.query.status === 'active' || req.query.status === 'disabled') { where.push('u.status = ?'); params.push(req.query.status); }
    if (req.query.superAdmin === 'true') where.push('u.is_super_admin = 1');
    const clause = where.length ? ` WHERE ${where.join(' AND ')}` : '';
    const [[count]] = await pool.query(`SELECT COUNT(*) AS n FROM users u JOIN tenants t ON t.id = u.tenant_id${clause}`, params);
    const [rows] = await pool.query(
      `SELECT u.id, u.display_name, u.email, u.role, u.status, u.is_super_admin, u.created_at, u.last_login_at, t.id AS tenant_id, t.name AS tenant_name, t.status AS tenant_status
       FROM users u JOIN tenants t ON t.id = u.tenant_id${clause} ORDER BY u.created_at DESC, u.id LIMIT ${limit} OFFSET ${offset}`, params);
    res.json({ data: rows.map((u) => ({ id: u.id, name: u.display_name, email: u.email, role: u.role, status: u.status, isSuperAdmin: Boolean(u.is_super_admin), createdAt: u.created_at, lastLoginAt: u.last_login_at, workspace: { id: u.tenant_id, name: u.tenant_name, status: u.tenant_status } })), meta: { limit, offset, total: Number(count.n) } });
  }));

  app.get('/api/platform/audit', requireSuperAdmin, wrap(async (req, res) => {
    const { limit, offset } = paging(req.query);
    const [[count]] = await pool.query(`SELECT COUNT(*) AS n FROM platform_audit_logs`);
    const [rows] = await pool.query(`SELECT * FROM platform_audit_logs ORDER BY created_at DESC, id LIMIT ${limit} OFFSET ${offset}`);
    res.json({ data: rows.map((r) => ({ id: r.id, action: r.action, actorEmail: r.actor_email, targetType: r.target_type, targetId: r.target_id, targetLabel: r.target_label, tenantId: r.tenant_id, metadata: typeof r.metadata_json === 'string' ? JSON.parse(r.metadata_json) : r.metadata_json, ip: r.ip, createdAt: r.created_at })), meta: { limit, offset, total: Number(count.n) } });
  }));

  async function setWorkspaceStatus(req, res, status) {
    const { reason } = confirmed(req);
    const ws = await loadWorkspace(req.params.id);
    if (status === 'suspended' && ws.id === req.user.tenant_id) throw new AppError(409, 'OWN_WORKSPACE', 'You cannot suspend your own workspace.');
    await pool.query(
      `UPDATE tenants SET status = ?, suspended_at = ${status === 'suspended' ? 'UTC_TIMESTAMP(3)' : 'NULL'}, suspended_reason = ?, updated_at = UTC_TIMESTAMP(3) WHERE id = ?`,
      [status, status === 'suspended' ? reason || null : null, ws.id],
    );
    if (status === 'suspended') {
      await pool.query(`UPDATE refresh_tokens SET revoked_at = UTC_TIMESTAMP(3) WHERE revoked_at IS NULL AND user_id IN (SELECT id FROM users WHERE tenant_id = ?)`, [ws.id]);
    }
    await platformAudit(req, { action: status === 'suspended' ? 'workspace.suspend' : 'workspace.reactivate', targetType: 'workspace', targetId: ws.id, targetLabel: ws.name, tenantId: ws.id, metadata: reason ? { reason } : null });
    res.json({ data: presentWorkspace(await loadWorkspace(ws.id)) });
  }
  app.post('/api/platform/workspaces/:id/suspend', requireSuperAdmin, wrap((req, res) => setWorkspaceStatus(req, res, 'suspended')));
  app.post('/api/platform/workspaces/:id/reactivate', requireSuperAdmin, wrap((req, res) => setWorkspaceStatus(req, res, 'active')));

  async function loadUser(id) {
    const [rows] = await pool.query(`SELECT id, email, tenant_id, status, is_super_admin FROM users WHERE id = ?`, [id]);
    if (!rows[0]) throw new AppError(404, 'NOT_FOUND', 'User not found');
    return rows[0];
  }
  async function superAdminCount() {
    const [[row]] = await pool.query(`SELECT COUNT(*) AS n FROM users WHERE is_super_admin = 1 AND status = 'active'`);
    return Number(row.n);
  }

  async function setUserStatus(req, res, status) {
    confirmed(req);
    const user = await loadUser(req.params.id);
    if (user.id === req.user.id) throw new AppError(409, 'SELF', 'You cannot change your own account here.');
    if (status === 'disabled' && user.is_super_admin) throw new AppError(409, 'SUPER_ADMIN', 'Revoke super admin first, then disable the account.');
    await pool.query(`UPDATE users SET status = ?, updated_at = UTC_TIMESTAMP(3) WHERE id = ?`, [status, user.id]);
    if (status === 'disabled') await pool.query(`UPDATE refresh_tokens SET revoked_at = UTC_TIMESTAMP(3) WHERE user_id = ? AND revoked_at IS NULL`, [user.id]);
    await platformAudit(req, { action: status === 'disabled' ? 'user.disable' : 'user.enable', targetType: 'user', targetId: user.id, targetLabel: user.email, tenantId: user.tenant_id });
    res.json({ data: { id: user.id, status } });
  }
  app.post('/api/platform/users/:id/disable', requireSuperAdmin, wrap((req, res) => setUserStatus(req, res, 'disabled')));
  app.post('/api/platform/users/:id/enable', requireSuperAdmin, wrap((req, res) => setUserStatus(req, res, 'active')));

  async function setSuperAdmin(req, res, grant) {
    confirmed(req);
    const user = await loadUser(req.params.id);
    if (!grant && user.id === req.user.id) throw new AppError(409, 'SELF', 'You cannot revoke your own super admin access.');
    if (grant && user.status !== 'active') throw new AppError(409, 'INACTIVE', 'Enable the account before granting super admin.');
    if (!grant && user.is_super_admin && (await superAdminCount()) <= 1) throw new AppError(409, 'LAST_SUPER_ADMIN', 'At least one super admin must remain.');
    await pool.query(`UPDATE users SET is_super_admin = ?, updated_at = UTC_TIMESTAMP(3) WHERE id = ?`, [grant ? 1 : 0, user.id]);
    await platformAudit(req, { action: grant ? 'super_admin.grant' : 'super_admin.revoke', targetType: 'user', targetId: user.id, targetLabel: user.email, tenantId: user.tenant_id });
    res.json({ data: { id: user.id, isSuperAdmin: grant } });
  }
  app.post('/api/platform/users/:id/grant-super-admin', requireSuperAdmin, wrap((req, res) => setSuperAdmin(req, res, true)));
  app.post('/api/platform/users/:id/revoke-super-admin', requireSuperAdmin, wrap((req, res) => setSuperAdmin(req, res, false)));

  // Any other /api/platform path is also a 404 for everyone.
  app.all('/api/platform/*', (_req, _res, next) => next(notFound()));
}
