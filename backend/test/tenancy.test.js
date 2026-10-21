import crypto from 'node:crypto';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createPool } from '../src/db/pool.js';
import { loadConfig } from '../src/config.js';
import { createApp } from '../src/http/createApp.js';
import { hashPassword } from '../src/lib/passwords.js';

const cfg = loadConfig();
const pool = createPool(cfg.databaseUrl);
const app = createApp({ pool, config: { ...cfg, signupRateLimitMax: 1000 } });
const DEFAULT_TENANT = '00000000-0000-4000-8000-000000000001';
const t = `${Date.now()}${Math.random().toString(36).slice(2, 6)}`;
const password = 'Blue-river-2026-lamp';
let A; let B; let D; const ids = {};
const as = (s) => ({ Authorization: `Bearer ${s.accessToken}` });

async function signup(name, org) {
  const res = await request(app).post('/api/auth/signup').send({ displayName: name, email: `${name.toLowerCase()}.${t}@example.com`, password, organization: org, acceptTerms: true });
  expect(res.status).toBe(201);
  return res.body.data;
}

beforeAll(async () => {
  A = await signup('Tenanta', 'Alpha Corp');
  B = await signup('Tenantb', 'Beta Corp');
  // A Default-tenant administrator, like the existing installation's admin.
  const email = `default.admin.${t}@example.com`;
  await pool.query(`INSERT INTO users (id, tenant_id, email, display_name, password_hash, role, status, created_at, updated_at)
    VALUES (?, ?, ?, 'Default Admin', ?, 'administrator', 'active', UTC_TIMESTAMP(3), UTC_TIMESTAMP(3))`, [crypto.randomUUID(), DEFAULT_TENANT, email, await hashPassword(password, 4)]);
  D = (await request(app).post('/api/auth/login').send({ email, password })).body.data;

  const pa = A.projectId;
  const wf = await request(app).post('/api/workflows').set(as(A)).send({ projectId: pa, name: 'Alpha private workflow', description: 'x', executionType: 'native' });
  ids.workflow = wf.body.data.id;
  await request(app).post(`/api/workflows/${ids.workflow}/draft`).set(as(A)).send({ definition: { schemaVersion: '1.0', retryPolicy: { maxAttempts: 1, backoffSeconds: 0 }, steps: [{ id: 'start', type: 'start', name: 'Start', next: 'end' }, { id: 'end', type: 'end', name: 'End' }] } });
  expect((await request(app).post(`/api/workflows/${ids.workflow}/publish`).set(as(A))).status).toBe(200);
  const job = await request(app).post(`/api/workflows/${ids.workflow}/run`).set(as(A)).send({ input: { secret: 'ALPHA-PRIVATE' } });
  ids.job = job.body.data.id;
  // Do not leave a QUEUED job behind for other suites' workers to pick up.
  expect((await request(app).post(`/api/jobs/${ids.job}/cancel`).set(as(A))).status).toBeLessThan(300);
  ids.connection = (await request(app).post(`/api/projects/${pa}/connections`).set(as(A)).send({ connectorType: 'rest_api', name: 'Alpha API', config: { baseUrl: 'http://127.0.0.1:9' } })).body.data.id;
  ids.file = (await request(app).post(`/api/projects/${pa}/files`).set(as(A)).attach('file', Buffer.from('alpha file'), 'alpha.txt')).body.data.id;
  ids.queue = (await request(app).post('/api/queues').set(as(A)).send({ projectId: pa, name: 'Alpha queue', maxRetries: 1, uniqueReference: false })).body.data.id;
  const robot = await request(app).post('/api/robots').set(as(A)).send({ name: `Alpha robot ${t}`, adapter: 'contract_simulator', projectIds: [pa] });
  expect(robot.status).toBe(201);
  ids.robot = robot.body.data.id;
  ids.robotToken = robot.body.data.token;
  expect(Object.values(ids).every(Boolean)).toBe(true);
});
afterAll(async () => { await pool.end(); });

describe('one workspace per self sign-up', () => {
  it('puts each sign-up in its own tenant as administrator, never the Default tenant', () => {
    expect(A.user.role).toBe('administrator');
    expect(B.user.role).toBe('administrator');
    expect(A.user.tenantId).not.toBe(B.user.tenantId);
    expect([A.user.tenantId, B.user.tenantId]).not.toContain(DEFAULT_TENANT);
  });

  it('shows B nothing of A in any list, summary or settings', async () => {
    const leaks = [];
    for (const url of ['/api/projects?limit=100', '/api/workflows?limit=100', '/api/jobs?limit=100', '/api/queues?limit=100', '/api/schedules?limit=100', '/api/tasks?limit=100',
      '/api/apps?limit=100', '/api/cases?limit=100', '/api/flows?limit=100', '/api/agents?limit=100', '/api/bpmn?limit=100', '/api/reports/executions', '/api/reports/jobs?limit=100',
      '/api/reports/summary', '/api/audit?limit=100', '/api/audit/facets', '/api/dashboard', '/api/notifications', '/api/settings', '/api/settings/overview', '/api/users', '/api/robots',
      `/api/reports/export.csv?projectId=${A.projectId}`, `/api/audit/export.csv`]) {
      const res = await request(app).get(url).set(as(B));
      expect(res.status, url).toBe(200);
      const text = JSON.stringify(res.body) + (res.text || '');
      if (/Alpha|tenanta|ALPHA-PRIVATE/.test(text)) leaks.push(url);
    }
    expect(leaks).toEqual([]);
    const overview = (await request(app).get('/api/settings/overview').set(as(B))).body.data;
    expect(overview.tenant.name).toBe('Beta Corp');
    expect(overview.robots).toEqual([]);
    expect(overview.roleCounts).toEqual({ administrator: { active: 1, disabled: 0 } });
    expect((await request(app).get('/api/users').set(as(B))).body.data.map((u) => u.email)).toEqual([`tenantb.${t}@example.com`]);
    expect((await request(app).get('/api/projects').set(as(B))).body.data.map((p) => p.id)).toEqual([B.projectId]);
  });

  it('returns 404 for every A resource B asks for by id, and blocks writes', async () => {
    for (const url of [`/api/projects/${A.projectId}`, `/api/projects/${A.projectId}/files`, `/api/projects/${A.projectId}/connections`, `/api/projects/${A.projectId}/members`,
      `/api/workflows/${ids.workflow}`, `/api/jobs/${ids.job}`, `/api/queues/${ids.queue}`, `/api/queues/${ids.queue}/items`, `/api/artifacts/${ids.file}/download`]) {
      expect((await request(app).get(url).set(as(B))).status, url).toBe(404);
    }
    expect((await request(app).post(`/api/workflows/${ids.workflow}/run`).set(as(B)).send({ input: {} })).status).toBe(404);
    expect((await request(app).post(`/api/connections/${ids.connection}/test`).set(as(B))).status).toBe(404);
    expect((await request(app).post(`/api/robots/${ids.robot}/rotate-token`).set(as(B))).status).toBe(404);
    expect((await request(app).post('/api/robots').set(as(B)).send({ name: 'x', adapter: 'contract_simulator', projectIds: [A.projectId] })).status).toBe(404);
    const [aUser] = await pool.query(`SELECT id FROM users WHERE email = ?`, [`tenanta.${t}@example.com`]);
    expect((await request(app).patch(`/api/users/${aUser[0].id}`).set(as(B)).send({ status: 'disabled' })).status).toBe(404);
    expect((await request(app).post(`/api/projects/${B.projectId}/members`).set(as(B)).send({ userId: aUser[0].id, role: 'viewer' })).status).toBe(404);
  });

  it('renames only the caller\'s workspace and lets admins add users to their own tenant only', async () => {
    expect((await request(app).patch('/api/settings/tenant').set(as(B)).send({ name: 'Beta Renamed' })).status).toBe(200);
    expect((await request(app).get('/api/settings/overview').set(as(A))).body.data.tenant.name).toBe('Alpha Corp');
    const created = await request(app).post('/api/users').set(as(B)).send({ email: `invited.${t}@example.com`, displayName: 'Invited Viewer', password, role: 'viewer' });
    expect(created.status).toBe(201);
    const [row] = await pool.query(`SELECT tenant_id, role FROM users WHERE email = ?`, [`invited.${t}@example.com`]);
    expect(row[0]).toEqual({ tenant_id: B.user.tenantId, role: 'viewer' });
  });

  it('keeps robot tokens inside their tenant', async () => {
    const robotAuth = { Authorization: `Bearer ${ids.robotToken}` };
    expect((await request(app).post('/api/robot/heartbeat').set(robotAuth).send({ machine: 'ALPHA-PC' })).status).toBeLessThan(300);
    const queue = await request(app).get('/api/robot/queue').set(robotAuth);
    expect(queue.status).toBe(200);
    expect(JSON.stringify(queue.body)).not.toMatch(/Beta|Default/);
    expect((await request(app).get('/api/settings/overview').set(as(B))).body.data.robots).toEqual([]);
    expect((await request(app).get('/api/settings/overview').set(as(A))).body.data.robots.map((r) => r.machine)).toEqual(['ALPHA-PC']);
  });

  it('leaves the Default tenant as it was and hides sign-up workspaces from its admin', async () => {
    const overview = (await request(app).get('/api/settings/overview').set(as(D))).body.data;
    expect(overview.tenant.slug).toBe('default');
    expect(overview.robots.map((r) => r.name)).not.toContain(`Alpha robot ${t}`);
    const users = (await request(app).get('/api/users').set(as(D))).body.data.map((u) => u.email);
    expect(users).not.toContain(`tenanta.${t}@example.com`);
    expect(users).not.toContain(`tenantb.${t}@example.com`);
    expect((await request(app).get(`/api/projects/${A.projectId}`).set(as(D))).status).toBe(404);
    expect((await request(app).get(`/api/jobs/${ids.job}`).set(as(D))).status).toBe(404);
  });
});
