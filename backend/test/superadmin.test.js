import crypto from 'node:crypto';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createPool } from '../src/db/pool.js';
import { loadConfig } from '../src/config.js';
import { createApp } from '../src/http/createApp.js';
import { hashPassword } from '../src/lib/passwords.js';
import { claimNext } from '../src/services/jobService.js';

const cfg = loadConfig();
const pool = createPool(cfg.databaseUrl);
const app = createApp({ pool, config: { ...cfg, signupRateLimitMax: 1000 } });
const DEFAULT_TENANT = '00000000-0000-4000-8000-000000000001';
const t = `${Date.now()}${Math.random().toString(36).slice(2, 6)}`;
const password = 'Blue-river-2026-lamp';
let S; let A; let B; let D; let aUserId;
const as = (s) => ({ Authorization: `Bearer ${s.accessToken}` });
const yes = { confirm: true };

async function signup(name, org) {
  const res = await request(app).post('/api/auth/signup').send({ displayName: name, email: `${name.toLowerCase()}.${t}@example.com`, password, organization: org, acceptTerms: true });
  expect(res.status).toBe(201);
  return res.body.data;
}
async function defaultUser(email, role, superAdmin) {
  await pool.query(`INSERT INTO users (id, tenant_id, email, display_name, password_hash, role, status, is_super_admin, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, 'active', ?, UTC_TIMESTAMP(3), UTC_TIMESTAMP(3))`, [crypto.randomUUID(), DEFAULT_TENANT, email, email.split('@')[0], await hashPassword(password, 4), role, superAdmin ? 1 : 0]);
  return (await request(app).post('/api/auth/login').send({ email, password })).body.data;
}

beforeAll(async () => {
  S = await defaultUser(`super.${t}@example.com`, 'administrator', true);
  D = await defaultUser(`tenantadmin.${t}@example.com`, 'administrator', false);
  A = await signup('Plata', 'Plat Alpha');
  B = await signup('Platb', 'Plat Beta');
  aUserId = A.user.id;
  await request(app).post(`/api/projects/${A.projectId}/connections`).set(as(A)).send({ connectorType: 'rest_api', name: 'Alpha API', config: { baseUrl: 'http://127.0.0.1:9' }, secret: { token: 'PLAT-SECRET-VALUE' } });
});
afterAll(async () => { await pool.end(); });

describe('platform super admin', () => {
  it('flags the super admin in the session and hides the console from everyone else with 404', async () => {
    expect(S.user.isSuperAdmin).toBe(true);
    expect(D.user.isSuperAdmin).toBe(false);
    for (const who of [D, A, B]) {
      for (const url of ['/api/platform/overview', '/api/platform/workspaces', `/api/platform/workspaces/${DEFAULT_TENANT}`, '/api/platform/users', '/api/platform/audit', '/api/platform/anything']) {
        expect((await request(app).get(url).set(as(who))).status, url).toBe(404);
      }
      expect((await request(app).post(`/api/platform/users/${who.user.id}/grant-super-admin`).set(as(who)).send(yes)).status).toBe(404);
    }
    expect((await request(app).get('/api/platform/overview')).status).toBe(404);
    // Neither sign-up nor tenant admins can set the flag.
    expect((await request(app).post('/api/auth/signup').send({ displayName: 'X Y', email: `x.${t}@example.com`, password, organization: 'X', acceptTerms: true, isSuperAdmin: true })).status).toBe(400);
    expect((await request(app).patch(`/api/users/${D.user.id}`).set(as(D)).send({ isSuperAdmin: true })).status).toBeGreaterThanOrEqual(400);
    const [[row]] = await pool.query(`SELECT is_super_admin FROM users WHERE id = ?`, [D.user.id]);
    expect(row.is_super_admin).toBe(0);
  });

  it('sees every workspace and user without secrets', async () => {
    const overview = await request(app).get('/api/platform/overview').set(as(S));
    expect(overview.status).toBe(200);
    expect(overview.body.data.kpis.workspaces).toBeGreaterThanOrEqual(3);
    const list = await request(app).get(`/api/platform/workspaces?q=${t}&sort=name&dir=asc&limit=10`).set(as(S));
    expect(list.body.data.map((w) => w.name)).toEqual(['Default tenant', 'Plat Alpha', 'Plat Beta']);
    expect(list.body.data.find((w) => w.name === 'Plat Alpha')).toMatchObject({ ownerEmail: `plata.${t}@example.com`, users: 1, projects: 1, status: 'active' });
    const detail = await request(app).get(`/api/platform/workspaces/${A.user.tenantId}`).set(as(S));
    expect(detail.status).toBe(200);
    expect(detail.body.data.members[0]).toMatchObject({ email: `plata.${t}@example.com`, role: 'administrator' });
    const users = await request(app).get(`/api/platform/users?q=${t}`).set(as(S));
    expect(users.body.meta.total).toBeGreaterThanOrEqual(4);
    for (const body of [overview.body, list.body, detail.body, users.body]) {
      const text = JSON.stringify(body);
      expect(text).not.toContain('PLAT-SECRET-VALUE');
      expect(text).not.toMatch(/password_hash|token_hash|secret_ciphertext/);
    }
  });

  it('suspends a workspace: blocks its sign-in, API and robots and its jobs, but no one else', async () => {
    expect((await request(app).post(`/api/platform/workspaces/${A.user.tenantId}/suspend`).set(as(S)).send({})).status).toBe(400);
    expect((await request(app).post(`/api/platform/workspaces/${DEFAULT_TENANT}/suspend`).set(as(S)).send(yes)).status).toBe(409);
    const wf = await request(app).post('/api/workflows').set(as(A)).send({ projectId: A.projectId, name: 'Plat wf', description: 'x', executionType: 'native' });
    await request(app).post(`/api/workflows/${wf.body.data.id}/draft`).set(as(A)).send({ definition: { schemaVersion: '1.0', retryPolicy: { maxAttempts: 1, backoffSeconds: 0 }, steps: [{ id: 'start', type: 'start', name: 'Start', next: 'end' }, { id: 'end', type: 'end', name: 'End' }] } });
    await request(app).post(`/api/workflows/${wf.body.data.id}/publish`).set(as(A));
    const job = await request(app).post(`/api/workflows/${wf.body.data.id}/run`).set(as(A)).send({ input: {} });
    expect(job.status).toBe(202);

    const suspended = await request(app).post(`/api/platform/workspaces/${A.user.tenantId}/suspend`).set(as(S)).send({ ...yes, reason: 'Billing' });
    expect(suspended.status).toBe(200);
    expect(suspended.body.data.status).toBe('suspended');
    const api = await request(app).get('/api/projects').set(as(A));
    expect(api.status).toBe(403);
    expect(api.body.error).toMatchObject({ code: 'WORKSPACE_SUSPENDED' });
    expect(api.body.error.message).toMatch(/Workspace suspended/);
    const login = await request(app).post('/api/auth/login').send({ email: `plata.${t}@example.com`, password });
    expect(login.status).toBe(403);
    expect(login.body.error.code).toBe('WORKSPACE_SUSPENDED');
    expect((await request(app).post('/api/auth/refresh').send({ refreshToken: A.refreshToken })).status).toBe(401);
    // Workers skip the suspended workspace's queued job.
    const [[queued]] = await pool.query(`SELECT status FROM automation_jobs WHERE id = ?`, [job.body.data.id]);
    expect(queued.status).toBe('QUEUED');
    const [jobs] = await pool.query(`SELECT id FROM automation_jobs WHERE status = 'QUEUED' AND execution_target = 'native' AND tenant_id <> ?`, [A.user.tenantId]);
    if (!jobs.length) expect(await claimNext(pool, 'native', { workerId: 'test' })).toBeNull();
    const [[still]] = await pool.query(`SELECT status FROM automation_jobs WHERE id = ?`, [job.body.data.id]);
    expect(still.status).toBe('QUEUED');
    // Other workspaces keep working.
    expect((await request(app).get('/api/projects').set(as(B))).status).toBe(200);
    expect((await request(app).post('/api/auth/login').send({ email: `platb.${t}@example.com`, password })).status).toBe(200);

    expect((await request(app).post(`/api/platform/workspaces/${A.user.tenantId}/reactivate`).set(as(S)).send(yes)).status).toBe(200);
    expect((await request(app).post('/api/auth/login').send({ email: `plata.${t}@example.com`, password })).status).toBe(200);
    await request(app).post(`/api/jobs/${job.body.data.id}/cancel`).set(as((await request(app).post('/api/auth/login').send({ email: `plata.${t}@example.com`, password })).body.data));
  });

  it('disables and enables users, grants and revokes super admin, and audits every action', async () => {
    expect((await request(app).post(`/api/platform/users/${S.user.id}/disable`).set(as(S)).send(yes)).status).toBe(409);
    expect((await request(app).post(`/api/platform/users/${S.user.id}/revoke-super-admin`).set(as(S)).send(yes)).status).toBe(409);
    expect((await request(app).post(`/api/platform/users/${aUserId}/disable`).set(as(S)).send(yes)).status).toBe(200);
    expect((await request(app).post('/api/auth/login').send({ email: `plata.${t}@example.com`, password })).status).toBe(401);
    expect((await request(app).post(`/api/platform/users/${aUserId}/enable`).set(as(S)).send(yes)).status).toBe(200);
    expect((await request(app).post(`/api/platform/users/${B.user.id}/grant-super-admin`).set(as(S)).send(yes)).status).toBe(200);
    const asB = (await request(app).post('/api/auth/login').send({ email: `platb.${t}@example.com`, password })).body.data;
    expect(asB.user.isSuperAdmin).toBe(true);
    expect((await request(app).get('/api/platform/overview').set(as(asB))).status).toBe(200);
    expect((await request(app).post(`/api/platform/users/${B.user.id}/revoke-super-admin`).set(as(S)).send(yes)).status).toBe(200);
    expect((await request(app).get('/api/platform/overview').set(as(asB))).status).toBe(404);
    const audit = await request(app).get('/api/platform/audit?limit=50').set(as(S));
    const mine = audit.body.data.filter((r) => r.actorEmail === `super.${t}@example.com`).map((r) => r.action);
    for (const action of ['workspace.suspend', 'workspace.reactivate', 'user.disable', 'user.enable', 'super_admin.grant', 'super_admin.revoke']) expect(mine).toContain(action);
    expect(audit.body.data.find((r) => r.action === 'workspace.suspend' && r.actorEmail === `super.${t}@example.com`).metadata).toEqual({ reason: 'Billing' });
  });
});
