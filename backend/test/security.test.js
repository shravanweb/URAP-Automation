import request from 'supertest';
import bcrypt from 'bcryptjs';
import { afterAll, describe, expect, it } from 'vitest';
import { createPool } from '../src/db/pool.js';
import { loadConfig } from '../src/config.js';
import { createApp } from '../src/http/createApp.js';
import { clientError, corsOptions, effectiveBcryptRounds, needsRehash, parseOrigins } from '../src/lib/security.js';
import { resolveInside } from '../src/lib/paths.js';

const cfg = loadConfig();
const pool = createPool(cfg.databaseUrl);
const app = createApp({ pool, config: { ...cfg, corsOrigin: 'http://localhost:5173, https://urap.example.com/' } });

afterAll(async () => { await pool.end(); });

describe('security helpers', () => {
  it('enforces a bcrypt cost floor of 12 and a ceiling of 15', () => {
    expect(effectiveBcryptRounds(10)).toBe(12);
    expect(effectiveBcryptRounds('abc')).toBe(12);
    expect(effectiveBcryptRounds(13)).toBe(13);
    expect(effectiveBcryptRounds(30)).toBe(15);
  });

  it('flags weaker hashes for upgrade', () => {
    const weak = bcrypt.hashSync('x', 4);
    expect(needsRehash(weak, 12)).toBe(true);
    expect(needsRehash(weak, 4)).toBe(false);
    expect(needsRehash('not-a-hash', 12)).toBe(false);
  });

  it('parses a comma-separated CORS allowlist and only allows listed origins', () => {
    expect(parseOrigins(' http://a.test/ ,https://b.test')).toEqual(['http://a.test', 'https://b.test']);
    expect(parseOrigins('')).toEqual(['http://localhost:5173']);
    const { origin } = corsOptions('http://a.test');
    const decide = (o) => new Promise((resolve) => origin(o, (_e, ok) => resolve(ok)));
    return Promise.all([decide('http://a.test'), decide('http://evil.test'), decide(undefined)])
      .then((r) => expect(r).toEqual([true, false, true]));
  });

  it('maps parser and upload errors to safe responses and hides everything else', () => {
    expect(clientError({ type: 'entity.parse.failed' }).status).toBe(400);
    expect(clientError({ type: 'entity.too.large' }).status).toBe(413);
    expect(clientError({ code: 'LIMIT_UNEXPECTED_FILE' }).code).toBe('UPLOAD_REJECTED');
    expect(clientError(new Error('boom at /secret/path'))).toBeNull();
  });

  it('blocks path traversal outside the storage root', () => {
    expect(() => resolveInside('/data/root', '../../etc/passwd')).toThrow(/escapes/);
    expect(() => resolveInside('/data/root', 'a\0b')).toThrow();
    expect(resolveInside('/data/root', 'uploads/a.csv')).toBe('/data/root/uploads/a.csv');
  });
});

describe('security behaviour over HTTP', () => {
  it('sends hardened headers and no-store on API responses', async () => {
    const res = await request(app).get('/api/health');
    expect(res.headers['x-powered-by']).toBeUndefined();
    expect(res.headers['x-content-type-options']).toBe('nosniff');
    expect(res.headers['content-security-policy']).toContain("default-src 'none'");
    expect(res.headers['cache-control']).toBe('no-store');
  });

  it('reflects only allow-listed origins', async () => {
    const ok = await request(app).get('/api/health').set('Origin', 'https://urap.example.com');
    expect(ok.headers['access-control-allow-origin']).toBe('https://urap.example.com');
    const bad = await request(app).get('/api/health').set('Origin', 'https://evil.example');
    expect(bad.headers['access-control-allow-origin']).toBeUndefined();
  });

  it('returns 400 (not 500) for malformed JSON without leaking details', async () => {
    const res = await request(app).post('/api/auth/login').set('Content-Type', 'application/json').send('{"email":');
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('BAD_JSON');
    expect(JSON.stringify(res.body)).not.toMatch(/at |stack|node_modules/);
  });

  it('rejects oversized JSON bodies with 413', async () => {
    const res = await request(app).post('/api/auth/login').send({ email: 'a@b.co', password: 'x'.repeat(1_200_000) });
    expect(res.status).toBe(413);
  });

  it('validates login input lengths', async () => {
    const res = await request(app).post('/api/auth/login').send({ email: 'a@b.co', password: 'x'.repeat(500) });
    expect(res.status).toBe(400);
  });

  it('gives the same answer for unknown emails and wrong passwords', async () => {
    const res = await request(app).post('/api/auth/login').send({ email: `nobody.${Date.now()}@example.com`, password: 'Wrong-password-1' });
    expect(res.status).toBe(401);
    expect(res.body.error.code).toBe('INVALID_CREDENTIALS');
  });

  it('rate limits auth endpoints outside tests', async () => {
    const limited = createApp({ pool, config: { ...cfg, env: 'production', authRateLimitMax: 2, refreshRateLimitMax: 2, rateLimitMax: 1000 } });
    const codes = [];
    for (let i = 0; i < 3; i += 1) codes.push((await request(limited).post('/api/auth/login').send({ email: 'x@example.com', password: 'nope' })).status);
    expect(codes[2]).toBe(429);
    const refresh = [];
    for (let i = 0; i < 3; i += 1) refresh.push((await request(limited).post('/api/auth/refresh').send({ refreshToken: 'x'.repeat(40) })).status);
    expect(refresh).toEqual([401, 401, 429]);
  });

  it('requires authentication for artifact downloads', async () => {
    const res = await request(app).get('/api/artifacts/../../etc/passwd/download');
    expect([401, 404]).toContain(res.status);
  });
});
