import fs from 'node:fs/promises';
import path from 'node:path';
import mysql from 'mysql2/promise';
import nodemailer from 'nodemailer';
import { writeAudit } from '../db/audit.js';
import { AppError } from '../lib/errors.js';
import { decryptJson, sha256 } from '../lib/cryptoSecrets.js';
import { resolveInside } from '../lib/paths.js';
import { addQueueItem, findQueue, getNextItems, presentItem, setItemResult } from './queueService.js';
import { createBrowserManager } from '../automation/web/browserManager.js';
import { createDesktopAdapter, pickDesktopDriver } from '../automation/desktop/adapter.js';
import { ocrFile } from '../automation/documents/ocr.js';
import { runDatabaseStep, testDatabaseConnection } from '../connectors/database.js';
import { createSheetsClient } from '../connectors/googleSheets.js';
import { createTask, getTaskForJob, taskResult } from './taskService.js';
import { pingProvider, resolveProvider } from '../agent/providers.js';

const BLOCKED_HEADERS = new Set(['host', 'content-length', 'connection', 'transfer-encoding', 'cookie', 'te', 'upgrade', 'proxy-authorization']);
const MAX_ATTACHMENTS = 10;

export function attachmentEntries(value) {
  if (value == null || value === '') return [];
  const items = Array.isArray(value) ? value : [value];
  return items.flatMap((item) => String(item).split(',')).map((item) => item.trim()).filter(Boolean);
}

/** Plain-text mail plus optional HTML and files stored under the project. Paths cannot leave that folder. */
export async function buildOutgoingMail(config, storageRoot) {
  const to = String(config.to || '').trim();
  if (!to) throw new AppError(400, 'VALIDATION', 'Email recipient (to) is required');
  const paths = attachmentEntries(config.attachments);
  if (paths.length > MAX_ATTACHMENTS) throw new AppError(400, 'VALIDATION', `At most ${MAX_ATTACHMENTS} attachments`);
  const attachments = [];
  for (const relative of paths) {
    const file = resolveInside(storageRoot, relative);
    try {
      await fs.access(file);
    } catch {
      throw new AppError(400, 'FILE_NOT_FOUND', `Attachment was not found: ${relative}`);
    }
    attachments.push({ filename: path.basename(file), path: file });
  }
  const mail = {
    to,
    subject: String(config.subject || 'Automation notification'),
    text: String(config.message || ''),
    attachments,
  };
  const cc = String(config.cc || '').trim();
  const bcc = String(config.bcc || '').trim();
  if (cc) mail.cc = cc;
  if (bcc) mail.bcc = bcc;
  if (config.html) mail.html = String(config.html);
  return mail;
}

/**
 * Runtime pieces that do not need the platform database: browser, desktop, and OCR. The worker
 * runtime and the robot agent runtime both use these.
 */
export function createAutomationServices(cfg, storageRoot, overrides = {}) {
  let browser = null;
  let desktop = null;
  return {
    async web(type, config) {
      browser ||= createBrowserManager({ cfg, storageRoot, playwright: overrides.playwright || null });
      return browser.run(type, config);
    },
    async desktop(type, config) {
      desktop ||= createDesktopAdapter({ driver: overrides.desktopDriver || pickDesktopDriver(cfg) });
      return desktop.run(type, config);
    },
    async ocr(config) {
      const file = resolveInside(storageRoot, config.path);
      const result = await ocrFile(file, config, { cachePath: cfg.ocrCachePath, langPath: cfg.ocrLangPath || undefined });
      // No "path" key: step outputs with a path are stored as artifacts.
      return { file: String(config.path).replace(/\\/g, '/'), ...result };
    },
    async dispose() {
      if (browser) await browser.closeAll();
      browser = null;
    },
  };
}

async function loadConnection(pool, job, connectionId, key) {
  const [rows] = await pool.query(
    `SELECT * FROM connections WHERE id = ? AND project_id = ? AND tenant_id = ?`,
    [connectionId, job.project_id, job.tenant_id],
  );
  if (!rows[0]) throw new AppError(404, 'CONNECTION_NOT_FOUND', 'Connection was not found for this project');
  const row = rows[0];
  let secret = {};
  if (row.secret_ciphertext) {
    secret = decryptJson(row.secret_ciphertext, row.secret_iv, row.secret_tag, key);
  }
  return { ...row, config: row.config_json, secret };
}

export function createRuntime(pool, cfg, job, overrides = {}) {
  const storageRoot = path.join(cfg.storageRoot, job.tenant_id, job.project_id);
  const automation = createAutomationServices(cfg, storageRoot, overrides);
  // Type Into steps may take the text from a Credential connection (like an Orchestrator
  // credential asset) so passwords are never part of the workflow or the job input.
  async function withCredential(config) {
    if (!config.credentialId) return config;
    const connection = await loadConnection(pool, job, config.credentialId, cfg.credentialsKey);
    if (connection.connector_type !== 'credential') throw new AppError(400, 'WRONG_CONNECTOR', 'credentialId must be a Credential connection');
    const field = config.credentialField || 'password';
    const value = connection.secret?.[field] ?? connection.config?.[field];
    if (value === undefined || value === null) throw new AppError(400, 'CREDENTIAL_FIELD_MISSING', `The credential has no ${field} value`);
    return { ...config, text: String(value) };
  }
  return {
    storageRoot,
    ...automation,
    async web(type, config) {
      return automation.web(type, type === 'browser_type' ? await withCredential(config) : config);
    },
    async desktop(type, config) {
      return automation.desktop(type, type === 'desktop_type' ? await withCredential(config) : config);
    },
    async createTask(config, stepKey) {
      return taskResult(await createTask(pool, job, stepKey, config));
    },
    async getTask(taskId) {
      return taskResult(await getTaskForJob(pool, job, taskId));
    },
    async sheets(type, config) {
      const connection = await loadConnection(pool, job, config.connectionId, cfg.credentialsKey);
      if (connection.connector_type !== 'google_sheets') throw new AppError(400, 'WRONG_CONNECTOR', 'Sheets steps require a Google Sheets connection');
      const client = createSheetsClient({ config: connection.config, secret: connection.secret, fetchImpl: overrides.fetch || fetch });
      if (type === 'sheets_read_range') return client.readRange(config);
      if (type === 'sheets_append_rows') return client.appendRows(config);
      return client.updateRange(config);
    },
    async httpRequest(config) {
      const connection = await loadConnection(pool, job, config.connectionId, cfg.credentialsKey);
      if (connection.connector_type !== 'rest_api') {
        throw new AppError(400, 'WRONG_CONNECTOR', 'HTTP steps require a REST API connection');
      }
      const base = new URL(connection.config.baseUrl);
      if (!['http:', 'https:'].includes(base.protocol)) {
        throw new AppError(400, 'INVALID_URL', 'Connection base URL must be http or https');
      }
      const url = new URL(config.path, base);
      if (url.origin !== base.origin) {
        throw new AppError(400, 'URL_NOT_ALLOWED', 'Request URL must stay on the connection host');
      }
      if (config.query && typeof config.query === 'object') {
        for (const [key, value] of Object.entries(config.query)) {
          if (value !== undefined && value !== null) url.searchParams.set(key, typeof value === 'object' ? JSON.stringify(value) : String(value));
        }
      }
      const headers = { accept: 'application/json' };
      if (config.headers && typeof config.headers === 'object') {
        for (const [key, value] of Object.entries(config.headers)) {
          const name = key.toLowerCase();
          if (!/^[a-z0-9-]{1,64}$/.test(name) || BLOCKED_HEADERS.has(name)) throw new AppError(400, 'VALIDATION', `Header ${key} cannot be set`);
          headers[name] = String(value);
        }
      }
      if (connection.secret.token) headers.authorization = `Bearer ${connection.secret.token}`;
      if (connection.secret.username) headers.authorization = `Basic ${Buffer.from(`${connection.secret.username}:${connection.secret.password || ''}`).toString('base64')}`;
      if (connection.secret.apiKey) headers[String(connection.config.keyHeaderName || 'x-api-key').toLowerCase()] = connection.secret.apiKey;
      const method = String(config.method || 'GET').toUpperCase();
      if (Array.isArray(connection.config.allowedMethods) && connection.config.allowedMethods.length && !connection.config.allowedMethods.map((item) => String(item).toUpperCase()).includes(method)) {
        throw new AppError(400, 'METHOD_NOT_ALLOWED', `The connection does not allow ${method}`);
      }
      const limit = connection.timeout_ms || 30000;
      const init = { method, headers, signal: AbortSignal.timeout(Math.min(Number(config.timeoutMs) || limit, limit)) };
      if (!['GET', 'DELETE'].includes(method) && config.body != null) {
        if (config.bodyType === 'form') {
          headers['content-type'] = 'application/x-www-form-urlencoded';
          init.body = new URLSearchParams(Object.entries(config.body).map(([key, value]) => [key, String(value)])).toString();
        } else if (config.bodyType === 'text') {
          headers['content-type'] ||= 'text/plain';
          init.body = typeof config.body === 'string' ? config.body : JSON.stringify(config.body);
        } else {
          headers['content-type'] = 'application/json';
          init.body = JSON.stringify(config.body);
        }
      }
      let response;
      try {
        response = await fetch(url, init);
      } catch (error) {
        const wrapped = new AppError(502, 'CONNECTOR_UNAVAILABLE', 'HTTP connection failed');
        wrapped.retryable = true;
        wrapped.cause = error;
        throw wrapped;
      }
      const text = await response.text();
      let data = text;
      try { data = text ? JSON.parse(text) : null; } catch { data = text.slice(0, 4000); }
      const responseHeaders = {};
      for (const name of ['content-type', 'location', 'etag', 'x-request-id', 'retry-after']) {
        if (response.headers.get(name)) responseHeaders[name] = response.headers.get(name);
      }
      if (!response.ok && config.failOnError !== false) {
        const wrapped = new AppError(502, 'HTTP_ERROR', `Upstream returned HTTP ${response.status}`);
        wrapped.retryable = response.status >= 500 || response.status === 429;
        throw wrapped;
      }
      return { status: response.status, ok: response.ok, headers: responseHeaders, data };
    },
    async databaseQuery(config) {
      const connection = await loadConnection(pool, job, config.connectionId, cfg.credentialsKey);
      if (!['mysql', 'postgres'].includes(connection.connector_type)) {
        throw new AppError(400, 'WRONG_CONNECTOR', 'Database steps require a MySQL or PostgreSQL connection');
      }
      try {
        const output = await runDatabaseStep(connection.connector_type, connection.config, connection.secret, config, { clientFactory: overrides.databaseClient });
        return output;
      } catch (error) {
        if (error instanceof AppError) throw error;
        const wrapped = new AppError(502, 'CONNECTOR_UNAVAILABLE', 'Database operation failed');
        wrapped.retryable = true;
        throw wrapped;
      }
    },
    async fileOperation(config) {
      const connection = await loadConnection(pool, job, config.connectionId, cfg.credentialsKey);
      const base = resolveInside(storageRoot, connection.config.rootRelative || '.');
      const target = resolveInside(base, config.path || '.');
      if (config.action === 'list') {
        const entries = await fs.readdir(target, { withFileTypes: true });
        return { entries: entries.map((entry) => ({ name: entry.name, type: entry.isDirectory() ? 'directory' : 'file' })) };
      }
      if (config.action === 'read_text') {
        const content = await fs.readFile(target, 'utf8');
        return { content, bytes: Buffer.byteLength(content) };
      }
      if (config.action === 'write_text') {
        await fs.mkdir(path.dirname(target), { recursive: true });
        await fs.writeFile(target, String(config.content ?? ''), 'utf8');
        return { path: path.relative(storageRoot, target), bytes: Buffer.byteLength(String(config.content ?? '')) };
      }
      if (config.action === 'copy') {
        const destination = resolveInside(base, config.destination);
        await fs.mkdir(path.dirname(destination), { recursive: true });
        await fs.copyFile(target, destination);
        return { path: path.relative(storageRoot, destination) };
      }
      throw new AppError(400, 'VALIDATION', 'Unsupported file action');
    },
    async notify(config) {
      if (config.channel === 'email') {
        const connection = await loadConnection(pool, job, config.connectionId, cfg.credentialsKey);
        if (connection.connector_type !== 'email') throw new AppError(400, 'WRONG_CONNECTOR', 'Email steps require an email connection');
        const transport = nodemailer.createTransport({
          host: connection.config.host,
          port: Number(connection.config.port || 587),
          secure: Boolean(connection.config.secure),
          auth: connection.secret.user ? { user: connection.secret.user, pass: connection.secret.password } : undefined,
        });
        const mail = await buildOutgoingMail(config, storageRoot);
        const info = await transport.sendMail({ ...mail, from: connection.config.from });
        return { channel: 'email', messageId: info.messageId, attachmentCount: mail.attachments.length };
      }
      const id = cryptoRandom();
      await pool.query(
        `INSERT INTO notifications (id, tenant_id, project_id, job_id, channel, subject, body, created_at)
         VALUES (?, ?, ?, ?, 'in_app', ?, ?, UTC_TIMESTAMP(3))`,
        [id, job.tenant_id, job.project_id, job.id, String(config.subject || 'Notification'), String(config.message || '')],
      );
      return { channel: 'in_app', notificationId: id };
    },
    async robotTask(config) {
      const [robots] = await pool.query(
        `SELECT id FROM automation_robots
         WHERE tenant_id = ? AND last_heartbeat_at >= DATE_SUB(UTC_TIMESTAMP(3), INTERVAL 60 SECOND)`,
        [job.tenant_id],
      );
      if (!robots.length) {
        const error = new AppError(503, 'ROBOT_UNAVAILABLE', 'No robot heartbeat has been received in the last 60 seconds');
        error.retryable = true;
        throw error;
      }
      const fileKey = `${job.id}-${config.task}`.replace(/[^a-zA-Z0-9_-]/g, '').slice(0, 120);
      const inbox = path.join(cfg.robotRoot, 'inbox', `${fileKey}.json`);
      const outbox = path.join(cfg.robotRoot, 'outbox', `${fileKey}.json`);
      await fs.mkdir(path.dirname(inbox), { recursive: true });
      await fs.mkdir(path.dirname(outbox), { recursive: true });
      const payload = {
        jobId: job.id,
        projectId: job.project_id,
        workflowId: job.workflow_id,
        workflowVersionId: job.workflow_version_id,
        correlationId: job.correlation_id,
        task: config.task,
        input: config.input || {},
        connectionRefs: config.connectionId ? [config.connectionId] : [],
      };
      await fs.writeFile(inbox, JSON.stringify(payload, null, 2));
      const started = Date.now();
      const timeoutMs = cfg.robotTaskTimeoutMs || 15000;
      while (Date.now() - started < timeoutMs) {
        try {
          const raw = await fs.readFile(outbox, 'utf8');
          const result = JSON.parse(raw);
          const processed = path.join(cfg.robotRoot, 'processed');
          await fs.mkdir(processed, { recursive: true });
          await fs.rename(outbox, path.join(processed, `${Date.now()}-${fileKey}.json`)).catch(() => {});
          if (result.executionStatus !== 'SUCCEEDED') {
            const error = new AppError(502, result.errorCode || 'ROBOT_FAILED', result.errorMessage || 'Robot reported a failure');
            error.retryable = Boolean(result.retryable);
            throw error;
          }
          return result.output || { reported: true };
        } catch (error) {
          if (error instanceof AppError) throw error;
          if (error.code !== 'ENOENT') throw error;
        }
        await new Promise((resolve) => setTimeout(resolve, 200));
      }
      const error = new AppError(504, 'ROBOT_TIMEOUT', 'Robot did not write a result before the timeout');
      error.retryable = true;
      throw error;
    },
    async queueAdd(config) {
      const queue = await findQueue(pool, { tenantId: job.tenant_id, projectId: job.project_id, queueId: config.queueId, queueName: config.queueName });
      const item = await addQueueItem(pool, queue, {
        reference: config.reference,
        specificContent: config.specificContent || {},
        priority: config.priority,
        deferUntil: config.deferUntil,
        dueAt: config.dueAt,
      });
      return { item: presentItem(item) };
    },
    async queueGet(config) {
      const queue = await findQueue(pool, { tenantId: job.tenant_id, projectId: job.project_id, queueId: config.queueId, queueName: config.queueName });
      const items = (await getNextItems(pool, queue, { count: config.maxItems || 1, jobId: job.id })).map(presentItem);
      return { found: items.length > 0, item: items[0] || null, items, count: items.length };
    },
    async queueSetStatus(config) {
      const item = await setItemResult(pool, config.itemId, {
        status: config.status,
        errorType: config.errorType,
        errorMessage: config.errorMessage,
        output: config.output,
      }, { tenantId: job.tenant_id, projectId: job.project_id });
      return { item: presentItem(item) };
    },
    async loadSubworkflow(workflowId) {
      const [rows] = await pool.query(
        `SELECT w.id, v.definition_json
         FROM workflows w
         JOIN workflow_versions v ON v.id = w.current_version_id
         WHERE w.id = ? AND w.project_id = ? AND w.status = 'published' AND v.status = 'published'`,
        [workflowId, job.project_id],
      );
      if (!rows[0]) throw new AppError(404, 'SUBWORKFLOW_NOT_FOUND', 'Published sub-workflow was not found in this project');
      return { definition: rows[0].definition_json };
    },
  };
}

function cryptoRandom() {
  return globalThis.crypto.randomUUID();
}

export async function testConnection(pool, cfg, connection) {
  const started = new Date();
  try {
    let secret = {};
    if (connection.secret_ciphertext) {
      secret = decryptJson(connection.secret_ciphertext, connection.secret_iv, connection.secret_tag, cfg.credentialsKey);
    }
    const config = connection.config_json;
    if (connection.connector_type === 'rest_api') {
      const base = new URL(config.baseUrl);
      const url = new URL(config.healthPath || '/', base);
      if (url.origin !== base.origin) throw new AppError(400, 'URL_NOT_ALLOWED', 'Health URL escapes the connection host');
      const response = await fetch(url, { signal: AbortSignal.timeout(8000) });
      if (!response.ok) throw new AppError(502, 'CONNECTOR_UNAVAILABLE', `Health check returned HTTP ${response.status}`);
    } else if (connection.connector_type === 'mysql') {
      const client = await mysql.createConnection({
        host: config.host,
        port: Number(config.port || 3306),
        database: config.database,
        user: config.user,
        password: secret.password,
        connectTimeout: 8000,
      });
      try {
        await client.query('SELECT 1 AS ok');
      } finally {
        await client.end();
      }
    } else if (connection.connector_type === 'email') {
      const transport = nodemailer.createTransport({
        host: config.host,
        port: Number(config.port || 587),
        secure: Boolean(config.secure),
        auth: secret.user ? { user: secret.user, pass: secret.password } : undefined,
        connectionTimeout: 8000,
      });
      await transport.verify();
    } else if (connection.connector_type === 'browser_uipath') {
      const [robots] = await pool.query(
        `SELECT id FROM automation_robots r
         JOIN robot_project_access a ON a.robot_id = r.id
         WHERE a.project_id = ? AND r.last_heartbeat_at >= DATE_SUB(UTC_TIMESTAMP(3), INTERVAL 60 SECOND)`,
        [connection.project_id],
      );
      if (!robots.length) throw new AppError(503, 'ROBOT_UNAVAILABLE', 'No authorized robot is currently available');
    } else if (connection.connector_type === 'postgres') {
      await testDatabaseConnection('postgres', config, secret);
    } else if (connection.connector_type === 'ai_provider') {
      const settings = await resolveProvider(pool, cfg, { projectId: connection.project_id, connectionId: connection.id });
      if (!settings) throw new AppError(400, 'AI_NOT_CONFIGURED', 'Provider, model, API key, and (for Azure or local servers) base URL are required');
      await pingProvider(settings);
    } else if (connection.connector_type === 'credential') {
      if (!secret || !Object.keys(secret).length) throw new AppError(400, 'CREDENTIAL_EMPTY', 'The credential has no stored values');
    } else if (connection.connector_type === 'google_sheets') {
      await createSheetsClient({ config, secret }).metadata({});
    } else if (['excel', 'csv', 'pdf_text', 'file_storage'].includes(connection.connector_type)) {
      const root = path.join(cfg.storageRoot, connection.tenant_id, connection.project_id, config.rootRelative || '');
      await fs.mkdir(root, { recursive: true });
      await fs.access(root);
    } else {
      throw new AppError(400, 'UNKNOWN_CONNECTOR', 'Connector type is not registered');
    }
    await pool.query(
      `UPDATE connections SET status = 'available', last_tested_at = UTC_TIMESTAMP(3), last_error = NULL WHERE id = ?`,
      [connection.id],
    );
    return { status: 'available', testedAt: started.toISOString() };
  } catch (error) {
    const message = (error.message || 'Connection test failed').slice(0, 500);
    await pool.query(
      `UPDATE connections SET status = 'unavailable', last_tested_at = UTC_TIMESTAMP(3), last_error = ? WHERE id = ?`,
      [message, connection.id],
    );
    return { status: 'unavailable', testedAt: started.toISOString(), error: message };
  }
}

export async function recordHeartbeat(pool, robot) {
  await pool.query(
    `UPDATE automation_robots SET status = 'available', last_heartbeat_at = UTC_TIMESTAMP(3), updated_at = UTC_TIMESTAMP(3) WHERE id = ?`,
    [robot.id],
  );
  await writeAudit(pool, {
    tenantId: robot.tenant_id,
    robotId: robot.id,
    action: 'robot.heartbeat',
    entityType: 'robot',
    entityId: robot.id,
  });
}

export { sha256 };
