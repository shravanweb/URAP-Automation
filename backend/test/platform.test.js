// Tests for the features added to complete the platform: migrations, work queues, queue
// triggers, the robot claim API and contract robot, schedule controls, audit scoping, user
// administration, notifications, project files, CSV output, stale-job recovery, and exports.
import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import mysql from 'mysql2/promise';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { loadConfig } from '../src/config.js';
import { migrate } from '../src/db/migrate.js';
import { createPool } from '../src/db/pool.js';
import { readStatements } from '../src/db/sqlFile.js';
import { createApp } from '../src/http/createApp.js';
import { hashPassword } from '../src/lib/passwords.js';
import { claimNext, processNextNativeJob, recoverStaleJobs } from '../src/services/jobService.js';
import { runQueueTriggers } from '../src/services/queueService.js';

const cfg = loadConfig();
const pool = createPool(cfg.databaseUrl);
const app = createApp({ pool, config: cfg });
const tenantId = '00000000-0000-4000-8000-000000000001';
const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const PASSWORD = 'Platform-pass-12';
let admin;
let operator;
let viewer;
let server;
let apiUrl;

function definition(steps, maxAttempts = 1) {
  return { schemaVersion: '1.0', retryPolicy: { maxAttempts, backoffSeconds: 0 }, steps };
}

async function createUser(email, role) {
  const id = crypto.randomUUID();
  await pool.query(
    `INSERT INTO users (id, tenant_id, email, display_name, password_hash, role, status, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, 'active', UTC_TIMESTAMP(3), UTC_TIMESTAMP(3))`,
    [id, tenantId, email, `${role} user`, await hashPassword(PASSWORD, 4), role],
  );
  const response = await request(app).post('/api/auth/login').send({ email, password: PASSWORD });
  expect(response.status).toBe(200);
  return { id, email, token: response.body.data.accessToken };
}

const as = (user) => ({ Authorization: `Bearer ${user.token}` });

async function createProject(name, category = 'general') {
  const response = await request(app).post('/api/projects').set(as(admin)).send({ name, description: name, category });
  expect(response.status).toBe(201);
  return response.body.data;
}

async function publish(projectId, name, body, executionType = 'native') {
  const created = await request(app).post('/api/workflows').set(as(admin)).send({ projectId, name, executionType });
  expect(created.status).toBe(201);
  const draft = await request(app).post(`/api/workflows/${created.body.data.id}/draft`).set(as(admin)).send({ definition: body });
  expect(draft.body.data.validation.errors).toEqual([]);
  const published = await request(app).post(`/api/workflows/${created.body.data.id}/publish`).set(as(admin));
  expect(published.status).toBe(200);
  return created.body.data.id;
}

async function run(workflowId, input = {}) {
  const queued = await request(app).post(`/api/workflows/${workflowId}/run`).set(as(admin)).send({ input });
  expect(queued.status).toBe(202);
  return queued.body.data;
}

async function jobDetail(id) {
  const response = await request(app).get(`/api/jobs/${id}`).set(as(admin));
  expect(response.status).toBe(200);
  return response.body.data;
}

async function registerRobot(name, projectIds) {
  const response = await request(app).post('/api/robots').set(as(admin)).send({ name, adapter: 'local_file_handoff', projectIds });
  expect(response.status).toBe(201);
  return response.body.data;
}

beforeAll(async () => {
  admin = await createUser('platform-admin@example.com', 'administrator');
  operator = await createUser('platform-operator@example.com', 'operator');
  viewer = await createUser('platform-viewer@example.com', 'viewer');
  server = app.listen(0, '127.0.0.1');
  await new Promise((resolve) => server.once('listening', resolve));
  apiUrl = `http://127.0.0.1:${server.address().port}`;
});

afterAll(async () => {
  server?.close();
});

describe('database migrations', () => {
  it('records the baseline and incremental migrations once', async () => {
    const [rows] = await pool.query(`SELECT id FROM schema_migrations ORDER BY id`);
    expect(rows.map((row) => row.id)).toEqual(['001_init', '002_work_queues', '003_action_center', '004_flows', '005_agents', '006_apps', '007_cases', '008_bpmn', '009_audit_details', '010_platform_admin']);
    const again = await migrate(cfg);
    expect(again.applied).toEqual([]);
  });

  it('upgrades an existing 001-only database in place', async () => {
    const url = new URL(cfg.databaseUrl);
    url.pathname = '/urap_test_upgrade';
    const admin2 = await mysql.createConnection({ host: url.hostname, port: Number(url.port), user: decodeURIComponent(url.username), password: decodeURIComponent(url.password) });
    await admin2.query('DROP DATABASE IF EXISTS urap_test_upgrade');
    await admin2.query('CREATE DATABASE urap_test_upgrade CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci');
    await admin2.changeUser({ database: 'urap_test_upgrade' });
    for (const statement of await readStatements(path.join(repoRoot, 'database/schema.sql'))) await admin2.query(statement);
    await admin2.query(`INSERT INTO schema_migrations (id, applied_at) VALUES ('001_init', UTC_TIMESTAMP(3))`);
    try {
      const result = await migrate({ ...cfg, databaseUrl: url.toString() });
      expect(result.applied).toEqual(['002_work_queues', '003_action_center', '004_flows', '005_agents', '006_apps', '007_cases', '008_bpmn', '009_audit_details', '010_platform_admin']);
      const [tables] = await admin2.query(`SHOW TABLES LIKE 'queue_items'`);
      expect(tables).toHaveLength(1);
      const [taskTables] = await admin2.query(`SHOW TABLES LIKE 'action_tasks'`);
      expect(taskTables).toHaveLength(1);
    } finally {
      await admin2.query('DROP DATABASE IF EXISTS urap_test_upgrade');
      await admin2.end();
    }
  });
});

describe('work queues', () => {
  it('dispatches, processes, and retries queue items through workflow steps', async () => {
    const project = await createProject('Invoice queue', 'finance');
    const queue = await request(app).post('/api/queues').set(as(admin)).send({
      projectId: project.id, name: 'Invoices', maxRetries: 1, uniqueReference: true,
    });
    expect(queue.status).toBe(201);
    const queueId = queue.body.data.id;

    const bulk = await request(app).post(`/api/queues/${queueId}/items`).set(as(operator)).send({ items: [] });
    expect(bulk.status).toBe(403); // operator is not a member of the project yet
    await request(app).post(`/api/projects/${project.id}/members`).set(as(admin)).send({ userId: operator.id, role: 'operator' });
    const added = await request(app).post(`/api/queues/${queueId}/items`).set(as(operator)).send({ items: [
      { reference: 'INV-1', specificContent: { amount: 120 } },
      { reference: 'INV-2', specificContent: { amount: 0 }, priority: 'high' },
      { reference: 'INV-3', specificContent: { amount: 75 } },
    ] });
    expect(added.status).toBe(201);
    expect(added.body.data).toHaveLength(3);
    const duplicate = await request(app).post(`/api/queues/${queueId}/items`).set(as(operator)).send({ reference: 'INV-1', specificContent: {} });
    expect(duplicate.status).toBe(409);
    expect(duplicate.body.error.code).toBe('DUPLICATE_REFERENCE');

    const workflowId = await publish(project.id, 'Process invoices', definition([
      { id: 'start', type: 'start', name: 'Start', next: 'get' },
      { id: 'get', type: 'get_queue_item', name: 'Get transactions', config: { queueName: 'Invoices', maxItems: 10 }, next: 'loop' },
      { id: 'loop', type: 'for_each', name: 'Each item', config: { source: '{{steps.get.items}}', bodyStart: 'check', bodyEnd: 'ok', maxIterations: 10 }, next: 'log' },
      { id: 'check', type: 'if_else', name: 'Amount positive', config: { left: '{{item.specificContent.amount}}', operator: 'gt', right: 0, whenTrue: 'ok', whenFalse: 'bad' } },
      { id: 'ok', type: 'set_queue_item_status', name: 'Success', config: { itemId: '{{item.id}}', status: 'SUCCESSFUL', output: { paid: '{{item.specificContent.amount}}' } } },
      { id: 'bad', type: 'set_queue_item_status', name: 'Business rule', config: { itemId: '{{item.id}}', status: 'FAILED', errorType: 'business', errorMessage: 'Amount must be positive' } },
      { id: 'log', type: 'log_message', name: 'Log', config: { level: 'info', message: 'Processed {{steps.get.count}} items' }, next: 'end' },
      { id: 'end', type: 'end', name: 'End', config: { summaryFrom: ['get', 'log'] } },
    ]));
    const job = await run(workflowId);
    const finished = await processNextNativeJob(pool, cfg, 'queue-worker');
    expect(finished.id).toBe(job.id);
    expect(finished.status).toBe('SUCCEEDED');
    const detail = await jobDetail(job.id);
    expect(detail.steps.some((step) => step.step_key === 'log' && step.output_json?.message === 'Processed 3 items')).toBe(true);
    // high priority first
    expect(detail.steps.find((step) => step.step_key === 'get' && step.status === 'SUCCEEDED').output_json.items[0].reference).toBe('INV-2');

    const summary = await request(app).get(`/api/queues/${queueId}`).set(as(operator));
    expect(summary.body.data.counts.SUCCESSFUL).toBe(2);
    expect(summary.body.data.counts.FAILED).toBe(1);
    const failed = await request(app).get(`/api/queues/${queueId}/items?status=FAILED`).set(as(operator));
    expect(failed.body.data[0].errorType).toBe('business');
    expect(failed.body.data[0].retryCount).toBe(0);

    // Application errors are retried up to maxRetries; a job that ends with an item still in
    // progress releases it as an application error.
    const appItem = await request(app).post(`/api/queues/${queueId}/items`).set(as(operator)).send({ reference: 'INV-4', specificContent: { amount: 5 } });
    const leaveOpen = await publish(project.id, 'Take and forget', definition([
      { id: 'start', type: 'start', name: 'Start', next: 'get' },
      { id: 'get', type: 'get_queue_item', name: 'Get', config: { queueName: 'Invoices' }, next: 'end' },
      { id: 'end', type: 'end', name: 'End' },
    ]));
    await run(leaveOpen);
    expect((await processNextNativeJob(pool, cfg, 'queue-worker')).status).toBe('SUCCEEDED');
    let item = (await request(app).get(`/api/queues/${queueId}/items?reference=INV-4`).set(as(operator))).body.data[0];
    expect(item.id).toBe(appItem.body.data.id);
    expect(item.status).toBe('NEW');
    expect(item.retryCount).toBe(1);
    await run(leaveOpen);
    await processNextNativeJob(pool, cfg, 'queue-worker');
    item = (await request(app).get(`/api/queues/${queueId}/items?reference=INV-4`).set(as(operator))).body.data[0];
    expect(item.status).toBe('FAILED');
    expect(item.errorType).toBe('application');

    const retried = await request(app).post(`/api/queue-items/${item.id}/retry`).set(as(operator));
    expect(retried.body.data.status).toBe('NEW');
    const deleted = await request(app).post(`/api/queue-items/${item.id}/delete`).set(as(operator));
    expect(deleted.body.data.status).toBe('DELETED');
    const hidden = await request(app).get(`/api/queues/${queueId}`).set(as(viewer));
    expect(hidden.status).toBe(403);
  });

  it('starts the trigger workflow when new items arrive and lets robots consume items', async () => {
    const project = await createProject('Triggered queue', 'erp');
    const workflowId = await publish(project.id, 'Queue consumer', definition([
      { id: 'start', type: 'start', name: 'Start', next: 'add' },
      { id: 'add', type: 'add_queue_item', name: 'Dispatch follow-up', config: { queueName: 'Follow-ups', reference: 'from-{{input.queueName}}', specificContent: { source: '{{input.queueId}}' } }, next: 'end' },
      { id: 'end', type: 'end', name: 'End' },
    ]));
    const orders = await request(app).post('/api/queues').set(as(admin)).send({ projectId: project.id, name: 'Orders', triggerWorkflowId: workflowId, triggerEnabled: true });
    expect(orders.status).toBe(201);
    const followUps = await request(app).post('/api/queues').set(as(admin)).send({ projectId: project.id, name: 'Follow-ups' });
    expect(await runQueueTriggers(pool, cfg)).toEqual([]);
    await request(app).post(`/api/queues/${orders.body.data.id}/items`).set(as(admin)).send({ reference: 'SO-1', specificContent: { sku: 'A' } });
    const started = await runQueueTriggers(pool, cfg);
    expect(started).toHaveLength(1);
    expect(await runQueueTriggers(pool, cfg)).toEqual([]); // the trigger job is still queued
    const triggered = await jobDetail(started[0].jobId);
    expect(triggered.triggerSource).toBe('queue');
    expect((await processNextNativeJob(pool, cfg, 'trigger-worker')).status).toBe('SUCCEEDED');
    const follow = await request(app).get(`/api/queues/${followUps.body.data.id}/items`).set(as(admin));
    expect(follow.body.data[0].reference).toBe('from-Orders');

    const robot = await registerRobot('Queue robot', [project.id]);
    const other = await createProject('Other queue project');
    const outsider = await registerRobot('Outside robot', [other.id]);
    const denied = await request(app).post(`/api/robot/queues/${orders.body.data.id}/next`).set('Authorization', `Bearer ${outsider.token}`);
    expect(denied.status).toBe(403);
    const next = await request(app).post(`/api/robot/queues/${orders.body.data.id}/next`).set('Authorization', `Bearer ${robot.token}`);
    expect(next.body.data.reference).toBe('SO-1');
    expect(next.body.data.status).toBe('IN_PROGRESS');
    const done = await request(app).post(`/api/robot/queue-items/${next.body.data.id}/result`).set('Authorization', `Bearer ${robot.token}`).send({ status: 'SUCCESSFUL', output: { ok: true } });
    expect(done.body.data.status).toBe('SUCCESSFUL');
    const empty = await request(app).post(`/api/robot/queues/${orders.body.data.id}/next`).set('Authorization', `Bearer ${robot.token}`);
    expect(empty.body.data).toBeNull();
  });
});

describe('robots', () => {
  it('lets one robot claim a job and completes it through the contract robot and robot API', async () => {
    const project = await createProject('Robot claim', 'web');
    const workflowId = await publish(project.id, 'Robot report', definition([
      { id: 'start', type: 'start', name: 'Start', next: 'end' },
      { id: 'end', type: 'end', name: 'End' },
    ]), 'uipath');
    const robot = await registerRobot('Contract robot', [project.id]);
    process.env.ROBOT_TOKEN = robot.token;
    process.env.API_URL = apiUrl;
    const { processInboxOnce } = await import('../src/robotSimulator.js');

    const job = await run(workflowId, { order: 'A-1' });
    const logs = [];
    const processed = await processInboxOnce({ log: (line) => logs.push(line) });
    expect(processed.find((item) => item.file === `${job.id}.json`)?.status).toBe('SUCCEEDED');
    const detail = await jobDetail(job.id);
    expect(detail.status).toBe('SUCCEEDED');
    expect(detail.robotId).toBe(robot.id);
    expect(detail.attempts).toHaveLength(1);
    expect(detail.artifacts.map((item) => item.file_name)).toContain(`${job.id}.txt`);

    // A failed robot attempt is kept, the retry rewrites the inbox file, and the next result
    // is recorded as attempt 2.
    const second = await run(workflowId, { order: 'A-2' });
    const claim = await request(app).post(`/api/robot/jobs/${second.id}/claim`).set('Authorization', `Bearer ${robot.token}`);
    expect(claim.body.data.status).toBe('RUNNING');
    const again = await request(app).post(`/api/robot/jobs/${second.id}/claim`).set('Authorization', `Bearer ${robot.token}`);
    expect(again.status).toBe(409);
    await request(app).post(`/api/robot/jobs/${second.id}/result`).set('Authorization', `Bearer ${robot.token}`).send({ executionStatus: 'FAILED', errorCode: 'UI_CHANGED', errorMessage: 'Selector not found' });
    expect((await jobDetail(second.id)).status).toBe('FAILED');
    await fs.rm(path.join(cfg.robotRoot, 'inbox', `${second.id}.json`), { force: true });
    await request(app).post(`/api/jobs/${second.id}/retry`).set(as(admin));
    await expect(fs.access(path.join(cfg.robotRoot, 'inbox', `${second.id}.json`))).resolves.toBeUndefined();
    await processInboxOnce({ log: () => {} });
    const retried = await jobDetail(second.id);
    expect(retried.status).toBe('SUCCEEDED');
    expect(retried.attempts.map((attempt) => [attempt.attempt_number, attempt.status])).toEqual([[1, 'FAILED'], [2, 'SUCCEEDED']]);

    const listed = await request(app).get('/api/robots').set(as(admin));
    expect(listed.body.data.find((item) => item.id === robot.id).projectIds).toEqual([project.id]);
    const rotated = await request(app).post(`/api/robots/${robot.id}/rotate-token`).set(as(admin));
    expect(rotated.body.data.token).not.toBe(robot.token);
    expect((await request(app).post('/api/robot/heartbeat').set('Authorization', `Bearer ${robot.token}`)).status).toBe(401);
    expect((await request(app).post('/api/robot/heartbeat').set('Authorization', `Bearer ${rotated.body.data.token}`)).status).toBe(200);
  });

  it('runs a hybrid workflow step through the robot file handoff', async () => {
    const project = await createProject('Hybrid', 'web');
    const robot = await registerRobot('Hybrid robot', [project.id]);
    await request(app).post('/api/robot/heartbeat').set('Authorization', `Bearer ${robot.token}`);
    const workflowId = await publish(project.id, 'Hybrid flow', definition([
      { id: 'start', type: 'start', name: 'Start', next: 'ui' },
      { id: 'ui', type: 'uipath_workflow', name: 'Robot step', config: { task: 'UpdatePortal', input: { order: '{{input.order}}' } }, next: 'end' },
      { id: 'end', type: 'end', name: 'End', config: { summaryFrom: ['ui'] } },
    ]), 'hybrid');
    const job = await run(workflowId, { order: 'H-1' });
    const { processInboxOnce } = await import('../src/robotSimulator.js');
    let stop = false;
    const robotLoop = (async () => {
      while (!stop) {
        await processInboxOnce({ log: () => {} });
        await new Promise((resolve) => setTimeout(resolve, 100));
      }
    })();
    const finished = await processNextNativeJob(pool, cfg, 'hybrid-worker');
    stop = true;
    await robotLoop;
    expect(finished.id).toBe(job.id);
    expect(finished.status).toBe('SUCCEEDED');
    const detail = await jobDetail(job.id);
    expect(detail.steps.find((step) => step.step_key === 'ui' && step.status === 'SUCCEEDED').output_json.task).toBe('UpdatePortal');
  });
});

describe('operations', () => {
  it('validates cron and time zone, and enables or disables schedules with scope checks', async () => {
    const project = await createProject('Schedule controls', 'reporting');
    const workflowId = await publish(project.id, 'Nightly', definition([
      { id: 'start', type: 'start', name: 'Start', next: 'end' },
      { id: 'end', type: 'end', name: 'End' },
    ]));
    const base = { projectId: project.id, workflowId, name: 'Nightly', scheduleType: 'recurring', timezone: 'Asia/Kolkata' };
    const badCron = await request(app).post('/api/schedules').set(as(admin)).send({ ...base, cronExpression: '61 * * * *' });
    expect(badCron.status).toBe(400);
    expect(badCron.body.error.code).toBe('VALIDATION');
    const badZone = await request(app).post('/api/schedules').set(as(admin)).send({ ...base, cronExpression: '0 2 * * *', timezone: 'Mars/Base' });
    expect(badZone.status).toBe(400);
    const created = await request(app).post('/api/schedules').set(as(admin)).send({ ...base, cronExpression: '30 2 * * *' });
    expect(created.status).toBe(201);
    // 02:30 Asia/Kolkata is 21:00 UTC
    expect(created.body.data.next_run_at).toMatch(/ 21:00:00\.000$/);
    const pm = await createUser('platform-pm@example.com', 'project_manager');
    expect((await request(app).post(`/api/schedules/${created.body.data.id}/disable`).set(as(pm))).status).toBe(403);
    const disabled = await request(app).post(`/api/schedules/${created.body.data.id}/disable`).set(as(admin));
    expect(disabled.body.data.enabled).toBe(0);
    await pool.query(`UPDATE schedules SET next_run_at = '2020-01-01 00:00:00.000' WHERE id = ?`, [created.body.data.id]);
    const enabled = await request(app).post(`/api/schedules/${created.body.data.id}/enable`).set(as(admin));
    expect(enabled.body.data.enabled).toBe(1);
    expect(new Date(`${enabled.body.data.next_run_at.replace(' ', 'T')}Z`).getTime()).toBeGreaterThan(Date.now());
    const runs = await request(app).get(`/api/schedules/${created.body.data.id}/runs`).set(as(admin));
    expect(runs.status).toBe(200);
  });

  it('scopes audit rows for non-administrators and manages users', async () => {
    const project = await createProject('Audit scope secret');
    const viewerAudit = await request(app).get('/api/audit?limit=100').set(as(viewer));
    expect(viewerAudit.body.data.every((row) => row.actor_user_id === viewer.id || row.project_id === null || false)).toBe(true);
    expect(viewerAudit.body.data.some((row) => row.entity_id === project.id)).toBe(false);
    const adminAudit = await request(app).get(`/api/audit?limit=100&projectId=${project.id}`).set(as(admin));
    expect(adminAudit.body.data.some((row) => row.action === 'project.create' && row.actor_email === admin.email)).toBe(true);

    const temp = await createUser('platform-temp@example.com', 'operator');
    const self = await request(app).patch(`/api/users/${admin.id}`).set(as(admin)).send({ status: 'disabled' });
    expect(self.status).toBe(409);
    const disabled = await request(app).patch(`/api/users/${temp.id}`).set(as(admin)).send({ status: 'disabled' });
    expect(disabled.body.data.status).toBe('disabled');
    expect((await request(app).post('/api/auth/login').send({ email: temp.email, password: PASSWORD })).status).toBe(401);
    expect((await request(app).get('/api/auth/me').set(as(temp))).status).toBe(401);
    const reset = await request(app).patch(`/api/users/${temp.id}`).set(as(admin)).send({ status: 'active', password: 'A-new-password-99', role: 'viewer' });
    expect(reset.body.data.role).toBe('viewer');
    expect((await request(app).post('/api/auth/login').send({ email: temp.email, password: 'A-new-password-99' })).status).toBe(200);
    expect((await request(app).patch(`/api/users/${temp.id}`).set(as(operator)).send({ role: 'administrator' })).status).toBe(403);
  });

  it('uploads a project file, reads it in a workflow, writes CSV, and notifies', async () => {
    const project = await createProject('CSV pipeline', 'excel');
    const upload = await request(app).post(`/api/projects/${project.id}/files`).set(as(admin))
      .attach('file', Buffer.from('sku,qty\nA,2\nB,0\n=cmd,1\n'), 'orders.csv');
    expect(upload.status).toBe(201);
    const workflowId = await publish(project.id, 'CSV filter', definition([
      { id: 'start', type: 'start', name: 'Start', next: 'read' },
      { id: 'read', type: 'read_csv', name: 'Read', config: { path: '{{input.file}}' }, next: 'filter' },
      { id: 'filter', type: 'transform_data', name: 'Filter', config: { source: '{{steps.read.rows}}', operations: [{ op: 'map', field: 'qty', fn: 'number' }, { op: 'filter', field: 'qty', operator: 'gt', value: 0 }] }, next: 'write' },
      { id: 'write', type: 'write_csv', name: 'Write', config: { path: 'out/positive.csv', rows: '{{steps.filter.rows}}' }, next: 'notify' },
      { id: 'notify', type: 'send_notification', name: 'Notify', config: { channel: 'in_app', subject: 'CSV ready', message: '{{steps.write.rows}} rows written' }, next: 'end' },
      { id: 'end', type: 'end', name: 'End' },
    ]));
    const bad = await request(app).post(`/api/workflows/${workflowId}/validate`).set(as(admin)).send({ definition: definition([
      { id: 'start', type: 'start', name: 'Start', next: 'read' },
      { id: 'read', type: 'read_csv', name: 'Read', config: { path: '../../etc/passwd' }, next: 'end' },
      { id: 'end', type: 'end', name: 'End' },
    ]) });
    expect(bad.body.data.valid).toBe(false);
    const job = await run(workflowId, { file: upload.body.data.path });
    expect((await processNextNativeJob(pool, cfg, 'csv-worker')).status).toBe('SUCCEEDED');
    const detail = await jobDetail(job.id);
    const artifact = detail.artifacts.find((item) => item.file_name === 'positive.csv');
    expect(artifact.mime_type).toBe('text/csv');
    const download = await request(app).get(`/api/artifacts/${artifact.id}/download`).set(as(admin));
    expect(download.text).toBe("sku,qty\nA,2\n'=cmd,1\n");
    const files = await request(app).get(`/api/projects/${project.id}/files`).set(as(admin));
    expect(files.body.data.map((file) => file.source).sort()).toEqual(['job', 'upload']);
    const notes = await request(app).get('/api/notifications').set(as(admin));
    expect(notes.body.data.some((note) => note.subject === 'CSV ready' && note.body === '2 rows written')).toBe(true);
    const viewerNotes = await request(app).get('/api/notifications').set(as(viewer));
    expect(viewerNotes.body.data.some((note) => note.project_id === project.id)).toBe(false);
  });

  it('fails a job whose worker stopped and filters exports by project', async () => {
    const project = await createProject('Stale worker');
    const workflowId = await publish(project.id, 'Stuck', definition([
      { id: 'start', type: 'start', name: 'Start', next: 'end' },
      { id: 'end', type: 'end', name: 'End' },
    ]));
    const job = await run(workflowId);
    const claimed = await claimNext(pool, 'native', { workerId: 'crashed-worker' });
    expect(claimed.job.id).toBe(job.id);
    expect(await recoverStaleJobs(pool, 30)).not.toContain(job.id);
    await pool.query(`UPDATE automation_jobs SET updated_at = DATE_SUB(UTC_TIMESTAMP(3), INTERVAL 2 HOUR) WHERE id = ?`, [job.id]);
    expect(await recoverStaleJobs(pool, 30)).toContain(job.id);
    const detail = await jobDetail(job.id);
    expect(detail.status).toBe('FAILED');
    expect(detail.attempts[0].error_code).toBe('WORKER_LOST');
    const retry = await request(app).post(`/api/jobs/${job.id}/retry`).set(as(admin));
    expect(retry.body.data.status).toBe('QUEUED');
    expect((await processNextNativeJob(pool, cfg, 'healthy-worker')).status).toBe('SUCCEEDED');

    const csv = await request(app).get(`/api/reports/export.csv?projectId=${project.id}`).set(as(admin));
    const lines = csv.text.trim().split('\n');
    expect(lines[0]).toContain('workflow_name');
    expect(lines).toHaveLength(2);
    expect(lines[1]).toContain('Stuck');
    const badDate = await request(app).get('/api/reports/export.csv?from=not-a-date').set(as(admin));
    expect(badDate.status).toBe(400);
  });
});

describe('workflow administration', () => {
  it('renames a workflow, audits it, and blocks viewers from editing', async () => {
    const project = await createProject('Rename project');
    const created = await request(app).post('/api/workflows').set(as(admin)).send({ projectId: project.id, name: 'Old name' });
    expect(created.status).toBe(201);
    const renamed = await request(app).patch(`/api/workflows/${created.body.data.id}`).set(as(admin)).send({ name: 'New name', description: 'Renamed' });
    expect(renamed.status).toBe(200);
    expect(renamed.body.data.name).toBe('New name');
    expect(renamed.body.data.description).toBe('Renamed');
    const unknownField = await request(app).patch(`/api/workflows/${created.body.data.id}`).set(as(admin)).send({ status: 'published' });
    expect(unknownField.status).toBe(400);
    const denied = await request(app).patch(`/api/workflows/${created.body.data.id}`).set(as(viewer)).send({ name: 'Nope' });
    expect(denied.status).toBe(403);
    const audit = await request(app).get(`/api/audit?action=workflow.update&projectId=${project.id}`).set(as(admin));
    expect(audit.status).toBe(200);
    expect(audit.body.data.map((row) => row.entity_id)).toContain(created.body.data.id);
    const createdAudit = await request(app).get(`/api/audit?action=workflow.create&projectId=${project.id}`).set(as(admin));
    expect(createdAudit.body.data.length).toBe(1);
  });
});
