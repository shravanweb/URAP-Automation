import http from 'node:http';
import fs from 'node:fs/promises';
import path from 'node:path';
import { createPool } from '../src/db/pool.js';
import { loadConfig } from '../src/config.js';
import { createApp } from '../src/http/createApp.js';
import { hashPassword } from '../src/lib/passwords.js';
import { claimNext, processClaimedJob, processNextNativeJob, syncRobotOutbox } from '../src/services/jobService.js';
import { runDueSchedules } from '../src/services/schedulerService.js';
import { processHandoffFile } from '../src/robotContract.js';
import request from 'supertest';
import crypto from 'node:crypto';
import { beforeAll, describe, expect, it } from 'vitest';

const cfg = loadConfig();
const pool = createPool(cfg.databaseUrl);
const app = createApp({ pool, config: cfg });
const tenantId = '00000000-0000-4000-8000-000000000001';
let adminToken;
let viewerToken;

function definition(steps, maxAttempts = 1) {
  return { schemaVersion: '1.0', retryPolicy: { maxAttempts, backoffSeconds: 0 }, steps };
}

async function tokenFor(email, role) {
  const password = 'Temporary-pass-1';
  await pool.query(
    `INSERT INTO users (id, tenant_id, email, display_name, password_hash, role, status, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, 'active', UTC_TIMESTAMP(3), UTC_TIMESTAMP(3))`,
    [crypto.randomUUID(), tenantId, email, role, await hashPassword(password, 4), role],
  );
  const response = await request(app).post('/api/auth/login').send({ email, password });
  expect(response.status).toBe(200);
  return response.body.data.accessToken;
}

async function publishWorkflow(token, projectId, name, body, executionType = 'native') {
  const created = await request(app).post('/api/workflows').set('Authorization', `Bearer ${token}`).send({
    projectId, name, description: name, executionType,
  });
  expect(created.status).toBe(201);
  const draft = await request(app).post(`/api/workflows/${created.body.data.id}/draft`).set('Authorization', `Bearer ${token}`).send({ definition: body });
  expect(draft.status).toBe(200);
  expect(draft.body.data.validation.valid).toBe(true);
  const published = await request(app).post(`/api/workflows/${created.body.data.id}/publish`).set('Authorization', `Bearer ${token}`);
  expect(published.status).toBe(200);
  return created.body.data.id;
}

beforeAll(async () => {
  adminToken = await tokenFor('admin@example.com', 'administrator');
  viewerToken = await tokenFor('viewer@example.com', 'viewer');
});

describe('URAP API and execution', () => {
  it('rejects unauthenticated requests and keeps viewers from creating projects', async () => {
    expect((await request(app).get('/api/projects')).status).toBe(401);
    const denied = await request(app).post('/api/projects').set('Authorization', `Bearer ${viewerToken}`).send({
      name: 'Blocked', description: '', category: 'general',
    });
    expect(denied.status).toBe(403);
  });

  it('creates isolated projects and records real dashboard totals', async () => {
    const created = await request(app).post('/api/projects').set('Authorization', `Bearer ${adminToken}`).send({
      name: 'Warehouse sync', description: 'Cross-system order check', category: 'erp', settings: { plant: 'east' },
    });
    expect(created.status).toBe(201);
    const hidden = await request(app).get(`/api/projects/${created.body.data.id}`).set('Authorization', `Bearer ${viewerToken}`);
    expect(hidden.status).toBe(403);
    const dashboard = await request(app).get('/api/dashboard').set('Authorization', `Bearer ${viewerToken}`);
    expect(dashboard.body.data.totalProjects).toBe(0);
    const adminDash = await request(app).get('/api/dashboard').set('Authorization', `Bearer ${adminToken}`);
    expect(adminDash.body.data.totalProjects).toBeGreaterThanOrEqual(1);
    const projectDash = await request(app).get(`/api/dashboard?projectId=${created.body.data.id}`).set('Authorization', `Bearer ${adminToken}`);
    expect(projectDash.body.data.totalProjects).toBe(1);
    expect(projectDash.body.data.successfulExecutions).toBe(0);
  });

  it('validates, publishes, executes, and retries a native workflow', async () => {
    const project = await request(app).post('/api/projects').set('Authorization', `Bearer ${adminToken}`).send({
      name: 'Order quality', description: 'Validate order rows', category: 'ecommerce',
    });
    const invalid = await request(app).post('/api/workflows').set('Authorization', `Bearer ${adminToken}`).send({
      projectId: project.body.data.id, name: 'Bad', executionType: 'native',
    });
    const badDraft = await request(app).post(`/api/workflows/${invalid.body.data.id}/draft`).set('Authorization', `Bearer ${adminToken}`).send({
      definition: definition([
        { id: 'start', type: 'start', name: 'Start', next: 'nope' },
        { id: 'nope', type: 'run_script', name: 'Script', next: 'end' },
        { id: 'end', type: 'end', name: 'End' },
      ]),
    });
    expect(badDraft.body.data.validation.valid).toBe(false);
    expect((await request(app).post(`/api/workflows/${invalid.body.data.id}/publish`).set('Authorization', `Bearer ${adminToken}`)).status).toBe(400);

    const workflowId = await publishWorkflow(adminToken, project.body.data.id, 'Validate orders', definition([
      { id: 'start', type: 'start', name: 'Start', next: 'validate' },
      { id: 'validate', type: 'validate_data', name: 'Validate', config: { source: '{{input.rows}}', mode: 'fail_workflow', rules: [{ field: 'sku', checks: ['required'] }] }, next: 'branch' },
      { id: 'branch', type: 'if_else', name: 'Ready', config: { left: '{{steps.validate.validCount}}', operator: 'gt', right: 0, whenTrue: 'dupes', whenFalse: 'end' } },
      { id: 'dupes', type: 'find_duplicates', name: 'Duplicates', config: { source: '{{steps.validate.valid}}', keys: ['sku'] }, next: 'write' },
      { id: 'write', type: 'write_excel', name: 'Write', config: { path: 'out/orders.xlsx', rows: '{{steps.dupes.rows}}' }, next: 'end' },
      { id: 'end', type: 'end', name: 'End', config: { summaryFrom: ['dupes', 'write'] } },
    ]));
    const queued = await request(app).post(`/api/workflows/${workflowId}/run`).set('Authorization', `Bearer ${adminToken}`).send({
      input: { rows: [{ sku: '' }] },
    });
    expect(queued.status).toBe(202);
    expect(queued.body.data.status).toBe('QUEUED');
    const failed = await processNextNativeJob(pool, cfg, 'test-worker');
    expect(failed.status).toBe('FAILED');
    const beforeRetry = await request(app).get(`/api/jobs/${failed.id}`).set('Authorization', `Bearer ${adminToken}`);
    expect(beforeRetry.body.data.attempts).toHaveLength(1);

    await pool.query(`UPDATE automation_jobs SET input_json = ? WHERE id = ?`, [JSON.stringify({ rows: [{ sku: 'A' }, { sku: 'A' }] }), failed.id]);
    const retried = await request(app).post(`/api/jobs/${failed.id}/retry`).set('Authorization', `Bearer ${adminToken}`);
    expect(retried.body.data.status).toBe('QUEUED');
    const again = await request(app).post(`/api/jobs/${failed.id}/retry`).set('Authorization', `Bearer ${adminToken}`);
    expect(again.body.data.id).toBe(failed.id);
    const succeeded = await processNextNativeJob(pool, cfg, 'test-worker');
    expect(succeeded.status).toBe('SUCCEEDED');
    const detail = await request(app).get(`/api/jobs/${succeeded.id}`).set('Authorization', `Bearer ${adminToken}`);
    expect(detail.body.data.attempts).toHaveLength(2);
    expect(detail.body.data.attempts[0].status).toBe('FAILED');
    expect(detail.body.data.artifacts.length).toBeGreaterThan(0);
    const download = await request(app).get(`/api/artifacts/${detail.body.data.artifacts[0].id}/download`).set('Authorization', `Bearer ${adminToken}`);
    expect(download.status).toBe(200);
    const denied = await request(app).get(`/api/artifacts/${detail.body.data.artifacts[0].id}/download`).set('Authorization', `Bearer ${viewerToken}`);
    expect(denied.status).toBe(403);
  });

  it('lets only one worker claim a queued job', async () => {
    const project = await request(app).post('/api/projects').set('Authorization', `Bearer ${adminToken}`).send({
      name: 'Claim race', description: '', category: 'testing',
    });
    const workflowId = await publishWorkflow(adminToken, project.body.data.id, 'Pass through', definition([
      { id: 'start', type: 'start', name: 'Start', next: 'end' },
      { id: 'end', type: 'end', name: 'End' },
    ]));
    await request(app).post(`/api/workflows/${workflowId}/run`).set('Authorization', `Bearer ${adminToken}`).send({ input: {} });
    const claims = await Promise.all([
      claimNext(pool, 'native', { workerId: 'a' }),
      claimNext(pool, 'native', { workerId: 'b' }),
    ]);
    expect(claims.filter(Boolean)).toHaveLength(1);
    const finished = await processClaimedJob(pool, cfg, claims.find(Boolean));
    expect(finished.status).toBe('SUCCEEDED');
  });

  it('runs two jobs at the same time', async () => {
    const project = await request(app).post('/api/projects').set('Authorization', `Bearer ${adminToken}`).send({
      name: 'Parallel', description: '', category: 'general',
    });
    const workflowId = await publishWorkflow(adminToken, project.body.data.id, 'Parallel pass', definition([
      { id: 'start', type: 'start', name: 'Start', next: 'end' },
      { id: 'end', type: 'end', name: 'End' },
    ]));
    await request(app).post(`/api/workflows/${workflowId}/run`).set('Authorization', `Bearer ${adminToken}`).send({ input: { n: 1 } });
    await request(app).post(`/api/workflows/${workflowId}/run`).set('Authorization', `Bearer ${adminToken}`).send({ input: { n: 2 } });
    const results = await Promise.all([
      processNextNativeJob(pool, cfg, 'w1'),
      processNextNativeJob(pool, cfg, 'w2'),
    ]);
    expect(results.map((job) => job.status).sort()).toEqual(['SUCCEEDED', 'SUCCEEDED']);
  });

  it('records a connector failure and a later successful retry', async () => {
    let hits = 0;
    const server = http.createServer((req, res) => {
      hits += 1;
      if (hits === 1) {
        res.writeHead(500);
        res.end('unavailable');
        return;
      }
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ ok: true }));
    });
    await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
    const { port } = server.address();
    const project = await request(app).post('/api/projects').set('Authorization', `Bearer ${adminToken}`).send({
      name: 'API sync', description: '', category: 'api',
    });
    const closed = await request(app).post(`/api/projects/${project.body.data.id}/connections`).set('Authorization', `Bearer ${adminToken}`).send({
      connectorType: 'rest_api', name: 'Closed port', config: { baseUrl: 'http://127.0.0.1:9' },
    });
    const failedTest = await request(app).post(`/api/connections/${closed.body.data.id}/test`).set('Authorization', `Bearer ${adminToken}`);
    expect(failedTest.body.data.status).toBe('unavailable');
    const connection = await request(app).post(`/api/projects/${project.body.data.id}/connections`).set('Authorization', `Bearer ${adminToken}`).send({
      connectorType: 'rest_api', name: 'Local fixture', config: { baseUrl: `http://127.0.0.1:${port}` },
    });
    const workflowId = await publishWorkflow(adminToken, project.body.data.id, 'Call API', definition([
      { id: 'start', type: 'start', name: 'Start', next: 'call' },
      { id: 'call', type: 'http_request', name: 'Call', config: { connectionId: connection.body.data.id, method: 'GET', path: '/health' }, next: 'end' },
      { id: 'end', type: 'end', name: 'End', config: { summaryFrom: ['call'] } },
    ]));
    const queued = await request(app).post(`/api/workflows/${workflowId}/run`).set('Authorization', `Bearer ${adminToken}`).send({ input: {} });
    const failed = await processNextNativeJob(pool, cfg, 'http-worker');
    expect(failed.id).toBe(queued.body.data.id);
    expect(failed.status).toBe('FAILED');
    await request(app).post(`/api/jobs/${failed.id}/retry`).set('Authorization', `Bearer ${adminToken}`);
    const succeeded = await processNextNativeJob(pool, cfg, 'http-worker');
    expect(succeeded.status).toBe('SUCCEEDED');
    server.close();
  });

  it('skips an overlapping schedule and exports the execution report', async () => {
    const project = await request(app).post('/api/projects').set('Authorization', `Bearer ${adminToken}`).send({
      name: 'Scheduled report', description: '', category: 'reporting',
    });
    const workflowId = await publishWorkflow(adminToken, project.body.data.id, 'Scheduled pass', definition([
      { id: 'start', type: 'start', name: 'Start', next: 'end' },
      { id: 'end', type: 'end', name: 'End' },
    ]));
    const schedule = await request(app).post('/api/schedules').set('Authorization', `Bearer ${adminToken}`).send({
      projectId: project.body.data.id,
      workflowId,
      name: 'Every minute',
      scheduleType: 'recurring',
      cronExpression: '* * * * *',
      timezone: 'UTC',
      overlapPolicy: 'skip',
      input: {},
    });
    expect(schedule.status).toBe(201);
    await pool.query(`UPDATE schedules SET next_run_at = DATE_SUB(UTC_TIMESTAMP(3), INTERVAL 1 MINUTE) WHERE id = ?`, [schedule.body.data.id]);
    const first = await runDueSchedules(pool, cfg);
    expect(first[0].status).toBe('TRIGGERED');
    await pool.query(`UPDATE schedules SET enabled = 1, next_run_at = DATE_SUB(UTC_TIMESTAMP(3), INTERVAL 1 MINUTE) WHERE id = ?`, [schedule.body.data.id]);
    const second = await runDueSchedules(pool, cfg);
    expect(second[0].status).toBe('SKIPPED');
    const csv = await request(app).get('/api/reports/export.csv').set('Authorization', `Bearer ${adminToken}`);
    expect(csv.status).toBe(200);
    expect(csv.text).toContain('status');
    const xlsx = await request(app).get('/api/reports/export.xlsx').set('Authorization', `Bearer ${adminToken}`);
    expect(xlsx.status).toBe(200);
  });

  it('accepts a robot result only for an authorized project', async () => {
    const project = await request(app).post('/api/projects').set('Authorization', `Bearer ${adminToken}`).send({
      name: 'Robot handoff', description: '', category: 'web',
    });
    const other = await request(app).post('/api/projects').set('Authorization', `Bearer ${adminToken}`).send({
      name: 'Other robot project', description: '', category: 'web',
    });
    const workflowId = await publishWorkflow(adminToken, project.body.data.id, 'Robot task', definition([
      { id: 'start', type: 'start', name: 'Start', next: 'end' },
      { id: 'end', type: 'end', name: 'End' },
    ]), 'uipath');
    const queued = await request(app).post(`/api/workflows/${workflowId}/run`).set('Authorization', `Bearer ${adminToken}`).send({ input: { order: '1001' } });
    expect(queued.body.data.status).toBe('QUEUED');
    expect(queued.body.data.executionTarget).toBe('robot');
    const untouched = await processNextNativeJob(pool, cfg, 'native');
    expect(untouched?.id).not.toBe(queued.body.data.id);
    const robot = await request(app).post('/api/robots').set('Authorization', `Bearer ${adminToken}`).send({
      name: 'File handoff robot', adapter: 'local_file_handoff', projectIds: [project.body.data.id],
    });
    const outsider = await request(app).post('/api/robots').set('Authorization', `Bearer ${adminToken}`).send({
      name: 'Other robot', adapter: 'local_file_handoff', projectIds: [other.body.data.id],
    });
    const denied = await request(app).post(`/api/robot/jobs/${queued.body.data.id}/result`).set('Authorization', `Bearer ${outsider.body.data.token}`).send({
      executionStatus: 'SUCCEEDED', output: {}, correlationId: queued.body.data.correlationId,
    });
    expect(denied.status).toBe(403);
    const inbox = path.join(cfg.robotRoot, 'inbox', `${queued.body.data.id}.json`);
    const payload = JSON.parse(await fs.readFile(inbox, 'utf8'));
    const reportPath = path.join(cfg.storageRoot, tenantId, project.body.data.id, 'reports', `${queued.body.data.id}.txt`);
    const result = await processHandoffFile(inbox, reportPath);
    const outbox = path.join(cfg.robotRoot, 'outbox');
    await fs.mkdir(outbox, { recursive: true });
    await fs.writeFile(path.join(outbox, `${queued.body.data.id}.json`), JSON.stringify(result));
    await syncRobotOutbox(pool, cfg);
    const detail = await request(app).get(`/api/jobs/${queued.body.data.id}`).set('Authorization', `Bearer ${adminToken}`);
    expect(detail.body.data.status).toBe('SUCCEEDED');
    expect(await fs.readFile(reportPath, 'utf8')).toContain(payload.jobId);
    const heartbeat = await request(app).post('/api/robot/heartbeat').set('Authorization', `Bearer ${robot.body.data.token}`);
    expect(heartbeat.body.data.status).toBe('available');
    const settings = await request(app).get('/api/settings').set('Authorization', `Bearer ${adminToken}`);
    expect(settings.body.data.robots.some((item) => item.adapter === 'local_file_handoff' && item.reportedAvailable)).toBe(true);
    expect(JSON.stringify(settings.body.data)).not.toContain(robot.body.data.token);
  });

  it('reports database unavailability without leaking a stack', async () => {
    const badPool = createPool('mysql://urap:urap_dev_password@127.0.0.1:1/urap_test');
    const badApp = createApp({ pool: badPool, config: cfg });
    const response = await request(badApp).get('/api/health');
    expect(response.status).toBe(503);
    expect(response.body.error.code).toBe('DATABASE_UNAVAILABLE');
    expect(response.body.stack).toBeUndefined();
    await badPool.end();
  });
});
