import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import { missingInput } from '../workflow/inputRefs.js';
import path from 'node:path';
import express from 'express';
import helmet from 'helmet';
import cors from 'cors';
import rateLimit from 'express-rate-limit';
import { registerPublicAsk } from '../public/askAi.js';
import jwt from 'jsonwebtoken';
import multer from 'multer';
import { z } from 'zod';
import ExcelJS from 'exceljs';
import { stringify } from 'csv-stringify/sync';
import { config as loadConfig } from '../config.js';
import { writeAudit } from '../db/audit.js';
import { AppError, validationError } from '../lib/errors.js';
import { can } from '../lib/permissions.js';
import { hashPassword, verifyPassword } from '../lib/passwords.js';
import { encryptJson, sha256 } from '../lib/cryptoSecrets.js';
import { redact } from '../lib/redact.js';
import { clientError, corsOptions, effectiveBcryptRounds, needsRehash } from '../lib/security.js';
import { resolveInside } from '../lib/paths.js';
import { validateDefinition } from '../workflow/validate.js';
import { parseCron, nextRun } from '../scheduler/cron.js';
import { enqueueJob, retryJob, cancelJob, applyRobotResult, claimRobotJob } from '../services/jobService.js';
import {
  QUEUE_ITEM_STATUSES, addQueueItem, deleteItem, getNextItems, presentItem, presentQueue, queueCounts, retryItem, setItemResult,
} from '../services/queueService.js';
import { testConnection, recordHeartbeat } from '../services/runtime.js';
import { canCompleteTask, completeTask, presentTask } from '../services/taskService.js';
import { createRecorder } from '../automation/web/recorder.js';
import { mimeFor } from '../services/jobService.js';
import { registerFlowRoutes } from './flowRoutes.js';
import { registerAgentRoutes } from './agentRoutes.js';
import { registerAppRoutes } from './appRoutes.js';
import { registerCaseRoutes } from './caseRoutes.js';
import { registerBpmnRoutes } from './bpmnRoutes.js';
import { registerAuditRoutes } from './auditRoutes.js';
import { registerInsightsRoutes } from './insightsRoutes.js';
import { registerPlatformRoutes } from './platformRoutes.js';
import { requestContextMiddleware } from '../lib/requestContext.js';
import { kickAgentRun } from '../agent/runtime.js';
import { applyPasswordReset, emailConfigured, requestPasswordReset } from '../services/passwordResetMail.js';
import { PROVIDERS } from '../agent/providers.js';
import { advanceRun } from '../flow/engine.js';
import { notifyCase } from '../case/engine.js';

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 10 * 1024 * 1024 },
});

function wrap(handler) {
  return (req, res, next) => Promise.resolve(handler(req, res, next)).catch(next);
}

function paging(query) {
  const limit = Number(query.limit ?? 20);
  const offset = Number(query.offset ?? 0);
  if (!Number.isInteger(limit) || limit < 1 || limit > 100) {
    throw validationError([{ path: 'limit', message: 'limit must be an integer from 1 to 100' }]);
  }
  if (!Number.isInteger(offset) || offset < 0) {
    throw validationError([{ path: 'offset', message: 'offset must be a positive integer' }]);
  }
  return { limit, offset };
}

function like(value) {
  return `%${String(value).replace(/[\\%_]/g, '\\$&')}%`;
}

function csvCell(value) {
  const text = value == null ? '' : String(value);
  return /^[=+\-@]/.test(text) ? `'${text}` : text;
}

function sqlDateTime(value) {
  return new Date(value).toISOString().slice(0, 23).replace('T', ' ');
}

function parsedDate(value, field) {
  const date = new Date(String(value));
  if (Number.isNaN(date.getTime())) throw validationError([{ path: field, message: `${field} must be a valid date` }]);
  return sqlDateTime(date);
}

function cronNext(expression, timezone) {
  try {
    parseCron(expression);
    return sqlDateTime(nextRun(expression, new Date(), timezone));
  } catch (error) {
    throw validationError([{ path: 'cronExpression', message: error.message }]);
  }
}

function presentUser(user) {
  return {
    id: user.id,
    email: user.email,
    displayName: user.display_name,
    role: user.role,
    status: user.status,
    tenantId: user.tenant_id,
    isSuperAdmin: Boolean(user.is_super_admin),
  };
}

const SUSPENDED_MESSAGE = 'Workspace suspended. Contact the platform administrator to restore access.';
function suspendedError() {
  return new AppError(403, 'WORKSPACE_SUSPENDED', SUSPENDED_MESSAGE);
}

function presentJob(job) {
  return {
    id: job.id,
    projectId: job.project_id,
    workflowId: job.workflow_id,
    workflowVersionId: job.workflow_version_id,
    scheduleId: job.schedule_id,
    robotId: job.robot_id,
    triggerSource: job.trigger_source,
    executionTarget: job.execution_target,
    status: job.status,
    correlationId: job.correlation_id,
    attempt: job.current_attempt,
    maxAttempts: job.max_attempts,
    queuedAt: job.queued_at,
    claimedAt: job.claimed_at,
    startedAt: job.started_at,
    finishedAt: job.finished_at,
    errorSummary: job.error_summary,
    input: job.input_json,
    createdAt: job.created_at,
  };
}

function presentConnection(row) {
  return {
    id: row.id,
    projectId: row.project_id,
    connectorType: row.connector_type,
    name: row.name,
    config: redact(row.config_json),
    hasSecret: Boolean(row.secret_ciphertext),
    status: row.status,
    lastTestedAt: row.last_tested_at,
    lastError: row.last_error,
    createdAt: row.created_at,
  };
}

export function createApp(options = {}) {
  const baseCfg = options.config || loadConfig();
  const cfg = { ...baseCfg, bcryptRounds: effectiveBcryptRounds(baseCfg.bcryptRounds) };
  const pool = options.pool;
  if (!pool) throw new Error('createApp requires a database pool');
  const app = express();
  app.disable('x-powered-by');
  if (cfg.trustProxy) app.set('trust proxy', cfg.trustProxy);
  // JSON-only API: lock the CSP down completely; the SPA is served by Vite / a static host with its own headers.
  app.use(helmet({
    contentSecurityPolicy: { useDefaults: false, directives: { defaultSrc: ["'none'"], frameAncestors: ["'none'"], baseUri: ["'none'"], formAction: ["'none'"] } },
    crossOriginResourcePolicy: { policy: 'same-site' },
  }));
  app.use(cors(corsOptions(cfg.corsOrigin)));
  app.use(requestContextMiddleware);
  app.use(express.json({ limit: cfg.jsonBodyLimit || '1mb' }));
  app.use(express.urlencoded({ extended: false, limit: '100kb' }));
  app.use('/api', (_req, res, next) => { res.set('Cache-Control', 'no-store'); next(); });
  if (cfg.env !== 'test') {
    app.use(rateLimit({ windowMs: cfg.rateLimitWindowMs, limit: cfg.rateLimitMax, standardHeaders: true, legacyHeaders: false }));
  }

  const authLimit = rateLimit({
    windowMs: cfg.rateLimitWindowMs,
    limit: cfg.env === 'test' ? 1000 : cfg.authRateLimitMax,
    standardHeaders: true,
    legacyHeaders: false,
    handler: (_req, res) => res.status(429).json({ error: { code: 'RATE_LIMITED', message: 'Too many attempts. Wait a minute and try again.' } }),
  });

  // Refresh/logout are called on every session renewal, so they get a looser budget than login.
  const refreshLimit = rateLimit({
    windowMs: cfg.rateLimitWindowMs,
    limit: cfg.env === 'test' ? 1000 : (cfg.refreshRateLimitMax ?? 60),
    standardHeaders: true,
    legacyHeaders: false,
    handler: (_req, res) => res.status(429).json({ error: { code: 'RATE_LIMITED', message: 'Too many session requests. Wait a minute and try again.' } }),
  });

  // Compared against when the email is unknown so login timing doesn't reveal which accounts exist.
  const dummyHash = hashPassword(crypto.randomBytes(16).toString('hex'), cfg.bcryptRounds);

  const signupLimit = rateLimit({
    windowMs: cfg.signupRateLimitWindowMs ?? 3600000,
    limit: cfg.signupRateLimitMax ?? 10,
    standardHeaders: true,
    legacyHeaders: false,
    handler: (_req, res) => res.status(429).json({ error: { code: 'RATE_LIMITED', message: 'Too many sign-up attempts from this network. Try again later.' } }),
  });

  function signAccess(user) {
    return jwt.sign(
      { sub: user.id, tenantId: user.tenant_id, role: user.role, email: user.email },
      cfg.jwtSecret,
      { expiresIn: `${cfg.jwtAccessMinutes}m` },
    );
  }

  async function issueRefresh(user) {
    const token = crypto.randomBytes(32).toString('hex');
    await pool.query(
      `INSERT INTO refresh_tokens (id, user_id, token_hash, expires_at, created_at)
       VALUES (?, ?, ?, DATE_ADD(UTC_TIMESTAMP(3), INTERVAL ? DAY), UTC_TIMESTAMP(3))`,
      [crypto.randomUUID(), user.id, sha256(token), cfg.jwtRefreshDays],
    );
    return token;
  }

  async function requireUser(req, _res, next) {
    try {
      const header = req.headers.authorization || '';
      const token = header.startsWith('Bearer ') ? header.slice(7) : '';
      if (!token) throw new AppError(401, 'UNAUTHORIZED', 'Authentication required');
      const payload = jwt.verify(token, cfg.jwtSecret);
      const [rows] = await pool.query(
        `SELECT u.*, t.status AS tenant_status FROM users u JOIN tenants t ON t.id = u.tenant_id WHERE u.id = ? AND u.status = 'active'`,
        [payload.sub],
      );
      if (!rows[0]) throw new AppError(401, 'UNAUTHORIZED', 'Authentication required');
      if (rows[0].tenant_status === 'suspended') throw suspendedError();
      req.user = rows[0];
      next();
    } catch (error) {
      next(error instanceof AppError ? error : new AppError(401, 'UNAUTHORIZED', 'Invalid or expired token'));
    }
  }

  function requirePermission(permission) {
    return (req, _res, next) => {
      if (!can(req.user.role, permission)) return next(new AppError(403, 'FORBIDDEN', 'You do not have permission for this action'));
      return next();
    };
  }

  async function scope(user) {
    if (user.role === 'administrator') return { all: true, ids: [] };
    const [rows] = await pool.query(
      `SELECT project_id FROM project_members WHERE user_id = ?`,
      [user.id],
    );
    return { all: false, ids: rows.map((row) => row.project_id) };
  }

  function scopeSql(range, column) {
    if (range.all) return { sql: '1 = 1', params: [] };
    if (!range.ids.length) return { sql: '1 = 0', params: [] };
    return { sql: `${column} IN (${range.ids.map(() => '?').join(',')})`, params: [...range.ids] };
  }

  // Administrators see every audit row. Other users see rows for their projects and their own actions.
  function auditScope(range, user) {
    if (range.all) return { sql: '1 = 1', params: [] };
    const projects = scopeSql(range, 'project_id');
    return { sql: `(${projects.sql} OR actor_user_id = ?)`, params: [...projects.params, user.id] };
  }

  async function loadProject(user, projectId, writable = false) {
    const [rows] = await pool.query(`SELECT * FROM projects WHERE id = ? AND tenant_id = ?`, [projectId, user.tenant_id]);
    if (!rows[0]) throw new AppError(404, 'NOT_FOUND', 'Project not found');
    if (user.role !== 'administrator') {
      const [members] = await pool.query(
        `SELECT role FROM project_members WHERE project_id = ? AND user_id = ?`,
        [projectId, user.id],
      );
      if (!members[0]) throw new AppError(403, 'FORBIDDEN', 'You do not have access to this project');
    }
    if (writable && rows[0].status !== 'active') {
      throw new AppError(409, 'PROJECT_INACTIVE', 'Archived projects cannot be changed this way');
    }
    return rows[0];
  }

  async function connectionOptions(projectId) {
    const [rows] = await pool.query(`SELECT id, connector_type FROM connections WHERE project_id = ?`, [projectId]);
    return {
      connectionIds: new Set(rows.map((row) => row.id)),
      connectionTypes: new Map(rows.map((row) => [row.id, row.connector_type])),
    };
  }

  async function materialize(versionId, definition) {
    await pool.query(`DELETE FROM workflow_steps WHERE workflow_version_id = ?`, [versionId]);
    for (let index = 0; index < definition.steps.length; index += 1) {
      const step = definition.steps[index];
      await pool.query(
        `INSERT INTO workflow_steps (
          id, workflow_version_id, step_key, step_type, name, position, config_json, timeout_ms, error_policy
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [crypto.randomUUID(), versionId, step.id, step.type, step.name, index, JSON.stringify(step.config || {}), step.timeoutMs || null, step.errorPolicy || 'fail'],
      );
    }
  }

  app.get('/api/health', wrap(async (_req, res) => {
    try {
      await pool.query('SELECT 1 AS ok');
      res.json({ data: { status: 'ok', database: 'up', service: 'urap-api' } });
    } catch {
      res.status(503).json({ error: { code: 'DATABASE_UNAVAILABLE', message: 'Database is unavailable' } });
    }
  }));

  registerPublicAsk(app, { pool, cfg, chat: options.askChat });

  app.post('/api/auth/login', authLimit, wrap(async (req, res) => {
    const body = z.object({ email: z.string().trim().email().max(320), password: z.string().min(1).max(200), remember: z.boolean().optional() }).safeParse(req.body);
    if (!body.success) throw validationError(body.error.issues);
    const [rows] = await pool.query(
      `SELECT u.*, t.status AS tenant_status FROM users u JOIN tenants t ON t.id = u.tenant_id WHERE u.email = ?`,
      [body.data.email.toLowerCase()],
    );
    const user = rows[0];
    const valid = await verifyPassword(body.data.password, user ? user.password_hash : await dummyHash);
    if (!user || !valid || user.status !== 'active') {
      // Only known accounts can be attributed to a tenant; the typed password is never recorded.
      if (user) await writeAudit(pool, { tenantId: user.tenant_id, userId: user.id, action: 'auth.login_failed', entityType: 'user', entityId: user.id, result: 'failure', metadata: { reason: !valid ? 'bad_password' : 'inactive' } }).catch(() => {});
      throw new AppError(401, 'INVALID_CREDENTIALS', 'Invalid email or password');
    }
    if (user.tenant_status === 'suspended') {
      await writeAudit(pool, { tenantId: user.tenant_id, userId: user.id, action: 'auth.login_failed', entityType: 'user', entityId: user.id, result: 'failure', metadata: { reason: 'workspace_suspended' } }).catch(() => {});
      throw suspendedError();
    }
    await pool.query(`UPDATE users SET last_login_at = UTC_TIMESTAMP(3) WHERE id = ?`, [user.id]);
    if (needsRehash(user.password_hash, cfg.bcryptRounds)) {
      // Upgrade older, weaker hashes transparently on a successful sign-in.
      await pool.query(`UPDATE users SET password_hash = ? WHERE id = ?`, [await hashPassword(body.data.password, cfg.bcryptRounds), user.id]);
    }
    await writeAudit(pool, { tenantId: user.tenant_id, userId: user.id, action: 'auth.login', entityType: 'user', entityId: user.id, ip: req.ip });
    res.json({ data: { accessToken: signAccess(user), refreshToken: await issueRefresh(user), user: presentUser(user) } });
  }));

  // Public settings the sign-in and sign-up pages need before anyone is signed in.
  app.get('/api/auth/options', (_req, res) => {
    res.json({ data: { allowSignup: cfg.allowSignup !== false, passwordReset: emailConfigured(cfg) ? 'email' : 'administrator', passwordMinLength: 12 } });
  });

  app.post('/api/auth/forgot-password', authLimit, wrap(async (req, res) => {
    const body = z.object({ email: z.string().trim().email() }).safeParse(req.body);
    if (!body.success) throw validationError(body.error.issues);
    const configured = emailConfigured(cfg);
    if (configured) await requestPasswordReset(pool, cfg, body.data.email.toLowerCase()).catch(() => {});
    res.json({ data: { accepted: true, emailConfigured: configured } });
  }));

  app.post('/api/auth/reset-password', authLimit, wrap(async (req, res) => {
    const body = z.object({
      token: z.string().min(20, 'This reset link is invalid or has expired. Request a new one.').max(200),
      password: z.string().min(12).max(200).refine((value) => /[A-Za-z]/.test(value) && /\d/.test(value), 'Password must contain letters and numbers'),
    }).safeParse(req.body);
    if (!body.success) throw validationError(body.error.issues);
    const result = await applyPasswordReset(pool, cfg, body.data.token, body.data.password);
    res.json({ data: { reset: true, email: result.email } });
  }));

  app.post('/api/auth/signup', signupLimit, wrap(async (req, res) => {
    if (cfg.allowSignup === false) {
      throw new AppError(403, 'SIGNUP_DISABLED', 'Self sign-up is turned off on this installation. Ask your administrator for an account.');
    }
    const body = z.object({
      displayName: z.string().trim().min(2, 'Enter your full name').max(200),
      email: z.string().trim().toLowerCase().email('Enter a valid work email').max(320),
      password: z.string()
        .min(12, 'Password must be at least 12 characters')
        .max(200, 'Password must be at most 200 characters')
        .refine((value) => /[A-Za-z]/.test(value) && /\d/.test(value), 'Password must contain letters and numbers'),
      organization: z.string().trim().min(2, 'Enter your organization name').max(120),
      acceptTerms: z.literal(true, { errorMap: () => ({ message: 'Accept the terms to create an account' }) }),
    }).strict().safeParse(req.body);
    if (!body.success) throw validationError(body.error.issues);
    const { displayName, email, password, organization } = body.data;
    if (password.toLowerCase().includes(email.split('@')[0]) && email.split('@')[0].length >= 4) {
      throw validationError([{ path: ['password'], message: 'Password must not contain your email name' }]);
    }
    const [existing] = await pool.query(`SELECT id FROM users WHERE email = ? LIMIT 1`, [email]);
    if (existing[0]) throw new AppError(409, 'EMAIL_IN_USE', 'An account with this email already exists. Sign in instead.');
    // Each self sign-up gets its own workspace (tenant) and is its administrator. It never joins
    // the Default tenant or any existing tenant; people join an existing workspace only when an
    // administrator of that workspace creates their account.
    const tenantId = crypto.randomUUID();
    const tenantName = organization.slice(0, 200) || `${displayName}'s workspace`.slice(0, 200);
    const tenantSlug = `${organization.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 60) || 'workspace'}-${crypto.randomBytes(4).toString('hex')}`;
    const userId = crypto.randomUUID();
    const projectId = crypto.randomUUID();
    const role = 'administrator';
    const passwordHash = await hashPassword(password, cfg.bcryptRounds);
    const connection = await pool.getConnection();
    try {
      await connection.beginTransaction();
      await connection.query(
        `INSERT INTO tenants (id, name, slug, isolation_enabled, created_at, updated_at) VALUES (?, ?, ?, 1, UTC_TIMESTAMP(3), UTC_TIMESTAMP(3))`,
        [tenantId, tenantName, tenantSlug],
      );
      await connection.query(
        `INSERT INTO users (id, tenant_id, email, display_name, password_hash, role, status, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, 'active', UTC_TIMESTAMP(3), UTC_TIMESTAMP(3))`,
        [userId, tenantId, email, displayName, passwordHash, role],
      );
      await connection.query(
        `INSERT INTO projects (id, tenant_id, name, description, category, status, settings_json, created_by, created_at, updated_at)
         VALUES (?, ?, ?, ?, 'general', 'active', ?, ?, UTC_TIMESTAMP(3), UTC_TIMESTAMP(3))`,
        [projectId, tenantId, `${organization} workspace`.slice(0, 200), `Starter project for ${organization}, created at sign-up.`, JSON.stringify({ organization }), userId],
      );
      await connection.query(
        `INSERT INTO project_members (id, project_id, user_id, role, created_at) VALUES (?, ?, ?, ?, UTC_TIMESTAMP(3))`,
        [crypto.randomUUID(), projectId, userId, role],
      );
      await connection.commit();
    } catch (error) {
      await connection.rollback();
      if (error?.code === 'ER_DUP_ENTRY') throw new AppError(409, 'EMAIL_IN_USE', 'An account with this email already exists. Sign in instead.');
      throw error;
    } finally {
      connection.release();
    }
    await fs.mkdir(path.join(cfg.storageRoot, tenantId, projectId), { recursive: true });
    await writeAudit(pool, { tenantId, userId, action: 'auth.signup', entityType: 'user', entityId: userId, projectId, metadata: { organization, role, workspace: tenantSlug }, ip: req.ip });
    const [rows] = await pool.query(`SELECT * FROM users WHERE id = ?`, [userId]);
    res.status(201).json({ data: { accessToken: signAccess(rows[0]), refreshToken: await issueRefresh(rows[0]), user: presentUser(rows[0]), projectId } });
  }));

  app.post('/api/auth/refresh', refreshLimit, wrap(async (req, res) => {
    const token = z.object({ refreshToken: z.string().min(20).max(200) }).safeParse(req.body);
    if (!token.success) throw validationError(token.error.issues);
    const [rows] = await pool.query(
      `SELECT t.id AS token_id, u.id, u.tenant_id, u.email, u.display_name, u.role, u.status
       FROM refresh_tokens t JOIN users u ON u.id = t.user_id
       WHERE t.token_hash = ? AND t.revoked_at IS NULL AND t.expires_at > UTC_TIMESTAMP(3) AND u.status = 'active'
         AND NOT EXISTS (SELECT 1 FROM tenants s WHERE s.id = u.tenant_id AND s.status = 'suspended')`,
      [sha256(token.data.refreshToken)],
    );
    if (!rows[0]) throw new AppError(401, 'UNAUTHORIZED', 'Refresh token is invalid');
    // Atomic rotation: of two refreshes racing with the same token only one wins, so a token never
    // forks into two live sessions. The loser gets 401 and the client reuses the winner's tokens.
    const [revoked] = await pool.query(`UPDATE refresh_tokens SET revoked_at = UTC_TIMESTAMP(3) WHERE id = ? AND revoked_at IS NULL`, [rows[0].token_id]);
    if (!revoked.affectedRows) throw new AppError(401, 'UNAUTHORIZED', 'Refresh token is invalid');
    res.json({ data: { accessToken: signAccess(rows[0]), refreshToken: await issueRefresh(rows[0]), user: presentUser(rows[0]) } });
  }));

  app.post('/api/auth/logout', refreshLimit, wrap(async (req, res) => {
    const token = req.body?.refreshToken;
    if (typeof token === 'string') {
      await pool.query(`UPDATE refresh_tokens SET revoked_at = UTC_TIMESTAMP(3) WHERE token_hash = ?`, [sha256(token)]);
    }
    res.json({ data: { loggedOut: true } });
  }));

  app.get('/api/auth/me', requireUser, wrap(async (req, res) => {
    res.json({ data: presentUser(req.user) });
  }));

  app.get('/api/users', requireUser, requirePermission('users.manage'), wrap(async (req, res) => {
    const [rows] = await pool.query(
      `SELECT id, email, display_name, role, status, tenant_id, created_at FROM users WHERE tenant_id = ? ORDER BY display_name`,
      [req.user.tenant_id],
    );
    res.json({ data: rows.map(presentUser) });
  }));

  app.post('/api/users', requireUser, requirePermission('users.manage'), wrap(async (req, res) => {
    const body = z.object({
      email: z.string().email(),
      displayName: z.string().trim().min(1).max(200),
      password: z.string().min(12).max(200),
      role: z.enum(['administrator', 'project_manager', 'automation_developer', 'operator', 'viewer']),
    }).safeParse(req.body);
    if (!body.success) throw validationError(body.error.issues);
    const id = crypto.randomUUID();
    await pool.query(
      `INSERT INTO users (id, tenant_id, email, display_name, password_hash, role, status, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, 'active', UTC_TIMESTAMP(3), UTC_TIMESTAMP(3))`,
      [id, req.user.tenant_id, body.data.email.toLowerCase(), body.data.displayName, await hashPassword(body.data.password, cfg.bcryptRounds), body.data.role],
    );
    await writeAudit(pool, { tenantId: req.user.tenant_id, userId: req.user.id, action: 'user.create', entityType: 'user', entityId: id, ip: req.ip });
    const [rows] = await pool.query(`SELECT * FROM users WHERE id = ?`, [id]);
    res.status(201).json({ data: presentUser(rows[0]) });
  }));

  app.get('/api/categories', requireUser, wrap(async (_req, res) => {
    const [rows] = await pool.query(`SELECT code, label, description FROM use_case_categories ORDER BY label`);
    res.json({ data: rows });
  }));

  app.get('/api/connectors', requireUser, wrap(async (_req, res) => {
    const [rows] = await pool.query(`SELECT * FROM connectors ORDER BY display_name`);
    res.json({ data: rows.map((row) => ({
      id: row.id,
      displayName: row.display_name,
      description: row.description,
      configSchema: row.config_schema_json,
      permissions: row.permissions_json,
      inputFormat: row.input_format,
      outputFormat: row.output_format,
      timeoutMs: row.timeout_ms,
      availability: row.availability,
    })) });
  }));

  app.get('/api/dashboard', requireUser, wrap(async (req, res) => {
    const range = await scope(req.user);
    const projectFilter = req.query.projectId ? String(req.query.projectId) : '';
    if (projectFilter) await loadProject(req.user, projectFilter);
    const jobs = scopeSql(range, 'project_id');
    const projects = scopeSql(range, 'id');
    const params = [];
    let jobWhere = `tenant_id = ? AND ${jobs.sql}`;
    params.push(req.user.tenant_id, ...jobs.params);
    if (projectFilter) {
      jobWhere += ` AND project_id = ?`;
      params.push(projectFilter);
    }
    if (req.query.from) {
      jobWhere += ` AND created_at >= ?`;
      params.push(parsedDate(req.query.from, 'from'));
    }
    if (req.query.to) {
      jobWhere += ` AND created_at <= ?`;
      params.push(parsedDate(req.query.to, 'to'));
    }
    const projectWhere = `tenant_id = ? AND ${projects.sql}${projectFilter ? ' AND id = ?' : ''}`;
    const projectParams = [req.user.tenant_id, ...projects.params, ...(projectFilter ? [projectFilter] : [])];
    const [[projectCounts]] = await pool.query(
      `SELECT COUNT(*) AS total, SUM(status = 'active') AS active FROM projects WHERE ${projectWhere}`,
      projectParams,
    );
    const [[workflowCounts]] = await pool.query(
      `SELECT COUNT(*) AS total, SUM(status = 'published') AS enabled
       FROM workflows WHERE tenant_id = ? AND ${scopeSql(range, 'project_id').sql}${projectFilter ? ' AND project_id = ?' : ''}`,
      [req.user.tenant_id, ...scopeSql(range, 'project_id').params, ...(projectFilter ? [projectFilter] : [])],
    );
    const [[jobCounts]] = await pool.query(
      `SELECT
         SUM(status = 'QUEUED') AS queued,
         SUM(status IN ('CLAIMED', 'RUNNING', 'CANCEL_REQUESTED')) AS running,
         SUM(status = 'SUSPENDED') AS suspended,
         SUM(status = 'SUCCEEDED') AS succeeded,
         SUM(status = 'FAILED') AS failed,
         AVG(CASE WHEN started_at IS NOT NULL AND finished_at IS NOT NULL AND status IN ('SUCCEEDED', 'FAILED', 'CANCELLED')
           THEN TIMESTAMPDIFF(MICROSECOND, started_at, finished_at) / 1000 END) AS averageDurationMs
       FROM automation_jobs WHERE ${jobWhere}`,
      params,
    );
    const [trends] = await pool.query(
      `SELECT DATE(created_at) AS day, status, COUNT(*) AS count
       FROM automation_jobs WHERE ${jobWhere}
       GROUP BY DATE(created_at), status ORDER BY day DESC LIMIT 200`,
      params,
    );
    const activityScope = auditScope(range, req.user);
    const [activity] = await pool.query(
      `SELECT id, action, entity_type, entity_id, project_id, created_at
       FROM audit_logs WHERE tenant_id = ? AND ${activityScope.sql} ${projectFilter ? 'AND project_id = ?' : ''}
       ORDER BY created_at DESC LIMIT 15`,
      [req.user.tenant_id, ...activityScope.params, ...(projectFilter ? [projectFilter] : [])],
    );
    const [errors] = await pool.query(
      `SELECT a.id, a.job_id, a.attempt_number, a.error_code, a.error_message, a.finished_at, j.project_id, j.workflow_id
       FROM job_attempts a JOIN automation_jobs j ON j.id = a.job_id
       WHERE j.tenant_id = ? AND a.status = 'FAILED' AND ${scopeSql(range, 'j.project_id').sql}
       ${projectFilter ? 'AND j.project_id = ?' : ''}
       ORDER BY a.finished_at DESC LIMIT 10`,
      [req.user.tenant_id, ...scopeSql(range, 'j.project_id').params, ...(projectFilter ? [projectFilter] : [])],
    );
    res.json({ data: {
      totalProjects: Number(projectCounts.total || 0),
      activeProjects: Number(projectCounts.active || 0),
      totalWorkflows: Number(workflowCounts.total || 0),
      enabledWorkflows: Number(workflowCounts.enabled || 0),
      queuedJobs: Number(jobCounts.queued || 0),
      runningJobs: Number(jobCounts.running || 0),
      suspendedJobs: Number(jobCounts.suspended || 0),
      successfulExecutions: Number(jobCounts.succeeded || 0),
      failedExecutions: Number(jobCounts.failed || 0),
      averageExecutionDurationMs: jobCounts.averageDurationMs == null ? null : Number(jobCounts.averageDurationMs),
      trends,
      recentActivity: activity,
      recentErrors: errors,
    } });
  }));

  app.get('/api/projects', requireUser, wrap(async (req, res) => {
    const { limit, offset } = paging(req.query);
    const range = await scope(req.user);
    const where = ['tenant_id = ?', scopeSql(range, 'id').sql];
    const params = [req.user.tenant_id, ...scopeSql(range, 'id').params];
    if (req.query.status) { where.push('status = ?'); params.push(String(req.query.status)); }
    if (req.query.category) { where.push('category = ?'); params.push(String(req.query.category)); }
    if (req.query.search) { where.push(`(name LIKE ? ESCAPE '\\\\' OR description LIKE ? ESCAPE '\\\\')`); params.push(like(req.query.search), like(req.query.search)); }
    const sorts = { name: 'name', created_at: 'created_at', status: 'status', category: 'category' };
    const sort = sorts[req.query.sort] || 'created_at';
    const order = req.query.order === 'asc' ? 'ASC' : 'DESC';
    const [countRows] = await pool.query(`SELECT COUNT(*) AS total FROM projects WHERE ${where.join(' AND ')}`, params);
    const [rows] = await pool.query(
      `SELECT * FROM projects WHERE ${where.join(' AND ')} ORDER BY ${sort} ${order} LIMIT ${limit} OFFSET ${offset}`,
      params,
    );
    res.json({ data: rows, meta: { limit, offset, total: Number(countRows[0].total) } });
  }));

  app.post('/api/projects', requireUser, requirePermission('projects.create'), wrap(async (req, res) => {
    const body = z.object({
      name: z.string().trim().min(1).max(200),
      description: z.string().max(4000).optional().default(''),
      category: z.string().trim().min(2).max(80),
      settings: z.record(z.any()).optional().default({}),
    }).safeParse(req.body);
    if (!body.success) throw validationError(body.error.issues);
    const id = crypto.randomUUID();
    await pool.query(
      `INSERT INTO projects (id, tenant_id, name, description, category, status, settings_json, created_by, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, 'active', ?, ?, UTC_TIMESTAMP(3), UTC_TIMESTAMP(3))`,
      [id, req.user.tenant_id, body.data.name, body.data.description, body.data.category, JSON.stringify(body.data.settings), req.user.id],
    );
    await pool.query(
      `INSERT INTO project_members (id, project_id, user_id, role, created_at) VALUES (?, ?, ?, ?, UTC_TIMESTAMP(3))`,
      [crypto.randomUUID(), id, req.user.id, req.user.role === 'administrator' ? 'project_manager' : req.user.role],
    );
    await fs.mkdir(path.join(cfg.storageRoot, req.user.tenant_id, id), { recursive: true });
    await writeAudit(pool, { tenantId: req.user.tenant_id, userId: req.user.id, action: 'project.create', entityType: 'project', entityId: id, projectId: id, ip: req.ip });
    const [rows] = await pool.query(`SELECT * FROM projects WHERE id = ?`, [id]);
    res.status(201).json({ data: rows[0] });
  }));

  app.get('/api/projects/:id', requireUser, wrap(async (req, res) => {
    res.json({ data: await loadProject(req.user, req.params.id) });
  }));

  app.patch('/api/projects/:id', requireUser, requirePermission('projects.update'), wrap(async (req, res) => {
    const project = await loadProject(req.user, req.params.id, true);
    const body = z.object({
      name: z.string().trim().min(1).max(200).optional(),
      description: z.string().max(4000).optional(),
      category: z.string().trim().min(2).max(80).optional(),
      settings: z.record(z.any()).optional(),
    }).safeParse(req.body);
    if (!body.success) throw validationError(body.error.issues);
    await pool.query(
      `UPDATE projects SET name = ?, description = ?, category = ?, settings_json = ?, updated_at = UTC_TIMESTAMP(3) WHERE id = ?`,
      [
        body.data.name ?? project.name,
        body.data.description ?? project.description,
        body.data.category ?? project.category,
        JSON.stringify(body.data.settings ?? project.settings_json ?? {}),
        project.id,
      ],
    );
    await writeAudit(pool, { tenantId: req.user.tenant_id, userId: req.user.id, action: 'project.update', entityType: 'project', entityId: project.id, projectId: project.id, ip: req.ip });
    const [rows] = await pool.query(`SELECT * FROM projects WHERE id = ?`, [project.id]);
    res.json({ data: rows[0] });
  }));

  app.post('/api/projects/:id/archive', requireUser, requirePermission('projects.archive'), wrap(async (req, res) => {
    const project = await loadProject(req.user, req.params.id);
    await pool.query(
      `UPDATE projects SET status = 'archived', archived_at = UTC_TIMESTAMP(3), updated_at = UTC_TIMESTAMP(3) WHERE id = ?`,
      [project.id],
    );
    await writeAudit(pool, { tenantId: req.user.tenant_id, userId: req.user.id, action: 'project.archive', entityType: 'project', entityId: project.id, projectId: project.id, ip: req.ip });
    const [rows] = await pool.query(`SELECT * FROM projects WHERE id = ?`, [project.id]);
    res.json({ data: rows[0] });
  }));

  app.get('/api/projects/:id/activity', requireUser, wrap(async (req, res) => {
    await loadProject(req.user, req.params.id);
    const [rows] = await pool.query(
      `SELECT id, action, entity_type, entity_id, actor_user_id, metadata_json, created_at
       FROM audit_logs WHERE project_id = ? ORDER BY created_at DESC LIMIT 100`,
      [req.params.id],
    );
    res.json({ data: rows });
  }));

  app.get('/api/projects/:id/members', requireUser, wrap(async (req, res) => {
    await loadProject(req.user, req.params.id);
    const [rows] = await pool.query(
      `SELECT m.id, m.role, m.created_at, u.id AS user_id, u.email, u.display_name
       FROM project_members m JOIN users u ON u.id = m.user_id WHERE m.project_id = ?`,
      [req.params.id],
    );
    res.json({ data: rows });
  }));

  app.post('/api/projects/:id/members', requireUser, requirePermission('members.manage'), wrap(async (req, res) => {
    const project = await loadProject(req.user, req.params.id, true);
    const body = z.object({
      userId: z.string().uuid(),
      role: z.enum(['project_manager', 'automation_developer', 'operator', 'viewer']),
    }).safeParse(req.body);
    if (!body.success) throw validationError(body.error.issues);
    const [users] = await pool.query(`SELECT id FROM users WHERE id = ? AND tenant_id = ?`, [body.data.userId, req.user.tenant_id]);
    if (!users[0]) throw new AppError(404, 'NOT_FOUND', 'User not found');
    await pool.query(
      `INSERT INTO project_members (id, project_id, user_id, role, created_at) VALUES (?, ?, ?, ?, UTC_TIMESTAMP(3))
       ON DUPLICATE KEY UPDATE role = VALUES(role)`,
      [crypto.randomUUID(), project.id, body.data.userId, body.data.role],
    );
    res.status(201).json({ data: { projectId: project.id, userId: body.data.userId, role: body.data.role } });
  }));

  app.delete('/api/projects/:id/members/:userId', requireUser, requirePermission('members.manage'), wrap(async (req, res) => {
    await loadProject(req.user, req.params.id, true);
    await pool.query(`DELETE FROM project_members WHERE project_id = ? AND user_id = ?`, [req.params.id, req.params.userId]);
    res.json({ data: { removed: true } });
  }));

  app.get('/api/projects/:id/connections', requireUser, wrap(async (req, res) => {
    await loadProject(req.user, req.params.id);
    const [rows] = await pool.query(`SELECT * FROM connections WHERE project_id = ? ORDER BY name`, [req.params.id]);
    res.json({ data: rows.map(presentConnection) });
  }));

  app.post('/api/projects/:id/connections', requireUser, requirePermission('connections.write'), wrap(async (req, res) => {
    const project = await loadProject(req.user, req.params.id, true);
    const body = z.object({
      connectorType: z.string().min(2).max(64),
      name: z.string().trim().min(1).max(200),
      config: z.record(z.any()),
      secret: z.record(z.any()).optional(),
    }).safeParse(req.body);
    if (!body.success) throw validationError(body.error.issues);
    const [connectors] = await pool.query(`SELECT id FROM connectors WHERE id = ?`, [body.data.connectorType]);
    if (!connectors[0]) throw new AppError(400, 'UNKNOWN_CONNECTOR', 'Connector type is not registered');
    if (body.data.connectorType === 'ai_provider') {
      const provider = String(body.data.config.provider || '');
      if (!PROVIDERS[provider] || (provider === 'mock' && !cfg.ai?.allowMock)) throw new AppError(400, 'VALIDATION', 'Pick an AI provider: openai, azure_openai, anthropic, or openai_compatible');
      if (!String(body.data.config.model || '').trim()) throw new AppError(400, 'VALIDATION', 'Enter a model name (or Azure deployment name)');
      if (body.data.config.baseUrl && !/^https?:\/\//.test(String(body.data.config.baseUrl))) throw new AppError(400, 'VALIDATION', 'Base URL must start with http:// or https://');
      if (['azure_openai', 'openai_compatible'].includes(provider) && !body.data.config.baseUrl) throw new AppError(400, 'VALIDATION', 'This provider needs a base URL');
      if (PROVIDERS[provider].needsKey && !body.data.secret?.apiKey) throw new AppError(400, 'VALIDATION', 'Enter the API key');
    }
    const secret = body.data.secret ? encryptJson(body.data.secret, cfg.credentialsKey) : null;
    const id = crypto.randomUUID();
    await pool.query(
      `INSERT INTO connections (
        id, tenant_id, project_id, connector_type, name, config_json, secret_ciphertext, secret_iv, secret_tag,
        status, created_by, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'untested', ?, UTC_TIMESTAMP(3), UTC_TIMESTAMP(3))`,
      [id, project.tenant_id, project.id, body.data.connectorType, body.data.name, JSON.stringify(redact(body.data.config)), secret?.ciphertext || null, secret?.iv || null, secret?.tag || null, req.user.id],
    );
    const [rows] = await pool.query(`SELECT * FROM connections WHERE id = ?`, [id]);
    res.status(201).json({ data: presentConnection(rows[0]) });
  }));

  app.post('/api/connections/:id/test', requireUser, requirePermission('connections.write'), wrap(async (req, res) => {
    const [rows] = await pool.query(`SELECT * FROM connections WHERE id = ? AND tenant_id = ?`, [req.params.id, req.user.tenant_id]);
    if (!rows[0]) throw new AppError(404, 'NOT_FOUND', 'Connection not found');
    await loadProject(req.user, rows[0].project_id);
    const result = await testConnection(pool, cfg, rows[0]);
    res.json({ data: result });
  }));

  app.get('/api/workflows', requireUser, wrap(async (req, res) => {
    const { limit, offset } = paging(req.query);
    const range = await scope(req.user);
    const where = ['tenant_id = ?', scopeSql(range, 'project_id').sql];
    const params = [req.user.tenant_id, ...scopeSql(range, 'project_id').params];
    if (req.query.projectId) { where.push('project_id = ?'); params.push(String(req.query.projectId)); }
    if (req.query.status) { where.push('status = ?'); params.push(String(req.query.status)); }
    if (req.query.search) { where.push(`name LIKE ? ESCAPE '\\\\'`); params.push(like(req.query.search)); }
    const [countRows] = await pool.query(`SELECT COUNT(*) AS total FROM workflows WHERE ${where.join(' AND ')}`, params);
    const [rows] = await pool.query(
      `SELECT * FROM workflows WHERE ${where.join(' AND ')} ORDER BY updated_at DESC LIMIT ${limit} OFFSET ${offset}`,
      params,
    );
    res.json({ data: rows, meta: { limit, offset, total: Number(countRows[0].total) } });
  }));

  app.post('/api/workflows', requireUser, requirePermission('workflows.write'), wrap(async (req, res) => {
    const body = z.object({
      projectId: z.string().uuid(),
      name: z.string().trim().min(1).max(200),
      description: z.string().max(4000).optional().default(''),
      executionType: z.enum(['native', 'uipath', 'hybrid']).default('native'),
    }).safeParse(req.body);
    if (!body.success) throw validationError(body.error.issues);
    const project = await loadProject(req.user, body.data.projectId, true);
    const id = crypto.randomUUID();
    await pool.query(
      `INSERT INTO workflows (
        id, tenant_id, project_id, name, description, execution_type, status, created_by, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, 'draft', ?, UTC_TIMESTAMP(3), UTC_TIMESTAMP(3))`,
      [id, project.tenant_id, project.id, body.data.name, body.data.description, body.data.executionType, req.user.id],
    );
    await writeAudit(pool, { tenantId: req.user.tenant_id, userId: req.user.id, action: 'workflow.create', entityType: 'workflow', entityId: id, projectId: project.id, ip: req.ip });
    const [rows] = await pool.query(`SELECT * FROM workflows WHERE id = ?`, [id]);
    res.status(201).json({ data: rows[0] });
  }));

  async function loadWorkflow(user, id) {
    const [rows] = await pool.query(`SELECT * FROM workflows WHERE id = ? AND tenant_id = ?`, [id, user.tenant_id]);
    if (!rows[0]) throw new AppError(404, 'NOT_FOUND', 'Workflow not found');
    await loadProject(user, rows[0].project_id);
    return rows[0];
  }

  app.get('/api/workflows/:id', requireUser, wrap(async (req, res) => {
    const workflow = await loadWorkflow(req.user, req.params.id);
    const [versions] = await pool.query(`SELECT id, version_number, status, definition_json, validation_json, published_at, created_at FROM workflow_versions WHERE workflow_id = ? ORDER BY version_number DESC`, [workflow.id]);
    res.json({ data: { ...workflow, versions } });
  }));

  app.patch('/api/workflows/:id', requireUser, requirePermission('workflows.write'), wrap(async (req, res) => {
    const workflow = await loadWorkflow(req.user, req.params.id);
    await loadProject(req.user, workflow.project_id, true);
    const body = z.object({
      name: z.string().trim().min(1).max(200).optional(),
      description: z.string().max(4000).optional(),
      executionType: z.enum(['native', 'uipath', 'hybrid']).optional(),
    }).strict().safeParse(req.body);
    if (!body.success) throw validationError(body.error.issues);
    await pool.query(
      `UPDATE workflows SET name = ?, description = ?, execution_type = ?, updated_at = UTC_TIMESTAMP(3) WHERE id = ?`,
      [body.data.name ?? workflow.name, body.data.description ?? workflow.description, body.data.executionType ?? workflow.execution_type, workflow.id],
    );
    await writeAudit(pool, { tenantId: req.user.tenant_id, userId: req.user.id, action: 'workflow.update', entityType: 'workflow', entityId: workflow.id, projectId: workflow.project_id, metadata: body.data, ip: req.ip });
    const [rows] = await pool.query(`SELECT * FROM workflows WHERE id = ?`, [workflow.id]);
    res.json({ data: rows[0] });
  }));

  app.post('/api/workflows/:id/draft', requireUser, requirePermission('workflows.write'), wrap(async (req, res) => {
    const workflow = await loadWorkflow(req.user, req.params.id);
    const definition = req.body?.definition;
    if (!definition || typeof definition !== 'object') throw validationError([{ path: 'definition', message: 'definition is required' }]);
    const options = await connectionOptions(workflow.project_id);
    const validation = validateDefinition(definition, options);
    const stored = validation.definition || definition;
    const [drafts] = await pool.query(`SELECT * FROM workflow_versions WHERE workflow_id = ? AND status = 'draft' ORDER BY version_number DESC LIMIT 1`, [workflow.id]);
    let versionId = drafts[0]?.id;
    if (!versionId) {
      const [maxRows] = await pool.query(`SELECT COALESCE(MAX(version_number), 0) AS version_number FROM workflow_versions WHERE workflow_id = ?`, [workflow.id]);
      versionId = crypto.randomUUID();
      await pool.query(
        `INSERT INTO workflow_versions (id, workflow_id, version_number, status, definition_json, validation_json, created_by, created_at)
         VALUES (?, ?, ?, 'draft', ?, ?, ?, UTC_TIMESTAMP(3))`,
        [versionId, workflow.id, Number(maxRows[0].version_number) + 1, JSON.stringify(stored), JSON.stringify(validation), req.user.id],
      );
    } else {
      await pool.query(
        `UPDATE workflow_versions SET definition_json = ?, validation_json = ? WHERE id = ?`,
        [JSON.stringify(stored), JSON.stringify(validation), versionId],
      );
    }
    if (validation.definition) await materialize(versionId, validation.definition);
    await pool.query(`UPDATE workflows SET updated_at = UTC_TIMESTAMP(3) WHERE id = ?`, [workflow.id]);
    res.json({ data: { versionId, validation } });
  }));

  app.post('/api/workflows/:id/validate', requireUser, wrap(async (req, res) => {
    const workflow = await loadWorkflow(req.user, req.params.id);
    const definition = req.body?.definition;
    const options = await connectionOptions(workflow.project_id);
    res.json({ data: validateDefinition(definition, options) });
  }));

  app.post('/api/workflows/:id/publish', requireUser, requirePermission('workflows.publish'), wrap(async (req, res) => {
    const workflow = await loadWorkflow(req.user, req.params.id);
    const [drafts] = await pool.query(`SELECT * FROM workflow_versions WHERE workflow_id = ? AND status = 'draft' ORDER BY version_number DESC LIMIT 1`, [workflow.id]);
    if (!drafts[0]) throw new AppError(409, 'NO_DRAFT', 'Save a draft before publishing');
    const options = await connectionOptions(workflow.project_id);
    const validation = validateDefinition(drafts[0].definition_json, options);
    if (!validation.valid) throw new AppError(400, 'WORKFLOW_INVALID', 'Workflow failed validation', validation.errors);
    await pool.query(`UPDATE workflow_versions SET status = 'retired' WHERE workflow_id = ? AND status = 'published'`, [workflow.id]);
    await pool.query(
      `UPDATE workflow_versions SET status = 'published', published_at = UTC_TIMESTAMP(3), validation_json = ?, definition_json = ? WHERE id = ?`,
      [JSON.stringify(validation), JSON.stringify(validation.definition), drafts[0].id],
    );
    await materialize(drafts[0].id, validation.definition);
    await pool.query(
      `UPDATE workflows SET status = 'published', current_version_id = ?, updated_at = UTC_TIMESTAMP(3) WHERE id = ?`,
      [drafts[0].id, workflow.id],
    );
    await writeAudit(pool, { tenantId: req.user.tenant_id, userId: req.user.id, action: 'workflow.publish', entityType: 'workflow', entityId: workflow.id, projectId: workflow.project_id, metadata: { versionId: drafts[0].id }, ip: req.ip });
    const [rows] = await pool.query(`SELECT * FROM workflows WHERE id = ?`, [workflow.id]);
    res.json({ data: rows[0] });
  }));

  app.post('/api/workflows/:id/clone', requireUser, requirePermission('workflows.write'), wrap(async (req, res) => {
    const workflow = await loadWorkflow(req.user, req.params.id);
    await loadProject(req.user, workflow.project_id, true);
    const [versions] = await pool.query(`SELECT * FROM workflow_versions WHERE workflow_id = ? ORDER BY version_number DESC LIMIT 1`, [workflow.id]);
    const id = crypto.randomUUID();
    await pool.query(
      `INSERT INTO workflows (id, tenant_id, project_id, name, description, execution_type, status, created_by, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, 'draft', ?, UTC_TIMESTAMP(3), UTC_TIMESTAMP(3))`,
      [id, workflow.tenant_id, workflow.project_id, `${workflow.name} copy`.slice(0, 200), workflow.description, workflow.execution_type, req.user.id],
    );
    if (versions[0]) {
      const versionId = crypto.randomUUID();
      await pool.query(
        `INSERT INTO workflow_versions (id, workflow_id, version_number, status, definition_json, validation_json, created_by, created_at)
         VALUES (?, ?, 1, 'draft', ?, ?, ?, UTC_TIMESTAMP(3))`,
        [versionId, id, JSON.stringify(versions[0].definition_json), JSON.stringify(versions[0].validation_json), req.user.id],
      );
    }
    const [rows] = await pool.query(`SELECT * FROM workflows WHERE id = ?`, [id]);
    res.status(201).json({ data: rows[0] });
  }));

  app.post('/api/workflows/:id/disable', requireUser, requirePermission('workflows.publish'), wrap(async (req, res) => {
    const workflow = await loadWorkflow(req.user, req.params.id);
    if (workflow.status !== 'published') throw new AppError(409, 'INVALID_STATE', 'Only a published workflow can be disabled');
    await pool.query(`UPDATE workflows SET status = 'disabled', updated_at = UTC_TIMESTAMP(3) WHERE id = ?`, [workflow.id]);
    await writeAudit(pool, { tenantId: req.user.tenant_id, userId: req.user.id, action: 'workflow.disable', entityType: 'workflow', entityId: workflow.id, projectId: workflow.project_id, ip: req.ip });
    const [rows] = await pool.query(`SELECT * FROM workflows WHERE id = ?`, [workflow.id]);
    res.json({ data: rows[0] });
  }));

  app.post('/api/workflows/:id/enable', requireUser, requirePermission('workflows.publish'), wrap(async (req, res) => {
    const workflow = await loadWorkflow(req.user, req.params.id);
    if (!workflow.current_version_id) throw new AppError(409, 'INVALID_STATE', 'Publish a version before enabling the workflow');
    await pool.query(`UPDATE workflows SET status = 'published', updated_at = UTC_TIMESTAMP(3) WHERE id = ?`, [workflow.id]);
    await writeAudit(pool, { tenantId: req.user.tenant_id, userId: req.user.id, action: 'workflow.enable', entityType: 'workflow', entityId: workflow.id, projectId: workflow.project_id, ip: req.ip });
    const [rows] = await pool.query(`SELECT * FROM workflows WHERE id = ?`, [workflow.id]);
    res.json({ data: rows[0] });
  }));

  app.post('/api/workflows/:id/run', requireUser, requirePermission('jobs.run'), wrap(async (req, res) => {
    const workflow = await loadWorkflow(req.user, req.params.id);
    const project = await loadProject(req.user, workflow.project_id);
    const [versions] = await pool.query(`SELECT * FROM workflow_versions WHERE id = ?`, [workflow.current_version_id]);
    if (!versions[0]) throw new AppError(409, 'VERSION_NOT_PUBLISHED', 'Workflow has no published version');
    const missing = missingInput(versions[0].definition_json, req.body?.input || {});
    if (missing.length) throw new AppError(400, 'INPUT_REQUIRED', `Enter a value for ${missing.join(', ')} before running.`);
    const job = await enqueueJob(pool, cfg, {
      project, workflow, version: versions[0], user: req.user,
      input: req.body?.input || {}, triggerSource: req.body?.testRun ? 'test' : 'manual',
      idempotencyKey: req.get('Idempotency-Key') || null,
    });
    res.status(202).json({ data: presentJob(job) });
  }));

  app.get('/api/jobs', requireUser, wrap(async (req, res) => {
    const { limit, offset } = paging(req.query);
    const range = await scope(req.user);
    const where = ['tenant_id = ?', scopeSql(range, 'project_id').sql];
    const params = [req.user.tenant_id, ...scopeSql(range, 'project_id').params];
    for (const [queryKey, column] of [['projectId', 'project_id'], ['workflowId', 'workflow_id'], ['status', 'status'], ['triggerSource', 'trigger_source']]) {
      if (req.query[queryKey]) { where.push(`${column} = ?`); params.push(String(req.query[queryKey])); }
    }
    const [countRows] = await pool.query(`SELECT COUNT(*) AS total FROM automation_jobs WHERE ${where.join(' AND ')}`, params);
    const [rows] = await pool.query(
      `SELECT * FROM automation_jobs WHERE ${where.join(' AND ')} ORDER BY created_at DESC LIMIT ${limit} OFFSET ${offset}`,
      params,
    );
    res.json({ data: rows.map(presentJob), meta: { limit, offset, total: Number(countRows[0].total) } });
  }));

  app.get('/api/jobs/:id', requireUser, wrap(async (req, res) => {
    const [rows] = await pool.query(`SELECT * FROM automation_jobs WHERE id = ? AND tenant_id = ?`, [req.params.id, req.user.tenant_id]);
    if (!rows[0]) throw new AppError(404, 'NOT_FOUND', 'Job not found');
    await loadProject(req.user, rows[0].project_id);
    const [attempts] = await pool.query(`SELECT * FROM job_attempts WHERE job_id = ? ORDER BY attempt_number`, [rows[0].id]);
    const [steps] = attempts.length
      ? await pool.query(`SELECT * FROM job_step_runs WHERE attempt_id IN (${attempts.map(() => '?').join(',')}) ORDER BY started_at, CASE status WHEN 'RUNNING' THEN 0 WHEN 'SUCCEEDED' THEN 1 WHEN 'FAILED' THEN 2 ELSE 3 END`, attempts.map((attempt) => attempt.id))
      : [[]];
    const [artifacts] = await pool.query(`SELECT id, file_name, mime_type, size_bytes, created_at FROM artifacts WHERE job_id = ?`, [rows[0].id]);
    res.json({ data: { ...presentJob(rows[0]), attempts, steps, artifacts } });
  }));

  app.post('/api/jobs/:id/retry', requireUser, requirePermission('jobs.control'), wrap(async (req, res) => {
    const [rows] = await pool.query(`SELECT * FROM automation_jobs WHERE id = ? AND tenant_id = ?`, [req.params.id, req.user.tenant_id]);
    if (!rows[0]) throw new AppError(404, 'NOT_FOUND', 'Job not found');
    await loadProject(req.user, rows[0].project_id);
    const job = await retryJob(pool, rows[0], cfg);
    await writeAudit(pool, { tenantId: req.user.tenant_id, userId: req.user.id, action: 'job.retry', entityType: 'job', entityId: job.id, projectId: job.project_id, ip: req.ip });
    res.json({ data: presentJob(job) });
  }));

  app.post('/api/jobs/:id/cancel', requireUser, requirePermission('jobs.control'), wrap(async (req, res) => {
    const [rows] = await pool.query(`SELECT * FROM automation_jobs WHERE id = ? AND tenant_id = ?`, [req.params.id, req.user.tenant_id]);
    if (!rows[0]) throw new AppError(404, 'NOT_FOUND', 'Job not found');
    await loadProject(req.user, rows[0].project_id);
    const job = await cancelJob(pool, rows[0]);
    res.json({ data: presentJob(job) });
  }));

  app.get('/api/schedules', requireUser, wrap(async (req, res) => {
    const range = await scope(req.user);
    const [rows] = await pool.query(
      `SELECT * FROM schedules WHERE tenant_id = ? AND ${scopeSql(range, 'project_id').sql} ORDER BY created_at DESC`,
      [req.user.tenant_id, ...scopeSql(range, 'project_id').params],
    );
    res.json({ data: rows });
  }));

  app.post('/api/schedules', requireUser, requirePermission('schedules.write'), wrap(async (req, res) => {
    const body = z.object({
      projectId: z.string().uuid(),
      workflowId: z.string().uuid(),
      name: z.string().trim().min(1).max(200),
      scheduleType: z.enum(['manual', 'once', 'recurring']),
      cronExpression: z.string().max(120).optional(),
      runAt: z.string().datetime().optional(),
      timezone: z.string().min(1).max(64).default('UTC'),
      overlapPolicy: z.enum(['skip', 'queue']).default('skip'),
      input: z.record(z.any()).optional().default({}),
      enabled: z.boolean().default(true),
    }).safeParse(req.body);
    if (!body.success) throw validationError(body.error.issues);
    const project = await loadProject(req.user, body.data.projectId, true);
    const workflow = await loadWorkflow(req.user, body.data.workflowId);
    if (workflow.project_id !== project.id) throw new AppError(400, 'VALIDATION', 'Workflow does not belong to the project');
    try {
      new Intl.DateTimeFormat('en-US', { timeZone: body.data.timezone }).format(new Date());
    } catch {
      throw validationError([{ path: 'timezone', message: 'Unknown time zone' }]);
    }
    let next = null;
    if (body.data.scheduleType === 'recurring') {
      if (!body.data.cronExpression) throw validationError([{ path: 'cronExpression', message: 'cronExpression is required' }]);
      next = cronNext(body.data.cronExpression, body.data.timezone);
    } else if (body.data.scheduleType === 'once') {
      if (!body.data.runAt) throw validationError([{ path: 'runAt', message: 'runAt is required' }]);
      next = new Date(body.data.runAt).toISOString().slice(0, 23).replace('T', ' ');
    }
    const id = crypto.randomUUID();
    await pool.query(
      `INSERT INTO schedules (
        id, tenant_id, project_id, workflow_id, name, schedule_type, cron_expression, run_at, timezone,
        enabled, overlap_policy, input_json, next_run_at, created_by, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, UTC_TIMESTAMP(3), UTC_TIMESTAMP(3))`,
      [id, project.tenant_id, project.id, workflow.id, body.data.name, body.data.scheduleType, body.data.cronExpression || null, body.data.runAt ? next : null, body.data.timezone, body.data.enabled ? 1 : 0, body.data.overlapPolicy, JSON.stringify(body.data.input), body.data.enabled ? next : null, req.user.id],
    );
    const [rows] = await pool.query(`SELECT * FROM schedules WHERE id = ?`, [id]);
    res.status(201).json({ data: rows[0] });
  }));

  async function loadSchedule(user, id) {
    const [rows] = await pool.query(`SELECT * FROM schedules WHERE id = ? AND tenant_id = ?`, [id, user.tenant_id]);
    if (!rows[0]) throw new AppError(404, 'NOT_FOUND', 'Schedule not found');
    await loadProject(user, rows[0].project_id);
    return rows[0];
  }

  app.get('/api/schedules/:id/runs', requireUser, wrap(async (req, res) => {
    const schedule = await loadSchedule(req.user, req.params.id);
    const [rows] = await pool.query(
      `SELECT id, job_id, status, reason, triggered_at FROM schedule_runs WHERE schedule_id = ? ORDER BY triggered_at DESC LIMIT 100`,
      [schedule.id],
    );
    res.json({ data: rows });
  }));

  app.post('/api/schedules/:id/disable', requireUser, requirePermission('schedules.write'), wrap(async (req, res) => {
    const schedule = await loadSchedule(req.user, req.params.id);
    await pool.query(`UPDATE schedules SET enabled = 0, updated_at = UTC_TIMESTAMP(3) WHERE id = ?`, [schedule.id]);
    await writeAudit(pool, { tenantId: req.user.tenant_id, userId: req.user.id, action: 'schedule.disable', entityType: 'schedule', entityId: schedule.id, projectId: schedule.project_id, ip: req.ip });
    const [rows] = await pool.query(`SELECT * FROM schedules WHERE id = ?`, [schedule.id]);
    res.json({ data: rows[0] });
  }));

  app.post('/api/schedules/:id/enable', requireUser, requirePermission('schedules.write'), wrap(async (req, res) => {
    const schedule = await loadSchedule(req.user, req.params.id);
    let next = schedule.next_run_at;
    if (schedule.schedule_type === 'recurring') {
      next = cronNext(schedule.cron_expression, schedule.timezone || 'UTC');
    } else if (schedule.schedule_type === 'once') {
      if (!schedule.run_at || new Date(`${String(schedule.run_at).replace(" ", "T")}Z`) < new Date()) {
        throw new AppError(409, 'INVALID_STATE', 'A one-time schedule whose time has passed cannot be enabled. Create a new schedule.');
      }
      next = schedule.run_at;
    }
    await pool.query(`UPDATE schedules SET enabled = 1, next_run_at = ?, lock_until = NULL, updated_at = UTC_TIMESTAMP(3) WHERE id = ?`, [next, schedule.id]);
    await writeAudit(pool, { tenantId: req.user.tenant_id, userId: req.user.id, action: 'schedule.enable', entityType: 'schedule', entityId: schedule.id, projectId: schedule.project_id, ip: req.ip });
    const [rows] = await pool.query(`SELECT * FROM schedules WHERE id = ?`, [schedule.id]);
    res.json({ data: rows[0] });
  }));

  app.get('/api/reports/executions', requireUser, wrap(async (req, res) => {
    const range = await scope(req.user);
    const where = ['j.tenant_id = ?', scopeSql(range, 'j.project_id').sql];
    const params = [req.user.tenant_id, ...scopeSql(range, 'j.project_id').params];
    if (req.query.projectId) { where.push('j.project_id = ?'); params.push(String(req.query.projectId)); }
    if (req.query.workflowId) { where.push('j.workflow_id = ?'); params.push(String(req.query.workflowId)); }
    if (req.query.status) { where.push('j.status = ?'); params.push(String(req.query.status)); }
    const [rows] = await pool.query(
      `SELECT j.id, j.project_id, p.name AS project_name, j.workflow_id, w.name AS workflow_name,
              v.version_number, j.trigger_source, j.status, j.queued_at, j.started_at, j.finished_at,
              j.current_attempt, j.error_summary
       FROM automation_jobs j
       JOIN projects p ON p.id = j.project_id
       JOIN workflows w ON w.id = j.workflow_id
       JOIN workflow_versions v ON v.id = j.workflow_version_id
       WHERE ${where.join(' AND ')}
       ORDER BY j.created_at DESC LIMIT 500`,
      params,
    );
    res.json({ data: rows });
  }));

  async function exportRows(req) {
    const range = await scope(req.user);
    const where = ['j.tenant_id = ?', scopeSql(range, 'j.project_id').sql];
    const params = [req.user.tenant_id, ...scopeSql(range, 'j.project_id').params];
    if (req.query.projectId) { where.push('j.project_id = ?'); params.push(String(req.query.projectId)); }
    if (req.query.workflowId) { where.push('j.workflow_id = ?'); params.push(String(req.query.workflowId)); }
    if (req.query.status) { where.push('j.status = ?'); params.push(String(req.query.status)); }
    if (req.query.trigger) { where.push('j.trigger_source = ?'); params.push(String(req.query.trigger)); }
    if (req.query.from) { where.push('j.created_at >= ?'); params.push(parsedDate(req.query.from, 'from')); }
    if (req.query.to) { where.push('j.created_at <= ?'); params.push(parsedDate(req.query.to, 'to')); }
    const [rows] = await pool.query(
      `SELECT j.id, j.project_id, p.name AS project_name, j.workflow_id, w.name AS workflow_name, j.status, j.trigger_source,
              j.current_attempt AS attempts, j.queued_at, j.started_at, j.finished_at,
              CASE WHEN j.started_at IS NOT NULL AND j.finished_at IS NOT NULL
                THEN TIMESTAMPDIFF(MICROSECOND, j.started_at, j.finished_at) DIV 1000 END AS duration_ms,
              j.error_summary
       FROM automation_jobs j JOIN projects p ON p.id = j.project_id JOIN workflows w ON w.id = j.workflow_id
       WHERE ${where.join(' AND ')} ORDER BY j.created_at DESC LIMIT 5000`,
      params,
    );
    return rows;
  }

  app.get('/api/reports/export.csv', requireUser, wrap(async (req, res) => {
    const rows = await exportRows(req);
    const columns = ['id', 'project_id', 'project_name', 'workflow_id', 'workflow_name', 'status', 'trigger_source', 'attempts', 'queued_at', 'started_at', 'finished_at', 'duration_ms', 'error_summary'];
    const csv = stringify(rows.map((row) => Object.fromEntries(columns.map((column) => [column, csvCell(row[column])]))), { header: true, columns });
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', 'attachment; filename="executions.csv"');
    res.send(csv);
  }));

  app.get('/api/reports/export.xlsx', requireUser, wrap(async (req, res) => {
    const rows = await exportRows(req);
    const workbook = new ExcelJS.Workbook();
    const sheet = workbook.addWorksheet('Executions');
    sheet.addRow(['Job', 'Project', 'Workflow', 'Status', 'Trigger', 'Attempts', 'Queued', 'Started', 'Finished', 'Duration (ms)', 'Error']);
    sheet.getRow(1).font = { bold: true };
    for (const row of rows) {
      sheet.addRow([row.id, csvCell(row.project_name), csvCell(row.workflow_name), row.status, row.trigger_source, Number(row.attempts), row.queued_at, row.started_at, row.finished_at, row.duration_ms == null ? null : Number(row.duration_ms), csvCell(row.error_summary)]);
    }
    sheet.columns.forEach((column) => { column.width = 22; });
    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', 'attachment; filename="executions.xlsx"');
    await workbook.xlsx.write(res);
    res.end();
  }));

  registerInsightsRoutes(app, { pool, cfg, wrap, paging, requireUser, scope, scopeSql });
  registerPlatformRoutes(app, { pool, wrap, paging, requireUser, like });
  app.patch('/api/settings/tenant', requireUser, requirePermission('users.manage'), wrap(async (req, res) => {
    const body = z.object({ name: z.string().trim().min(2).max(200) }).safeParse(req.body);
    if (!body.success) throw validationError(body.error.issues);
    await pool.query(`UPDATE tenants SET name = ?, updated_at = UTC_TIMESTAMP(3) WHERE id = ?`, [body.data.name, req.user.tenant_id]);
    await writeAudit(pool, { tenantId: req.user.tenant_id, userId: req.user.id, action: 'settings.tenant_updated', entityType: 'tenant', entityId: req.user.tenant_id, metadata: { name: body.data.name }, ip: req.ip });
    res.json({ data: { name: body.data.name } });
  }));
  registerAuditRoutes(app, { pool, wrap, paging, requireUser, scope, like, auditScope, csvCell });

  app.post('/api/projects/:id/files', requireUser, requirePermission('workflows.write'), upload.single('file'), wrap(async (req, res) => {
    const project = await loadProject(req.user, req.params.id, true);
    if (!req.file) throw validationError([{ path: 'file', message: 'file is required' }]);
    const original = path.basename(req.file.originalname);
    if (!/^[A-Za-z0-9._ -]{1,120}$/.test(original) || !/\.(csv|xlsx|pdf|txt|json|png|jpe?g|tiff?|bmp)$/i.test(original)) {
      throw new AppError(400, 'FILE_TYPE', 'Upload csv, xlsx, pdf, txt, json, png, jpg, tif, or bmp files with a simple file name');
    }
    const head = req.file.buffer.subarray(0, 4);
    const imageChecks = { png: () => head.toString('hex') === '89504e47', jpg: () => head.subarray(0, 3).toString('hex') === 'ffd8ff', jpeg: () => head.subarray(0, 3).toString('hex') === 'ffd8ff', tif: () => ['49492a00', '4d4d002a'].includes(head.toString('hex')), tiff: () => ['49492a00', '4d4d002a'].includes(head.toString('hex')), bmp: () => head.subarray(0, 2).toString() === 'BM' };
    const extension = original.split('.').pop().toLowerCase();
    if (imageChecks[extension] && !imageChecks[extension]()) throw new AppError(400, 'FILE_TYPE', `Upload did not look like a ${extension.toUpperCase()} image`);
    if (original.toLowerCase().endsWith('.pdf') && req.file.buffer.subarray(0, 5).toString() !== '%PDF-') {
      throw new AppError(400, 'FILE_TYPE', 'PDF upload did not look like a PDF');
    }
    const relative = path.join('uploads', `${crypto.randomUUID()}-${original}`);
    const absolute = resolveInside(path.join(cfg.storageRoot, project.tenant_id, project.id), relative);
    await fs.mkdir(path.dirname(absolute), { recursive: true });
    await fs.writeFile(absolute, req.file.buffer);
    const id = crypto.randomUUID();
    await pool.query(
      `INSERT INTO artifacts (id, tenant_id, project_id, file_name, storage_path, mime_type, size_bytes, checksum_sha256, created_by, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, UTC_TIMESTAMP(3))`,
      [id, project.tenant_id, project.id, original, relative, req.file.mimetype || 'application/octet-stream', req.file.size, sha256(req.file.buffer), req.user.id],
    );
    res.status(201).json({ data: { id, fileName: original, path: relative, size: req.file.size } });
  }));

  app.get('/api/artifacts/:id/download', requireUser, wrap(async (req, res) => {
    const [rows] = await pool.query(`SELECT * FROM artifacts WHERE id = ? AND tenant_id = ?`, [req.params.id, req.user.tenant_id]);
    if (!rows[0]) throw new AppError(404, 'NOT_FOUND', 'Artifact not found');
    await loadProject(req.user, rows[0].project_id);
    const absolute = resolveInside(path.join(cfg.storageRoot, rows[0].tenant_id, rows[0].project_id), rows[0].storage_path);
    res.set('X-Content-Type-Options', 'nosniff');
    res.download(absolute, path.basename(rows[0].file_name), { dotfiles: 'deny' });
  }));

  app.get('/api/settings', requireUser, wrap(async (req, res) => {
    const [tenants] = await pool.query(`SELECT id, name, slug, isolation_enabled FROM tenants WHERE id = ?`, [req.user.tenant_id]);
    const [robots] = await pool.query(
      `SELECT id, name, adapter, status, last_heartbeat_at, last_error,
              last_heartbeat_at >= DATE_SUB(UTC_TIMESTAMP(3), INTERVAL 60 SECOND) AS fresh
       FROM automation_robots WHERE tenant_id = ?`,
      [req.user.tenant_id],
    );
    res.json({ data: {
      tenant: tenants[0],
      robots: robots.map((robot) => ({
        id: robot.id,
        name: robot.name,
        adapter: robot.adapter,
        status: robot.status,
        lastHeartbeatAt: robot.last_heartbeat_at,
        lastError: robot.last_error,
        reportedAvailable: Boolean(robot.fresh),
      })),
      orchestratorConfigured: Boolean(cfg.orchestrator.baseUrl && cfg.orchestrator.token && cfg.orchestrator.releaseKey),
      storageConfigured: true,
    } });
  }));

  app.post('/api/robots', requireUser, requirePermission('robots.manage'), wrap(async (req, res) => {
    const body = z.object({
      name: z.string().trim().min(1).max(200),
      adapter: z.enum(['local_file_handoff', 'orchestrator', 'contract_simulator']),
      projectIds: z.array(z.string().uuid()).min(1),
    }).safeParse(req.body);
    if (!body.success) throw validationError(body.error.issues);
    for (const projectId of body.data.projectIds) await loadProject(req.user, projectId);
    const token = crypto.randomBytes(24).toString('hex');
    const id = crypto.randomUUID();
    await pool.query(
      `INSERT INTO automation_robots (id, tenant_id, name, adapter, status, config_json, token_hash, created_at, updated_at)
       VALUES (?, ?, ?, ?, 'unknown', JSON_OBJECT(), ?, UTC_TIMESTAMP(3), UTC_TIMESTAMP(3))`,
      [id, req.user.tenant_id, body.data.name, body.data.adapter, sha256(token)],
    );
    for (const projectId of body.data.projectIds) {
      await pool.query(
        `INSERT INTO robot_project_access (robot_id, project_id, created_at) VALUES (?, ?, UTC_TIMESTAMP(3))`,
        [id, projectId],
      );
    }
    res.status(201).json({ data: { id, token, adapter: body.data.adapter } });
  }));

  async function requireRobot(req, _res, next) {
    try {
      const header = req.headers.authorization || '';
      const token = header.startsWith('Bearer ') ? header.slice(7) : '';
      if (!token) throw new AppError(401, 'UNAUTHORIZED', 'Robot authentication required');
      const [rows] = await pool.query(
        `SELECT r.*, t.status AS tenant_status FROM automation_robots r JOIN tenants t ON t.id = r.tenant_id WHERE r.token_hash = ?`,
        [sha256(token)],
      );
      if (!rows[0]) throw new AppError(401, 'UNAUTHORIZED', 'Robot authentication required');
      if (rows[0].tenant_status === 'suspended') throw suspendedError();
      const [projects] = await pool.query(`SELECT project_id FROM robot_project_access WHERE robot_id = ?`, [rows[0].id]);
      req.robot = rows[0];
      req.robotProjectIds = projects.map((row) => row.project_id);
      next();
    } catch (error) {
      next(error instanceof AppError ? error : new AppError(401, 'UNAUTHORIZED', 'Robot authentication required'));
    }
  }

  app.post('/api/robot/heartbeat', requireRobot, wrap(async (req, res) => {
    // Optional self-description shown in Settings > Robots. Short plain strings only.
    const info = z.object({ machine: z.string().trim().max(100).regex(/^[\w .@()-]*$/).optional(), version: z.string().trim().max(40).regex(/^[\w .+-]*$/).optional() }).safeParse(req.body || {});
    if (info.success && (info.data.machine || info.data.version)) {
      await pool.query(
        `UPDATE automation_robots SET config_json = JSON_SET(COALESCE(config_json, JSON_OBJECT()), '$.machine', ?, '$.version', ?) WHERE id = ?`,
        [info.data.machine || null, info.data.version || null, req.robot.id],
      );
    }
    await recordHeartbeat(pool, req.robot);
    res.json({ data: { status: 'available', robotId: req.robot.id } });
  }));

  app.get('/api/robot/queue', requireRobot, wrap(async (req, res) => {
    if (!req.robotProjectIds.length) {
      res.json({ data: [] });
      return;
    }
    const [rows] = await pool.query(
      `SELECT * FROM automation_jobs
       WHERE execution_target = 'robot' AND status = 'QUEUED' AND project_id IN (${req.robotProjectIds.map(() => '?').join(',')})
       ORDER BY queued_at ASC LIMIT 20`,
      req.robotProjectIds,
    );
    res.json({ data: rows.map(presentJob) });
  }));

  app.post('/api/robot/jobs/:id/result', requireRobot, wrap(async (req, res) => {
    const job = await applyRobotResult(pool, cfg, { ...req.body, jobId: req.params.id }, { robot: req.robot, projectIds: req.robotProjectIds });
    res.json({ data: presentJob(job) });
  }));

  app.patch('/api/users/:id', requireUser, requirePermission('users.manage'), wrap(async (req, res) => {
    const body = z.object({
      displayName: z.string().trim().min(1).max(200).optional(),
      role: z.enum(['administrator', 'project_manager', 'automation_developer', 'operator', 'viewer']).optional(),
      status: z.enum(['active', 'disabled']).optional(),
      password: z.string().min(12).max(200).optional(),
    }).strict().safeParse(req.body);
    if (!body.success) throw validationError(body.error.issues);
    const [rows] = await pool.query(`SELECT * FROM users WHERE id = ? AND tenant_id = ?`, [req.params.id, req.user.tenant_id]);
    const target = rows[0];
    if (!target) throw new AppError(404, 'NOT_FOUND', 'User not found');
    if (target.id === req.user.id && (body.data.status === 'disabled' || (body.data.role && body.data.role !== 'administrator'))) {
      throw new AppError(409, 'SELF_LOCKOUT', 'You cannot disable yourself or remove your own administrator role');
    }
    await pool.query(
      `UPDATE users SET display_name = ?, role = ?, status = ?, password_hash = ?, updated_at = UTC_TIMESTAMP(3) WHERE id = ?`,
      [
        body.data.displayName ?? target.display_name,
        body.data.role ?? target.role,
        body.data.status ?? target.status,
        body.data.password ? await hashPassword(body.data.password, cfg.bcryptRounds) : target.password_hash,
        target.id,
      ],
    );
    if (body.data.status === 'disabled' || body.data.password) {
      await pool.query(`UPDATE refresh_tokens SET revoked_at = UTC_TIMESTAMP(3) WHERE user_id = ? AND revoked_at IS NULL`, [target.id]);
    }
    await writeAudit(pool, {
      tenantId: req.user.tenant_id, userId: req.user.id, action: 'user.update', entityType: 'user', entityId: target.id, ip: req.ip,
      metadata: { fields: Object.keys(body.data).filter((key) => key !== 'password'), passwordReset: Boolean(body.data.password) },
    });
    const [updated] = await pool.query(`SELECT * FROM users WHERE id = ?`, [target.id]);
    res.json({ data: presentUser(updated[0]) });
  }));

  app.get('/api/notifications', requireUser, wrap(async (req, res) => {
    const { limit, offset } = paging(req.query);
    const range = await scope(req.user);
    const visible = scopeSql(range, 'project_id');
    const [rows] = await pool.query(
      `SELECT id, project_id, job_id, channel, subject, body, created_at FROM notifications
       WHERE tenant_id = ? AND ${visible.sql} ORDER BY created_at DESC LIMIT ${limit} OFFSET ${offset}`,
      [req.user.tenant_id, ...visible.params],
    );
    res.json({ data: rows, meta: { limit, offset } });
  }));

  app.get('/api/projects/:id/files', requireUser, wrap(async (req, res) => {
    const project = await loadProject(req.user, req.params.id);
    const [rows] = await pool.query(
      `SELECT id, file_name, storage_path, mime_type, size_bytes, job_id, created_at FROM artifacts
       WHERE project_id = ? ORDER BY created_at DESC LIMIT 200`,
      [project.id],
    );
    res.json({ data: rows.map((row) => ({
      id: row.id, fileName: row.file_name, path: row.storage_path, mimeType: row.mime_type,
      size: Number(row.size_bytes), jobId: row.job_id, source: row.job_id ? 'job' : 'upload', createdAt: row.created_at,
    })) });
  }));

  app.get('/api/robots', requireUser, requirePermission('robots.manage'), wrap(async (req, res) => {
    const [robots] = await pool.query(
      `SELECT r.id, r.name, r.adapter, r.status, r.last_heartbeat_at, r.created_at,
              r.last_heartbeat_at >= DATE_SUB(UTC_TIMESTAMP(3), INTERVAL 60 SECOND) AS fresh
       FROM automation_robots r WHERE r.tenant_id = ? ORDER BY r.name`,
      [req.user.tenant_id],
    );
    const [access] = robots.length
      ? await pool.query(`SELECT robot_id, project_id FROM robot_project_access WHERE robot_id IN (${robots.map(() => '?').join(',')})`, robots.map((robot) => robot.id))
      : [[]];
    res.json({ data: robots.map((robot) => ({
      id: robot.id, name: robot.name, adapter: robot.adapter, status: robot.status, lastHeartbeatAt: robot.last_heartbeat_at,
      reportedAvailable: Boolean(robot.fresh), createdAt: robot.created_at,
      projectIds: access.filter((row) => row.robot_id === robot.id).map((row) => row.project_id),
    })) });
  }));

  app.post('/api/robots/:id/rotate-token', requireUser, requirePermission('robots.manage'), wrap(async (req, res) => {
    const token = crypto.randomBytes(24).toString('hex');
    const [result] = await pool.query(
      `UPDATE automation_robots SET token_hash = ?, status = 'unknown', updated_at = UTC_TIMESTAMP(3) WHERE id = ? AND tenant_id = ?`,
      [sha256(token), req.params.id, req.user.tenant_id],
    );
    if (!result.affectedRows) throw new AppError(404, 'NOT_FOUND', 'Robot not found');
    await writeAudit(pool, { tenantId: req.user.tenant_id, userId: req.user.id, action: 'robot.rotate_token', entityType: 'robot', entityId: req.params.id, ip: req.ip });
    res.json({ data: { id: req.params.id, token } });
  }));

  // Work queues (Orchestrator-style transactions).
  async function loadQueue(user, id, writable = false) {
    const [rows] = await pool.query(`SELECT * FROM work_queues WHERE id = ? AND tenant_id = ?`, [id, user.tenant_id]);
    if (!rows[0]) throw new AppError(404, 'NOT_FOUND', 'Queue not found');
    await loadProject(user, rows[0].project_id, writable);
    return rows[0];
  }

  async function loadQueueItem(user, id) {
    const [rows] = await pool.query(`SELECT * FROM queue_items WHERE id = ? AND tenant_id = ?`, [id, user.tenant_id]);
    if (!rows[0]) throw new AppError(404, 'NOT_FOUND', 'Queue item not found');
    await loadProject(user, rows[0].project_id);
    return rows[0];
  }

  const itemSchema = z.object({
    reference: z.string().trim().max(200).optional(),
    specificContent: z.record(z.any()).optional().default({}),
    priority: z.enum(['low', 'normal', 'high']).optional().default('normal'),
    deferUntil: z.string().datetime().optional(),
    dueAt: z.string().datetime().optional(),
  });

  async function validTriggerWorkflow(user, projectId, workflowId) {
    if (!workflowId) return null;
    const workflow = await loadWorkflow(user, workflowId);
    if (workflow.project_id !== projectId) throw validationError([{ path: 'triggerWorkflowId', message: 'Trigger workflow must belong to the queue project' }]);
    return workflow.id;
  }

  app.get('/api/queues', requireUser, wrap(async (req, res) => {
    const range = await scope(req.user);
    const visible = scopeSql(range, 'project_id');
    const where = ['tenant_id = ?', visible.sql];
    const params = [req.user.tenant_id, ...visible.params];
    if (req.query.projectId) { where.push('project_id = ?'); params.push(String(req.query.projectId)); }
    const [rows] = await pool.query(`SELECT * FROM work_queues WHERE ${where.join(' AND ')} ORDER BY name`, params);
    const counts = await queueCounts(pool, rows.map((row) => row.id));
    res.json({ data: rows.map((row) => presentQueue(row, counts.get(row.id))) });
  }));

  app.post('/api/queues', requireUser, requirePermission('queues.write'), wrap(async (req, res) => {
    const body = z.object({
      projectId: z.string().uuid(),
      name: z.string().trim().regex(/^[A-Za-z0-9 _.-]{1,120}$/, 'Use letters, numbers, spaces, dot, dash, or underscore'),
      description: z.string().max(1000).optional().default(''),
      maxRetries: z.number().int().min(0).max(10).default(0),
      uniqueReference: z.boolean().default(false),
      triggerWorkflowId: z.string().uuid().nullable().optional(),
      triggerEnabled: z.boolean().default(false),
    }).safeParse(req.body);
    if (!body.success) throw validationError(body.error.issues);
    const project = await loadProject(req.user, body.data.projectId, true);
    const triggerWorkflowId = await validTriggerWorkflow(req.user, project.id, body.data.triggerWorkflowId);
    const id = crypto.randomUUID();
    await pool.query(
      `INSERT INTO work_queues (id, tenant_id, project_id, name, description, max_retries, unique_reference, trigger_workflow_id,
         trigger_enabled, status, created_by, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'active', ?, UTC_TIMESTAMP(3), UTC_TIMESTAMP(3))`,
      [id, project.tenant_id, project.id, body.data.name, body.data.description, body.data.maxRetries, body.data.uniqueReference ? 1 : 0,
        triggerWorkflowId, triggerWorkflowId && body.data.triggerEnabled ? 1 : 0, req.user.id],
    );
    await writeAudit(pool, { tenantId: req.user.tenant_id, userId: req.user.id, action: 'queue.create', entityType: 'work_queue', entityId: id, projectId: project.id, ip: req.ip });
    const [rows] = await pool.query(`SELECT * FROM work_queues WHERE id = ?`, [id]);
    res.status(201).json({ data: presentQueue(rows[0]) });
  }));

  app.get('/api/queues/:id', requireUser, wrap(async (req, res) => {
    const queue = await loadQueue(req.user, req.params.id);
    const counts = await queueCounts(pool, [queue.id]);
    res.json({ data: presentQueue(queue, counts.get(queue.id)) });
  }));

  app.patch('/api/queues/:id', requireUser, requirePermission('queues.write'), wrap(async (req, res) => {
    const queue = await loadQueue(req.user, req.params.id, true);
    const body = z.object({
      description: z.string().max(1000).optional(),
      maxRetries: z.number().int().min(0).max(10).optional(),
      triggerWorkflowId: z.string().uuid().nullable().optional(),
      triggerEnabled: z.boolean().optional(),
      status: z.enum(['active', 'archived']).optional(),
    }).strict().safeParse(req.body);
    if (!body.success) throw validationError(body.error.issues);
    const triggerWorkflowId = body.data.triggerWorkflowId === undefined
      ? queue.trigger_workflow_id
      : await validTriggerWorkflow(req.user, queue.project_id, body.data.triggerWorkflowId);
    const triggerEnabled = body.data.triggerEnabled ?? Boolean(queue.trigger_enabled);
    await pool.query(
      `UPDATE work_queues SET description = ?, max_retries = ?, trigger_workflow_id = ?, trigger_enabled = ?, status = ?, updated_at = UTC_TIMESTAMP(3) WHERE id = ?`,
      [body.data.description ?? queue.description, body.data.maxRetries ?? queue.max_retries, triggerWorkflowId,
        triggerWorkflowId && triggerEnabled ? 1 : 0, body.data.status ?? queue.status, queue.id],
    );
    await writeAudit(pool, { tenantId: req.user.tenant_id, userId: req.user.id, action: 'queue.update', entityType: 'work_queue', entityId: queue.id, projectId: queue.project_id, metadata: body.data, ip: req.ip });
    const [rows] = await pool.query(`SELECT * FROM work_queues WHERE id = ?`, [queue.id]);
    res.json({ data: presentQueue(rows[0]) });
  }));

  app.get('/api/queues/:id/items', requireUser, wrap(async (req, res) => {
    const { limit, offset } = paging(req.query);
    const queue = await loadQueue(req.user, req.params.id);
    const where = ['queue_id = ?'];
    const params = [queue.id];
    if (req.query.status) {
      if (!QUEUE_ITEM_STATUSES.includes(String(req.query.status))) throw validationError([{ path: 'status', message: 'Unknown queue item status' }]);
      where.push('status = ?'); params.push(String(req.query.status));
    }
    if (req.query.reference) { where.push(`reference LIKE ? ESCAPE '\\\\'`); params.push(like(req.query.reference)); }
    const [countRows] = await pool.query(`SELECT COUNT(*) AS total FROM queue_items WHERE ${where.join(' AND ')}`, params);
    const [rows] = await pool.query(
      `SELECT * FROM queue_items WHERE ${where.join(' AND ')} ORDER BY created_at DESC LIMIT ${limit} OFFSET ${offset}`,
      params,
    );
    res.json({ data: rows.map(presentItem), meta: { limit, offset, total: Number(countRows[0].total) } });
  }));

  app.post('/api/queues/:id/items', requireUser, requirePermission('queues.items'), wrap(async (req, res) => {
    const queue = await loadQueue(req.user, req.params.id, true);
    if (queue.status !== 'active') throw new AppError(409, 'QUEUE_ARCHIVED', 'Queue is archived');
    const many = Array.isArray(req.body?.items);
    const parsed = (many ? z.array(itemSchema).min(1).max(500) : itemSchema).safeParse(many ? req.body.items : req.body);
    if (!parsed.success) throw validationError(parsed.error.issues);
    const created = [];
    for (const item of many ? parsed.data : [parsed.data]) {
      created.push(presentItem(await addQueueItem(pool, queue, { ...item, userId: req.user.id })));
    }
    await writeAudit(pool, { tenantId: req.user.tenant_id, userId: req.user.id, action: 'queue.items_add', entityType: 'work_queue', entityId: queue.id, projectId: queue.project_id, metadata: { count: created.length }, ip: req.ip });
    res.status(201).json({ data: many ? created : created[0] });
  }));

  app.post('/api/queue-items/:id/retry', requireUser, requirePermission('jobs.control'), wrap(async (req, res) => {
    const item = await loadQueueItem(req.user, req.params.id);
    const updated = await retryItem(pool, item);
    await writeAudit(pool, { tenantId: req.user.tenant_id, userId: req.user.id, action: 'queue_item.retry', entityType: 'queue_item', entityId: item.id, projectId: item.project_id, ip: req.ip });
    res.json({ data: presentItem(updated) });
  }));

  app.post('/api/queue-items/:id/delete', requireUser, requirePermission('jobs.control'), wrap(async (req, res) => {
    const item = await loadQueueItem(req.user, req.params.id);
    const updated = await deleteItem(pool, item);
    await writeAudit(pool, { tenantId: req.user.tenant_id, userId: req.user.id, action: 'queue_item.delete', entityType: 'queue_item', entityId: item.id, projectId: item.project_id, ip: req.ip });
    res.json({ data: presentItem(updated) });
  }));

  // Robot-side endpoints for claiming jobs and consuming queues.
  app.post('/api/robot/jobs/:id/claim', requireRobot, wrap(async (req, res) => {
    const job = await claimRobotJob(pool, req.params.id, req.robot, req.robotProjectIds);
    await writeAudit(pool, { tenantId: job.tenant_id, robotId: req.robot.id, action: 'job.robot_claim', entityType: 'job', entityId: job.id, projectId: job.project_id });
    res.json({ data: { ...presentJob(job), workflowVersionId: job.workflow_version_id } });
  }));

  async function robotQueue(req) {
    const [rows] = await pool.query(`SELECT * FROM work_queues WHERE id = ? AND tenant_id = ?`, [req.params.id, req.robot.tenant_id]);
    if (!rows[0]) throw new AppError(404, 'NOT_FOUND', 'Queue not found');
    if (!req.robotProjectIds.includes(rows[0].project_id)) throw new AppError(403, 'FORBIDDEN', 'Robot is not authorized for this queue');
    if (rows[0].status !== 'active') throw new AppError(409, 'QUEUE_ARCHIVED', 'Queue is archived');
    return rows[0];
  }

  app.post('/api/robot/queues/:id/items', requireRobot, wrap(async (req, res) => {
    const queue = await robotQueue(req);
    const parsed = itemSchema.safeParse(req.body);
    if (!parsed.success) throw validationError(parsed.error.issues);
    const item = await addQueueItem(pool, queue, parsed.data);
    res.status(201).json({ data: presentItem(item) });
  }));

  app.post('/api/robot/queues/:id/next', requireRobot, wrap(async (req, res) => {
    const queue = await robotQueue(req);
    const items = await getNextItems(pool, queue, { count: 1, robotId: req.robot.id });
    res.json({ data: items[0] ? presentItem(items[0]) : null });
  }));

  app.post('/api/robot/queue-items/:id/result', requireRobot, wrap(async (req, res) => {
    const item = await setItemResult(pool, req.params.id, req.body || {}, { tenantId: req.robot.tenant_id, projectIds: req.robotProjectIds });
    res.json({ data: presentItem(item) });
  }));

  // ---- Action Center ---------------------------------------------------------------------
  const TASK_SELECT = `SELECT t.*, p.name AS project_name, w.name AS workflow_name, au.email AS assigned_user_email, cu.email AS completed_by_email
    FROM action_tasks t
    JOIN projects p ON p.id = t.project_id
    LEFT JOIN workflows w ON w.id = t.workflow_id
    LEFT JOIN users au ON au.id = t.assigned_user_id
    LEFT JOIN users cu ON cu.id = t.completed_by`;

  async function loadTask(user, id) {
    const [rows] = await pool.query(`${TASK_SELECT} WHERE t.id = ? AND t.tenant_id = ?`, [id, user.tenant_id]);
    if (!rows[0]) throw new AppError(404, 'NOT_FOUND', 'Task not found');
    await loadProject(user, rows[0].project_id);
    return rows[0];
  }

  app.get('/api/tasks', requireUser, wrap(async (req, res) => {
    const range = await scope(req.user);
    const visible = scopeSql(range, 't.project_id');
    const where = ['t.tenant_id = ?', visible.sql];
    const params = [req.user.tenant_id, ...visible.params];
    const status = String(req.query.status || 'pending');
    if (status !== 'all') {
      if (!['pending', 'completed', 'cancelled'].includes(status)) throw validationError([{ path: 'status', message: 'status must be pending, completed, cancelled, or all' }]);
      where.push('t.status = ?'); params.push(status);
    }
    if (req.query.projectId) { where.push('t.project_id = ?'); params.push(String(req.query.projectId)); }
    if (req.query.type) { where.push('t.task_type = ?'); params.push(String(req.query.type)); }
    if (req.query.jobId) { where.push('t.job_id = ?'); params.push(String(req.query.jobId)); }
    if (req.query.mine === 'true') { where.push('(t.assigned_user_id = ? OR (t.assigned_user_id IS NULL AND (t.assigned_role IS NULL OR t.assigned_role = ?)))'); params.push(req.user.id, req.user.role); }
    const { limit, offset } = paging(req.query);
    const [rows] = await pool.query(
      `${TASK_SELECT} WHERE ${where.join(' AND ')}
       ORDER BY t.status = 'pending' DESC, FIELD(t.priority, 'critical', 'high', 'medium', 'low'), t.created_at DESC LIMIT ? OFFSET ?`,
      [...params, limit, offset],
    );
    const [[count]] = await pool.query(`SELECT COUNT(*) AS total FROM action_tasks t WHERE ${where.join(' AND ')}`, params);
    res.json({ data: rows.map((row) => ({ ...presentTask(row), canComplete: row.status === 'pending' && canCompleteTask(req.user, row) })), meta: { total: Number(count.total), limit, offset } });
  }));

  app.get('/api/tasks/summary', requireUser, wrap(async (req, res) => {
    const range = await scope(req.user);
    const visible = scopeSql(range, 'project_id');
    const [[row]] = await pool.query(
      `SELECT COUNT(*) AS pending, SUM(assigned_user_id = ?) AS mine, SUM(due_at IS NOT NULL AND due_at < UTC_TIMESTAMP(3)) AS overdue
       FROM action_tasks WHERE tenant_id = ? AND status = 'pending' AND ${visible.sql}`,
      [req.user.id, req.user.tenant_id, ...visible.params],
    );
    res.json({ data: { pending: Number(row.pending || 0), mine: Number(row.mine || 0), overdue: Number(row.overdue || 0) } });
  }));

  app.get('/api/tasks/:id', requireUser, wrap(async (req, res) => {
    const row = await loadTask(req.user, req.params.id);
    res.json({ data: { ...presentTask(row), canComplete: row.status === 'pending' && canCompleteTask(req.user, row) } });
  }));

  app.post('/api/tasks/:id/complete', requireUser, requirePermission('tasks.complete'), wrap(async (req, res) => {
    await loadTask(req.user, req.params.id);
    const body = z.object({
      outcome: z.string().max(40).optional(),
      data: z.record(z.any()).optional().default({}),
      values: z.record(z.union([z.string().max(500), z.number(), z.boolean(), z.null()])).optional(),
      comment: z.string().max(2000).optional(),
    }).safeParse(req.body || {});
    if (!body.success) throw validationError(body.error.issues);
    const { resumedJobId } = await completeTask(pool, req.user, req.params.id, body.data);
    const row = await loadTask(req.user, req.params.id);
    // A task created by a flow: move the flow on right away instead of waiting for the worker.
    if (row.flow_run_id) await advanceRun(pool, cfg, row.flow_run_id).catch(() => {});
    // A task an agent is waiting for: continue the agent in the background.
    if (row.agent_run_id) kickAgentRun(pool, cfg, row.agent_run_id);
    // A task of a case (stage task): advance the case now.
    if (row.case_id) await notifyCase(pool, cfg, row.case_id);
    res.json({ data: { ...presentTask(row), resumedJobId } });
  }));

  app.post('/api/tasks/:id/assign', requireUser, requirePermission('tasks.complete'), wrap(async (req, res) => {
    const row = await loadTask(req.user, req.params.id);
    if (row.status !== 'pending') throw new AppError(409, 'TASK_CLOSED', `Task is already ${row.status}`);
    const userId = req.body?.userId === undefined ? req.user.id : req.body.userId;
    const manager = ['administrator', 'project_manager'].includes(req.user.role);
    if (userId !== null && userId !== req.user.id && !manager) throw new AppError(403, 'FORBIDDEN', 'Only administrators and project managers can assign tasks to other people');
    if (userId === null && row.assigned_user_id && row.assigned_user_id !== req.user.id && !manager) throw new AppError(403, 'FORBIDDEN', 'You can only release your own tasks');
    if (userId) {
      const [users] = await pool.query(`SELECT id FROM users WHERE id = ? AND tenant_id = ? AND status = 'active'`, [userId, req.user.tenant_id]);
      if (!users[0]) throw new AppError(400, 'VALIDATION', 'User not found');
    }
    await pool.query(`UPDATE action_tasks SET assigned_user_id = ?, updated_at = UTC_TIMESTAMP(3) WHERE id = ?`, [userId, row.id]);
    await writeAudit(pool, { tenantId: req.user.tenant_id, userId: req.user.id, action: 'task.assign', entityType: 'task', entityId: row.id, projectId: row.project_id, metadata: { assignedUserId: userId } });
    const fresh = await loadTask(req.user, row.id);
    res.json({ data: { ...presentTask(fresh), canComplete: canCompleteTask(req.user, fresh) } });
  }));

  // ---- Web recorder ------------------------------------------------------------------------
  const recorder = options.recorder || createRecorder({ cfg, playwright: options.playwright || null });
  app.locals.recorder = recorder;

  app.post('/api/recorder/sessions', requireUser, requirePermission('recorder.use'), wrap(async (req, res) => {
    const body = z.object({ url: z.string().url().max(2000), headless: z.boolean().optional() }).safeParse(req.body || {});
    if (!body.success) throw validationError(body.error.issues);
    const session = await recorder.start({ url: body.data.url, headless: body.data.headless, ownerId: req.user.id });
    await writeAudit(pool, { tenantId: req.user.tenant_id, userId: req.user.id, action: 'recorder.start', entityType: 'recorder', entityId: session.id, metadata: { url: body.data.url } });
    res.status(201).json({ data: session });
  }));

  app.get('/api/recorder/sessions/:id', requireUser, requirePermission('recorder.use'), wrap(async (req, res) => {
    res.json({ data: recorder.get(req.params.id, req.user.id) });
  }));

  app.post('/api/recorder/sessions/:id/mode', requireUser, requirePermission('recorder.use'), wrap(async (req, res) => {
    res.json({ data: await recorder.setMode(req.params.id, req.user.id, req.body?.mode) });
  }));

  app.post('/api/recorder/sessions/:id/stop', requireUser, requirePermission('recorder.use'), wrap(async (req, res) => {
    res.json({ data: await recorder.stop(req.params.id, req.user.id) });
  }));

  // ---- Robot agent: workflow package, step log, artifacts ----------------------------------
  async function robotJob(req) {
    const [rows] = await pool.query(`SELECT * FROM automation_jobs WHERE id = ? AND tenant_id = ?`, [req.params.id, req.robot.tenant_id]);
    const job = rows[0];
    if (!job || !req.robotProjectIds.includes(job.project_id)) throw new AppError(404, 'NOT_FOUND', 'Job not found');
    if (job.robot_id && job.robot_id !== req.robot.id) throw new AppError(403, 'FORBIDDEN', 'Another robot owns this job');
    return job;
  }

  app.get('/api/robot/jobs/:id/package', requireRobot, wrap(async (req, res) => {
    const job = await robotJob(req);
    const [versions] = await pool.query(`SELECT definition_json, version_number FROM workflow_versions WHERE id = ?`, [job.workflow_version_id]);
    res.json({ data: { jobId: job.id, projectId: job.project_id, workflowId: job.workflow_id, correlationId: job.correlation_id, status: job.status, attempt: job.current_attempt, input: job.input_json, definition: versions[0]?.definition_json, version: versions[0]?.version_number } });
  }));

  app.post('/api/robot/jobs/:id/artifacts', requireRobot, upload.single('file'), wrap(async (req, res) => {
    const job = await robotJob(req);
    if (!['RUNNING', 'CANCEL_REQUESTED'].includes(job.status)) throw new AppError(409, 'INVALID_STATE', `Job is ${job.status}`);
    if (!req.file) throw validationError([{ path: 'file', message: 'file is required' }]);
    const original = path.basename(req.file.originalname);
    if (!/^[A-Za-z0-9._ -]{1,120}$/.test(original)) throw new AppError(400, 'FILE_TYPE', 'Use a simple file name');
    const relative = path.join('robot', job.id, original).replace(/\\/g, '/');
    const absolute = resolveInside(path.join(cfg.storageRoot, job.tenant_id, job.project_id), relative);
    await fs.mkdir(path.dirname(absolute), { recursive: true });
    await fs.writeFile(absolute, req.file.buffer);
    const [attempts] = await pool.query(`SELECT id FROM job_attempts WHERE job_id = ? AND attempt_number = ?`, [job.id, job.current_attempt]);
    const id = crypto.randomUUID();
    await pool.query(
      `INSERT INTO artifacts (id, tenant_id, project_id, job_id, attempt_id, file_name, storage_path, mime_type, size_bytes, checksum_sha256, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, UTC_TIMESTAMP(3))`,
      [id, job.tenant_id, job.project_id, job.id, attempts[0]?.id || null, original, relative, mimeFor(original), req.file.size, sha256(req.file.buffer)],
    );
    res.status(201).json({ data: { id, fileName: original, path: relative } });
  }));

  registerFlowRoutes(app, { pool, cfg, wrap, paging, requireUser, requirePermission, loadProject, scope, scopeSql, like });
  registerAgentRoutes(app, { pool, cfg, wrap, paging, requireUser, requirePermission, loadProject, scope, scopeSql, like });
  registerAppRoutes(app, { pool, cfg, wrap, paging, requireUser, requirePermission, loadProject, scope, scopeSql, like, upload });
  registerCaseRoutes(app, { pool, cfg, wrap, paging, requireUser, requirePermission, loadProject, scope, scopeSql, like, upload });
  registerBpmnRoutes(app, { pool, cfg, wrap, paging, requireUser, requirePermission, loadProject, scope, scopeSql, like });

  app.use((error, _req, res, _next) => {
    if (error instanceof AppError) {
      res.status(error.status).json({ error: { code: error.code, message: error.message, details: error.details || null } });
      return;
    }
    const known = clientError(error);
    if (known) {
      res.status(known.status).json({ error: { code: known.code, message: known.message } });
      return;
    }
    console.error(JSON.stringify({ code: error.code || 'INTERNAL', message: error.message }));
    res.status(500).json({ error: { code: 'INTERNAL', message: 'An unexpected error occurred' } });
  });

  return app;
}
