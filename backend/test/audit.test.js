import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createPool } from '../src/db/pool.js';
import { loadConfig } from '../src/config.js';
import { createApp } from '../src/http/createApp.js';

const cfg = loadConfig();
const pool = createPool(cfg.databaseUrl);
const app = createApp({ pool, config: { ...cfg, signupRateLimitMax: 1000 } });
let session;
const email = `audit.${Date.now()}@example.com`;
const password = 'Blue-river-2026-lamp';

beforeAll(async () => {
  const res = await request(app).post('/api/auth/signup').set('User-Agent', 'AuditTest/1.0').send({ displayName: 'Audit Tester', email, password, organization: 'Audit Org', acceptTerms: true });
  expect(res.status).toBe(201);
  session = res.body.data;
});
afterAll(async () => { await pool.end(); });
const auth = () => ({ Authorization: `Bearer ${session.accessToken}` });

describe('audit log', () => {
  it('records request context and failed sign-ins without secrets', async () => {
    const bad = await request(app).post('/api/auth/login').set('User-Agent', 'AuditTest/1.0').set('X-Request-Id', 'req-audit-12345').send({ email, password: 'Wrong-password-99' });
    expect(bad.status).toBe(401);
    expect(bad.headers['x-request-id']).toBe('req-audit-12345');
    const ok = await request(app).post('/api/auth/login').set('User-Agent', 'AuditTest/1.0').send({ email, password });
    expect(ok.status).toBe(200);
    const res = await request(app).get('/api/audit?limit=50&category=auth').set(auth());
    expect(res.status).toBe(200);
    const failed = res.body.data.find((r) => r.action === 'auth.login_failed');
    expect(failed).toMatchObject({ result: 'failure', userAgent: 'AuditTest/1.0', requestId: 'req-audit-12345', category: 'auth' });
    expect(failed.actor).toMatchObject({ type: 'user', email, name: 'Audit Tester' });
    expect(JSON.stringify(res.body)).not.toContain('Wrong-password-99');
    expect(JSON.stringify(res.body)).not.toContain(password);
    expect(res.body.data.every((r) => r.action.startsWith('auth'))).toBe(true);
  });

  it('resolves entity names, filters by result/date/type, paginates, and summarises', async () => {
    const created = await request(app).post('/api/projects').set(auth()).send({ name: 'Audit Named Project', category: 'finance' });
    expect(created.status).toBe(201);
    const page = await request(app).get('/api/audit?limit=1&entityType=project').set(auth());
    expect(page.status).toBe(200);
    expect(page.body.meta.limit).toBe(1);
    const proj = page.body.data[0];
    expect(proj.entity.type).toBe('project');
    expect(proj.entity.name).toBe('Audit Named Project');
    expect(proj.project?.name).toBe('Audit Named Project');
    const fails = await request(app).get('/api/audit?result=failure').set(auth());
    expect(fails.body.data.length).toBeGreaterThan(0);
    expect(fails.body.data.every((r) => r.result === 'failure')).toBe(true);
    const future = await request(app).get(`/api/audit?from=${encodeURIComponent(new Date(Date.now() + 3600000).toISOString())}`).set(auth());
    expect(future.body.meta.total).toBe(0);
    const badDate = await request(app).get('/api/audit?from=yesterday').set(auth());
    expect(badDate.status).toBe(400);
    const since = new Date(Date.now() - 3600000).toISOString();
    const summary = await request(app).get(`/api/audit/summary?since=${encodeURIComponent(since)}`).set(auth());
    expect(summary.body.data.signIns).toBeGreaterThanOrEqual(1);
    expect(summary.body.data.failures).toBeGreaterThanOrEqual(1);
    const facets = await request(app).get('/api/audit/facets').set(auth());
    expect(facets.body.data.categories).toContain('auth');
    expect(facets.body.data.users.some((u) => u.email === email)).toBe(true);
  });

  it('exports the filtered result as CSV and requires authentication', async () => {
    const csv = await request(app).get('/api/audit/export.csv?category=auth').set(auth());
    expect(csv.status).toBe(200);
    expect(csv.headers['content-type']).toContain('text/csv');
    expect(csv.text.split('\n')[0]).toContain('time_utc,action,result');
    expect(csv.text).toContain('auth.login_failed');
    expect((await request(app).get('/api/audit/export.csv')).status).toBe(401);
  });
});
