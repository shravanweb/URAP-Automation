import { z } from 'zod';
import { validationError } from '../lib/errors.js';
import { effectiveBcryptRounds } from '../lib/security.js';

export const JOB_STATUSES = ['DRAFT', 'QUEUED', 'CLAIMED', 'RUNNING', 'SUCCEEDED', 'FAILED', 'RETRY_WAIT', 'CANCEL_REQUESTED', 'CANCELLED', 'SKIPPED', 'SUSPENDED'];
export const JOB_TRIGGERS = ['manual', 'schedule', 'api', 'retry', 'test', 'queue', 'flow', 'agent', 'app', 'case'];

const filterSchema = z.object({
  projectId: z.string().trim().max(36).optional(),
  workflowId: z.string().trim().max(36).optional(),
  status: z.enum(JOB_STATUSES).optional(),
  trigger: z.enum(JOB_TRIGGERS).optional(),
  from: z.string().datetime({ offset: true }).optional(),
  to: z.string().datetime({ offset: true }).optional(),
  // Minutes east of UTC for day buckets (IST = 330).
  tzOffset: z.coerce.number().int().min(-840).max(840).optional(),
}).passthrough();

const sqlTime = (iso) => new Date(iso).toISOString().slice(0, 23).replace('T', ' ');
const DURATION = `CASE WHEN j.started_at IS NOT NULL AND j.finished_at IS NOT NULL THEN TIMESTAMPDIFF(MICROSECOND, j.started_at, j.finished_at) DIV 1000 END`;

function host(url) {
  try { return url ? new URL(url).host : null; } catch { return null; }
}

export function registerInsightsRoutes(app, { pool, cfg, wrap, paging, requireUser, scope, scopeSql }) {
  async function jobFilters(req) {
    const parsed = filterSchema.safeParse(Object.fromEntries(Object.entries(req.query).filter(([, v]) => v !== '')));
    if (!parsed.success) throw validationError(parsed.error.issues);
    const f = parsed.data;
    const range = scope ? await scope(req.user) : { all: true, ids: [] };
    const s = scopeSql(range, 'j.project_id');
    const where = ['j.tenant_id = ?', s.sql];
    const params = [req.user.tenant_id, ...s.params];
    if (f.projectId) { where.push('j.project_id = ?'); params.push(f.projectId); }
    if (f.workflowId) { where.push('j.workflow_id = ?'); params.push(f.workflowId); }
    if (f.status) { where.push('j.status = ?'); params.push(f.status); }
    if (f.trigger) { where.push('j.trigger_source = ?'); params.push(f.trigger); }
    if (f.from) { where.push('j.created_at >= ?'); params.push(sqlTime(f.from)); }
    if (f.to) { where.push('j.created_at < ?'); params.push(sqlTime(f.to)); }
    return { where: where.join(' AND '), params, tz: f.tzOffset ?? 0 };
  }

  app.get('/api/reports/summary', requireUser, wrap(async (req, res) => {
    const { where, params, tz } = await jobFilters(req);
    const [[k]] = await pool.query(
      `SELECT COUNT(*) AS total, SUM(j.status = 'SUCCEEDED') AS succeeded, SUM(j.status = 'FAILED') AS failed,
              SUM(j.status IN ('QUEUED','CLAIMED','RUNNING','RETRY_WAIT','CANCEL_REQUESTED','SUSPENDED')) AS active,
              AVG(${DURATION}) AS avg_ms,
              SUM(DATE(DATE_ADD(j.created_at, INTERVAL ? MINUTE)) = DATE(DATE_ADD(UTC_TIMESTAMP(3), INTERVAL ? MINUTE))) AS today
       FROM automation_jobs j WHERE ${where}`, [tz, tz, ...params]);
    const [days] = await pool.query(
      `SELECT DATE_FORMAT(DATE_ADD(j.created_at, INTERVAL ? MINUTE), '%Y-%m-%d') AS day,
              SUM(j.status = 'SUCCEEDED') AS succeeded, SUM(j.status = 'FAILED') AS failed, COUNT(*) AS total
       FROM automation_jobs j WHERE ${where} GROUP BY day ORDER BY day LIMIT 400`, [tz, ...params]);
    const [statuses] = await pool.query(`SELECT j.status, COUNT(*) AS n FROM automation_jobs j WHERE ${where} GROUP BY j.status ORDER BY n DESC`, params);
    const [workflows] = await pool.query(
      `SELECT j.workflow_id AS id, w.name, COUNT(*) AS total, SUM(j.status = 'SUCCEEDED') AS succeeded, SUM(j.status = 'FAILED') AS failed, AVG(${DURATION}) AS avg_ms
       FROM automation_jobs j LEFT JOIN workflows w ON w.id = j.workflow_id WHERE ${where}
       GROUP BY j.workflow_id, w.name ORDER BY total DESC LIMIT 8`, params);
    const [projects] = await pool.query(
      `SELECT j.project_id AS id, p.name, COUNT(*) AS total, SUM(j.status = 'FAILED') AS failed
       FROM automation_jobs j LEFT JOIN projects p ON p.id = j.project_id WHERE ${where}
       GROUP BY j.project_id, p.name ORDER BY total DESC LIMIT 8`, params);
    const total = Number(k.total || 0); const succeeded = Number(k.succeeded || 0); const failed = Number(k.failed || 0);
    const finished = succeeded + failed;
    res.json({ data: {
      kpis: { total, succeeded, failed, active: Number(k.active || 0), today: Number(k.today || 0), successRate: finished ? Math.round((succeeded / finished) * 1000) / 10 : null, avgDurationMs: k.avg_ms == null ? null : Math.round(Number(k.avg_ms)) },
      series: days.map((d) => ({ day: d.day, succeeded: Number(d.succeeded), failed: Number(d.failed), total: Number(d.total) })),
      statuses: statuses.map((s) => ({ status: s.status, count: Number(s.n) })),
      workflows: workflows.map((w) => ({ id: w.id, name: w.name || 'Deleted workflow', total: Number(w.total), succeeded: Number(w.succeeded), failed: Number(w.failed), avgDurationMs: w.avg_ms == null ? null : Math.round(Number(w.avg_ms)) })),
      projects: projects.map((p) => ({ id: p.id, name: p.name || 'Deleted project', total: Number(p.total), failed: Number(p.failed) })),
    } });
  }));

  app.get('/api/reports/jobs', requireUser, wrap(async (req, res) => {
    const { limit, offset } = paging(req.query);
    const { where, params } = await jobFilters(req);
    const [[count]] = await pool.query(`SELECT COUNT(*) AS total FROM automation_jobs j WHERE ${where}`, params);
    const [rows] = await pool.query(
      `SELECT j.id, j.project_id, p.name AS project_name, j.workflow_id, w.name AS workflow_name, v.version_number,
              j.trigger_source, j.execution_target, j.status, j.current_attempt, j.queued_at, j.started_at, j.finished_at, j.created_at,
              ${DURATION} AS duration_ms, j.error_summary, j.created_by, u.display_name AS created_by_name, u.email AS created_by_email,
              j.robot_id, r.name AS robot_name
       FROM automation_jobs j
       LEFT JOIN projects p ON p.id = j.project_id
       LEFT JOIN workflows w ON w.id = j.workflow_id
       LEFT JOIN workflow_versions v ON v.id = j.workflow_version_id
       LEFT JOIN users u ON u.id = j.created_by
       LEFT JOIN automation_robots r ON r.id = j.robot_id
       WHERE ${where} ORDER BY j.created_at DESC, j.id DESC LIMIT ${limit} OFFSET ${offset}`, params);
    res.json({ data: rows.map((r) => ({
      id: r.id, status: r.status, trigger: r.trigger_source, target: r.execution_target, attempt: r.current_attempt,
      project: { id: r.project_id, name: r.project_name }, workflow: { id: r.workflow_id, name: r.workflow_name, version: r.version_number },
      queuedAt: r.queued_at, startedAt: r.started_at, finishedAt: r.finished_at, createdAt: r.created_at,
      durationMs: r.duration_ms == null ? null : Number(r.duration_ms), error: r.error_summary || null,
      startedBy: r.created_by ? { id: r.created_by, name: r.created_by_name, email: r.created_by_email } : null,
      robot: r.robot_id ? { id: r.robot_id, name: r.robot_name } : null,
    })), meta: { limit, offset, total: Number(count.total) } });
  }));

  // Read-only settings overview. Reports only whether secrets are configured, never their values.
  app.get('/api/settings/overview', requireUser, wrap(async (req, res) => {
    const [[tenant]] = await pool.query(`SELECT id, name, slug, isolation_enabled, created_at FROM tenants WHERE id = ?`, [req.user.tenant_id]);
    const [robots] = await pool.query(
      `SELECT r.id, r.name, r.adapter, r.status, r.last_heartbeat_at, r.last_error, r.created_at,
              JSON_UNQUOTE(JSON_EXTRACT(r.config_json, '$.machine')) AS machine, JSON_UNQUOTE(JSON_EXTRACT(r.config_json, '$.version')) AS version,
              r.last_heartbeat_at >= DATE_SUB(UTC_TIMESTAMP(3), INTERVAL 60 SECOND) AS fresh,
              (SELECT COUNT(*) FROM automation_jobs j WHERE j.robot_id = r.id) AS jobs_run
       FROM automation_robots r WHERE r.tenant_id = ? ORDER BY r.name`, [req.user.tenant_id]);
    const [roles] = await pool.query(`SELECT role, status, COUNT(*) AS n FROM users WHERE tenant_id = ? GROUP BY role, status`, [req.user.tenant_id]);
    const roleCounts = {};
    for (const r of roles) { roleCounts[r.role] ??= { active: 0, disabled: 0 }; roleCounts[r.role][r.status === 'active' ? 'active' : 'disabled'] += Number(r.n); }
    const o = cfg.orchestrator || {};
    const ai = cfg.ai || {};
    res.json({ data: {
      tenant: { id: tenant.id, name: tenant.name, slug: tenant.slug, isolationEnabled: Boolean(tenant.isolation_enabled), createdAt: tenant.created_at },
      server: { timezone: 'UTC', environment: cfg.env },
      orchestrator: {
        configured: Boolean(o.baseUrl && o.token && o.releaseKey),
        host: host(o.baseUrl), tokenConfigured: Boolean(o.token), releaseKeyConfigured: Boolean(o.releaseKey), folderConfigured: Boolean(o.organizationUnitId),
        required: ['ORCHESTRATOR_BASE_URL', 'ORCHESTRATOR_TOKEN', 'ORCHESTRATOR_RELEASE_KEY', 'ORCHESTRATOR_ORGANIZATION_UNIT_ID (optional)'],
      },
      ai: { provider: ai.provider || null, model: ai.model || null, host: host(ai.baseUrl), keyConfigured: Boolean(ai.apiKey), configured: Boolean(ai.provider && (ai.apiKey || ai.provider === 'openai_compatible' || ai.provider === 'mock')) },
      security: {
        accessTokenMinutes: cfg.jwtAccessMinutes, refreshTokenDays: cfg.jwtRefreshDays, passwordMinLength: 12, passwordRule: 'At least 12 characters with letters and numbers',
        bcryptRounds: effectiveBcryptRounds(cfg.bcryptRounds), rateLimitPerMinute: cfg.rateLimitMax, authRateLimitPerMinute: cfg.authRateLimitMax,
        refreshRateLimitPerMinute: cfg.refreshRateLimitMax ?? 60, signupEnabled: cfg.allowSignup !== false, signupRateLimitPerHour: cfg.signupRateLimitMax,
        corsOrigins: String(cfg.corsOrigin || '').split(',').map((s) => s.trim()).filter(Boolean),
      },
      robots: robots.map((r) => ({
        id: r.id, name: r.name, adapter: r.adapter, status: r.status, machine: r.machine && r.machine !== 'null' ? r.machine : null, version: r.version && r.version !== 'null' ? r.version : null,
        online: Boolean(r.fresh), lastHeartbeatAt: r.last_heartbeat_at, lastError: r.last_error, jobsRun: Number(r.jobs_run), createdAt: r.created_at,
      })),
      roleCounts,
      canEdit: req.user.role === 'administrator',
    } });
  }));
}
