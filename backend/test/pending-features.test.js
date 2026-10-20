import { createCanvas } from '@napi-rs/canvas';
import request from 'supertest';
import { afterAll, describe, expect, it } from 'vitest';
import { loadConfig } from '../src/config.js';
import { createPool } from '../src/db/pool.js';
import { createApp } from '../src/http/createApp.js';
import { runUserCode } from '../src/agent/sandbox.js';
import { findTemplate } from '../src/automation/web/imageMatch.js';
import { extractFields } from '../src/automation/documents/extraction.js';
import { takeLastResetMail } from '../src/services/passwordResetMail.js';

const base = loadConfig();
const cfg = { ...base, publicUrl: 'http://localhost:5173', smtp: { jsonTransport: true, from: 'urap@example.com' } };
const pool = createPool(base.databaseUrl);
const app = createApp({ pool, config: cfg });

afterAll(async () => {
  await pool.end();
});

describe('coded agent sandbox', () => {
  it('returns JSON from the script and refuses filesystem access', async () => {
    const value = await runUserCode({ source: 'return { summary: String(input.request), n: input.n + 1 };', input: { request: 'file the invoice', n: 2 } });
    expect(value).toEqual({ summary: 'file the invoice', n: 3 });
    await expect(runUserCode({
      source: "const fs = await import('node:fs'); return fs.readFileSync('package.json', 'utf8');",
      timeoutMs: 8000,
    })).rejects.toThrow();
  });
});

describe('image click matching', () => {
  it('finds a painted block inside a larger image', async () => {
    const hay = createCanvas(80, 40);
    const hctx = hay.getContext('2d');
    hctx.fillStyle = '#ffffff';
    hctx.fillRect(0, 0, 80, 40);
    hctx.fillStyle = '#d63a0c';
    hctx.fillRect(30, 10, 12, 12);
    const needle = createCanvas(12, 12);
    needle.getContext('2d').fillStyle = '#d63a0c';
    needle.getContext('2d').fillRect(0, 0, 12, 12);
    const found = await findTemplate(hay.toBuffer('image/png'), needle.toBuffer('image/png'), { threshold: 0.05 });
    expect(found).toMatchObject({ x: 30, y: 10, width: 12, height: 12 });
  });
});

describe('handwriting-tolerant extraction', () => {
  it('reads a noisy invoice number from the original text', () => {
    const text = '1nv0ice N0: INV-100\nT0tal: 42.00';
    const result = extractFields(text, { documentType: 'invoice', handwriting: true, minConfidence: 0.5 });
    expect(result.handwriting).toBe(true);
    expect(result.values.invoiceNumber).toBe('INV-100');
  });
});

describe('password reset email', () => {
  it('emails a link when SMTP is configured and accepts the new password', async () => {
    const email = `reset.${Date.now()}@example.com`;
    const signup = await request(app).post('/api/auth/signup').send({
      displayName: 'Reset User', email, password: 'Blue-river-2026-lamp', organization: 'Northwind', acceptTerms: true,
    });
    expect(signup.status).toBe(201);
    const options = await request(app).get('/api/auth/options');
    expect(options.body.data.passwordReset).toBe('email');
    const forgot = await request(app).post('/api/auth/forgot-password').send({ email });
    expect(forgot.status).toBe(200);
    expect(forgot.body.data).toEqual({ accepted: true, emailConfigured: true });
    const mail = takeLastResetMail();
    const token = decodeURIComponent(String(mail.text).match(/token=([^\s]+)/)[1]);
    const reset = await request(app).post('/api/auth/reset-password').send({ token, password: 'Green-harbor-2026-key' });
    expect(reset.status).toBe(200);
    const login = await request(app).post('/api/auth/login').send({ email, password: 'Green-harbor-2026-key' });
    expect(login.status).toBe(200);
    const stale = await request(app).post('/api/auth/reset-password').send({ token, password: 'Green-harbor-2026-key' });
    expect(stale.status).toBe(400);
  });
});
