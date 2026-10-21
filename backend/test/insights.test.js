import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createPool } from '../src/db/pool.js';
import { loadConfig } from '../src/config.js';
import { createApp } from '../src/http/createApp.js';

const cfg = loadConfig();
const pool = createPool(cfg.databaseUrl);
const SECRET_TOKEN = 'orch-secret-token-should-never-leak-123';
const SECRET_KEY = 'ai-secret-key-should-never-leak-456';
const app = createApp({ pool, config: { ...cfg, signupRateLimitMax: 1000, signupRole: 'administrator', orchestrator: { baseUrl: 'https://cloud.example.com/org/tenant', token: SECRET_TOKEN, releaseKey: 'rel-key-secret-789', organizationUnitId: '' }, ai: { provider: 'openai', apiKey: SECRET_KEY, baseUrl: 'https://api.example.com/v1', model: 'gpt-test' } } });
let session;
const email = `insights.${Date.now()}@example.com`;

beforeAll(async () => {
  const res = await request(app).post('/api/auth/signup').send({ displayName: 'Insights Admin', email, password: 'Blue-river-2026-lamp', organization: 'Insights Org', acceptTerms: true });
  expect(res.status).toBe(201);
  session = res.body.data;
});
afterAll(async () => { await pool.end(); });
const auth = () => ({ Authorization: `Bearer ${session.accessToken}` });

describe('reports and settings overview', () => {
  it('returns KPIs and paginated jobs with totals, and validates filters', async () => {
    const summary = await request(app).get('/api/reports/summary?tzOffset=330&status=FAILED&trigger=manual').set(auth());
    expect(summary.status).toBe(200);
    expect(summary.body.data.kpis.failed).toBe(summary.body.data.kpis.total);
    expect(Array.isArray(summary.body.data.series)).toBe(true);
    const jobs = await request(app).get('/api/reports/jobs?limit=5&offset=0').set(auth());
    expect(jobs.status).toBe(200);
    expect(jobs.body.meta).toMatchObject({ limit: 5, offset: 0 });
    expect(jobs.body.data.length).toBeLessThanOrEqual(5);
    expect(typeof jobs.body.meta.total).toBe('number');
    expect((await request(app).get('/api/reports/jobs?status=BOGUS').set(auth())).status).toBe(400);
    expect((await request(app).get('/api/reports/summary?from=yesterday').set(auth())).status).toBe(400);
    expect((await request(app).get('/api/reports/export.csv?trigger=manual').set(auth())).status).toBe(200);
  });

  it('describes configuration without exposing secrets and records robot machine/version', async () => {
    const projects = await request(app).get('/api/projects?limit=5').set(auth());
    const robotName = `Insights Bot ${Date.now()}`;
    const robot = await request(app).post('/api/robots').set(auth()).send({ name: robotName, adapter: 'contract_simulator', projectIds: [projects.body.data[0].id] });
    expect(robot.status, JSON.stringify(robot.body)).toBe(201);
    const hb = await request(app).post('/api/robot/heartbeat').set({ Authorization: `Bearer ${robot.body.data.token}` }).send({ machine: 'BOX-01', version: 'urap-robot-1.0' });
    expect(hb.status).toBeLessThan(300);
    const res = await request(app).get('/api/settings/overview').set(auth());
    expect(res.status).toBe(200);
    const d = res.body.data;
    expect(d.orchestrator).toMatchObject({ configured: true, host: 'cloud.example.com', tokenConfigured: true });
    expect(d.ai).toMatchObject({ provider: 'openai', keyConfigured: true, host: 'api.example.com' });
    expect(d.robots.find((r) => r.name === robotName)).toMatchObject({ machine: 'BOX-01', version: 'urap-robot-1.0', online: true, jobsRun: 0 });
    expect(d.roleCounts.administrator.active).toBeGreaterThanOrEqual(1);
    expect(d.canEdit).toBe(true);
    const body = JSON.stringify(res.body);
    for (const s of [SECRET_TOKEN, SECRET_KEY, 'rel-key-secret-789', robot.body.data.token]) expect(body).not.toContain(s);
    expect(body).not.toMatch(/token_hash|password_hash|apiKey"|"token"/);
  });
});

describe('tenant settings', () => {
  it('lets an administrator rename the tenant and rejects bad input', async () => {
    const before = (await request(app).get('/api/settings/overview').set(auth())).body.data.tenant.name;
    expect((await request(app).patch('/api/settings/tenant').set(auth()).send({ name: 'x' })).status).toBe(400);
    const ok = await request(app).patch('/api/settings/tenant').set(auth()).send({ name: `${before} ` });
    expect(ok.status).toBe(200);
    expect(ok.body.data.name).toBe(before);
  });
});
