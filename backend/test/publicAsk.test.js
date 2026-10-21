import express from 'express';
import request from 'supertest';
import { describe, expect, it } from 'vitest';
import { fallbackAnswer, registerPublicAsk } from '../src/public/askAi.js';

function app(cfg, chat) {
  const a = express();
  a.use(express.json());
  registerPublicAsk(a, { pool: null, cfg: { env: 'test', ...cfg }, chat, logger: { warn() {} } });
  return a;
}
const envAi = { ai: { provider: 'openai', apiKey: 'sk-test-secret', model: 'gpt-x', requestTimeoutMs: 5000 } };

describe('POST /api/public/ask', () => {
  it('answers with the configured AI provider and a URAP system prompt, without auth', async () => {
    let seen;
    const res = await request(app(envAi, async (settings, req) => { seen = req; return { content: 'Studio designs workflows.' }; }))
      .post('/api/public/ask').send({ question: 'What is Studio?' });
    expect(res.status).toBe(200);
    expect(res.body.data).toEqual({ answer: 'Studio designs workflows.', source: 'ai' });
    expect(seen.messages[0].content).toMatch(/URAP/);
    expect(seen.messages.at(-1)).toEqual({ role: 'user', content: 'What is Studio?' });
  });

  it('falls back to the built-in FAQ when the provider fails, never leaking the error or key', async () => {
    const res = await request(app(envAi, async () => { throw Object.assign(new Error('HTTP 429: insufficient_quota sk-test-secret'), { code: 'AI_PROVIDER_ERROR' }); }))
      .post('/api/public/ask').send({ question: 'How do you help finance teams?', topic: 'finance' });
    expect(res.status).toBe(200);
    expect(res.body.data.source).toBe('fallback');
    expect(res.body.data.answer).toMatch(/invoices/);
    expect(res.body.data.answer).toMatch(/Try URAP free/);
    expect(JSON.stringify(res.body)).not.toMatch(/sk-test|quota|429/);
  });

  it('falls back when no AI is configured', async () => {
    const res = await request(app({ ai: { provider: '' } })).post('/api/public/ask').send({ question: 'Do you support UiPath robots?' });
    expect(res.body.data.source).toBe('fallback');
    expect(res.body.data.answer).toMatch(/UiPath robot/);
  });

  it('rejects empty and over-long questions', async () => {
    const a = app({ ai: { provider: '' } });
    expect((await request(a).post('/api/public/ask').send({ question: '' })).status).toBe(400);
    expect((await request(a).post('/api/public/ask').send({ question: 'x'.repeat(501) })).status).toBe(400);
  });

  it('rate limits per IP', async () => {
    const a = app({ ai: { provider: '' }, publicAskMax: 2 });
    for (let i = 0; i < 2; i += 1) expect((await request(a).post('/api/public/ask').send({ question: 'hi' })).status).toBe(200);
    const limited = await request(a).post('/api/public/ask').send({ question: 'hi' });
    expect(limited.status).toBe(429);
    expect(limited.body.error.code).toBe('RATE_LIMITED');
  });

  it('matches chips and keywords in the fallback', () => {
    expect(fallbackAnswer('anything', 'healthcare')).toMatch(/healthcare/);
    expect(fallbackAnswer('onboarding new employees')).toMatch(/HR/);
    expect(fallbackAnswer('tell me about the weather')).toMatch(/URAP is an automation platform/);
  });
});

describe('fallback FAQ coverage', () => {
  it('answers core feature questions without AI', () => {
    expect(fallbackAnswer('What is Action Center in URAP?')).toMatch(/pause on an approval/);
    expect(fallbackAnswer('Can you read scanned PDFs?')).toMatch(/OCR/);
  });
});
