import request from 'supertest';
import { afterAll, describe, expect, it } from 'vitest';
import { createPool } from '../src/db/pool.js';
import { loadConfig } from '../src/config.js';
import { createApp } from '../src/http/createApp.js';

const cfg = loadConfig();
const pool = createPool(cfg.databaseUrl);
const app = createApp({ pool, config: { ...cfg, signupRateLimitMax: 1000 } });

function signupBody(overrides = {}) {
  return {
    displayName: 'Asha Rao',
    email: `asha.${Date.now()}.${Math.random().toString(36).slice(2, 7)}@example.com`,
    password: 'Blue-river-2026-lamp',
    organization: 'Northwind Traders',
    acceptTerms: true,
    ...overrides,
  };
}

afterAll(async () => {
  await pool.end();
});

describe('self sign-up', () => {
  it('reports the public auth options', async () => {
    const response = await request(app).get('/api/auth/options');
    expect(response.status).toBe(200);
    expect(response.body.data).toMatchObject({ allowSignup: true, passwordReset: 'administrator', passwordMinLength: 12 });
  });

  it('creates a project manager with a starter project, signs them in, and lets them sign in again', async () => {
    const body = signupBody({ email: 'New.User@Example.com' });
    const response = await request(app).post('/api/auth/signup').send(body);
    expect(response.status).toBe(201);
    const { accessToken, refreshToken, user, projectId } = response.body.data;
    expect(accessToken).toBeTruthy();
    expect(refreshToken).toBeTruthy();
    expect(user).toMatchObject({ email: 'new.user@example.com', displayName: 'Asha Rao', role: 'project_manager', status: 'active' });
    expect(user).not.toHaveProperty('passwordHash');

    const me = await request(app).get('/api/auth/me').set('Authorization', `Bearer ${accessToken}`);
    expect(me.status).toBe(200);
    const projects = await request(app).get('/api/projects').set('Authorization', `Bearer ${accessToken}`);
    expect(projects.status).toBe(200);
    expect(projects.body.data.map((project) => project.id)).toEqual([projectId]);
    expect(projects.body.data[0].name).toBe('Northwind Traders workspace');

    // The new account can use the platform: create a workflow in its project.
    const workflow = await request(app).post('/api/workflows').set('Authorization', `Bearer ${accessToken}`).send({
      projectId, name: 'First workflow', description: 'Created after sign-up', executionType: 'native',
    });
    expect(workflow.status).toBe(201);
    // It is not an administrator.
    expect((await request(app).get('/api/users').set('Authorization', `Bearer ${accessToken}`)).status).toBe(403);

    const login = await request(app).post('/api/auth/login').send({ email: 'new.user@example.com', password: body.password });
    expect(login.status).toBe(200);

    const [audit] = await pool.query(`SELECT action FROM audit_logs WHERE actor_user_id = ? AND action = 'auth.signup'`, [user.id]);
    expect(audit).toHaveLength(1);
    const [stored] = await pool.query(`SELECT password_hash FROM users WHERE id = ?`, [user.id]);
    expect(stored[0].password_hash).not.toContain(body.password);
  });

  it('rejects a duplicate email with 409 regardless of case', async () => {
    const body = signupBody();
    expect((await request(app).post('/api/auth/signup').send(body)).status).toBe(201);
    const again = await request(app).post('/api/auth/signup').send({ ...body, email: body.email.toUpperCase() });
    expect(again.status).toBe(409);
    expect(again.body.error.code).toBe('EMAIL_IN_USE');
  });

  it('validates every field and creates nothing on failure', async () => {
    const cases = [
      [{ email: 'not-an-email' }, 'email'],
      [{ password: 'short1' }, 'password'],
      [{ password: 'onlyletterslonger' }, 'password'],
      [{ displayName: ' ' }, 'displayName'],
      [{ organization: '' }, 'organization'],
      [{ acceptTerms: false }, 'acceptTerms'],
      [{ role: 'administrator' }, ''],
    ];
    for (const [override, field] of cases) {
      const body = signupBody(override);
      const response = await request(app).post('/api/auth/signup').send(body);
      expect(response.status, JSON.stringify(override)).toBe(400);
      expect(response.body.error.code).toBe('VALIDATION');
      if (field) expect(response.body.error.details.some((item) => item.path.includes(field))).toBe(true);
      const [rows] = await pool.query(`SELECT id FROM users WHERE email = ?`, [String(body.email).toLowerCase()]);
      expect(rows).toHaveLength(0);
    }
    const withName = await request(app).post('/api/auth/signup').send(signupBody({ email: 'rameshkumar@example.com', password: 'rameshkumar-2026-x' }));
    expect(withName.status).toBe(400);
  });

  it('honours ALLOW_SIGNUP=false', async () => {
    const closed = createApp({ pool, config: { ...cfg, allowSignup: false } });
    expect((await request(closed).get('/api/auth/options')).body.data.allowSignup).toBe(false);
    const body = signupBody();
    const response = await request(closed).post('/api/auth/signup').send(body);
    expect(response.status).toBe(403);
    expect(response.body.error.code).toBe('SIGNUP_DISABLED');
    const [rows] = await pool.query(`SELECT id FROM users WHERE email = ?`, [body.email]);
    expect(rows).toHaveLength(0);
  });

  it('rate-limits sign-up attempts per client', async () => {
    const limited = createApp({ pool, config: { ...cfg, signupRateLimitMax: 2, signupRateLimitWindowMs: 60000 } });
    const statuses = [];
    for (let index = 0; index < 3; index += 1) {
      statuses.push((await request(limited).post('/api/auth/signup').send(signupBody({ acceptTerms: false }))).status);
    }
    expect(statuses).toEqual([400, 400, 429]);
    const blocked = await request(limited).post('/api/auth/signup').send(signupBody());
    expect(blocked.status).toBe(429);
    expect(blocked.body.error.code).toBe('RATE_LIMITED');
  });

  it('refuses an administrator SIGNUP_ROLE in configuration', () => {
    const previous = process.env.SIGNUP_ROLE;
    process.env.SIGNUP_ROLE = 'administrator';
    try {
      expect(() => loadConfig()).toThrow(/SIGNUP_ROLE/);
      process.env.SIGNUP_ROLE = 'operator';
      expect(loadConfig().signupRole).toBe('operator');
    } finally {
      if (previous === undefined) delete process.env.SIGNUP_ROLE; else process.env.SIGNUP_ROLE = previous;
    }
  });
});

describe('console password reset', () => {
  it('sets a new password, reactivates the user, and revokes sessions', async () => {
    const { generatePassword, resetPassword } = await import('../src/resetPassword.js');
    const body = signupBody();
    const created = await request(app).post('/api/auth/signup').send(body);
    expect(created.status).toBe(201);
    const password = generatePassword();
    expect(password).toMatch(/^[A-Za-z0-9]{4}-[A-Za-z0-9]{4}-[A-Za-z0-9]{4}-[A-Za-z0-9]{4}7$/);
    await resetPassword(pool, body.email, password, 4);
    expect((await request(app).post('/api/auth/login').send({ email: body.email, password: body.password })).status).toBe(401);
    expect((await request(app).post('/api/auth/login').send({ email: body.email, password })).status).toBe(200);
    expect((await request(app).post('/api/auth/refresh').send({ refreshToken: created.body.data.refreshToken })).status).toBe(401);
    await expect(resetPassword(pool, 'nobody@example.com', password, 4)).rejects.toThrow(/No user/);
    await expect(resetPassword(pool, body.email, 'short', 4)).rejects.toThrow(/12 characters/);
  });
});

describe('refresh token rotation', () => {
  it('lets only one of two concurrent refreshes with the same token win', async () => {
    const created = await request(app).post('/api/auth/signup').send(signupBody());
    const { refreshToken } = created.body.data;
    const results = await Promise.all([1, 2, 3].map(() => request(app).post('/api/auth/refresh').send({ refreshToken })));
    const statuses = results.map((r) => r.status).sort();
    expect(statuses).toEqual([200, 401, 401]);
    const winner = results.find((r) => r.status === 200).body.data;
    expect((await request(app).get('/api/auth/me').set('Authorization', `Bearer ${winner.accessToken}`)).status).toBe(200);
    expect((await request(app).post('/api/auth/refresh').send({ refreshToken: winner.refreshToken })).status).toBe(200);
  });
});
