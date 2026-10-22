// RewaHR attendance: Flutter punch step (fake page), the setup service, and the password credential.
import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createPool } from '../src/db/pool.js';
import { loadConfig } from '../src/config.js';
import { createApp } from '../src/http/createApp.js';
import { createRuntime } from '../src/services/runtime.js';
import { validateDefinition } from '../src/workflow/validate.js';
import { unsupportedSteps } from '../src/robot/robotRuntime.js';
import { buttonTexts, isNeverClick, labelPattern, MISSING_PASSWORD_MESSAGE, runFlutterAttendance } from '../src/automation/web/flutterAttendance.js';
import { attendanceDefinition, ensureRewahrAttendance, PUNCHES } from '../src/services/attendanceSetup.js';

// A stand-in for a Playwright page showing RewaHR (Flutter) after semantics are enabled.
// Screens: login → home (sidebar with Attendance and Log Out) → punch page (tabs, IN or OUT).
function fakeRewa({ goodPassword = 'pw-ok', punchedIn = false, sidebar = true, outChanges = true, inChanges = true } = {}) {
  const state = { screen: 'login', semantics: false, focused: null, typed: { Email: '', Password: '' }, clicks: [], punchedIn, gotoUrls: [] };
  const tabs = [{ role: 'tab', name: 'Punch In/Out' }, { role: 'tab', name: 'My Attendance Sheet' }, { role: 'tab', name: 'My Monthly Attendance' }];
  const chrome = [...(sidebar ? [{ role: 'button', name: 'Dashboard' }, { role: 'button', name: 'Attendance' }] : []), { role: 'button', name: 'Log Out' }];
  const elements = () => {
    if (!state.semantics) return [];
    if (state.screen === 'login') return [{ role: 'textbox', name: 'Email' }, { role: 'textbox', name: 'Password' }];
    if (state.screen === 'error') return [{ role: 'textbox', name: 'Email' }, { role: 'textbox', name: 'Password' }, { role: 'text', name: 'Invalid email or password' }];
    if (state.screen === 'home') return [...chrome, { role: 'text', name: 'Welcome' }];
    const punch = state.punchedIn
      ? [{ role: 'heading', name: 'Punch Out' }, { role: 'text', name: 'Punched in Date/Time :22-10-2026(9:8:36)' }, { role: 'textbox', name: 'Note' }, { role: 'button', name: 'OUT' }]
      : [{ role: 'heading', name: 'Punch In' }, { role: 'button', name: 'IN' }];
    if (state.screen === 'done-out') return [...chrome, ...tabs, { role: 'text', name: 'Punch Out Successfully' }];
    return [...chrome, ...tabs, ...punch];
  };
  const click = (element) => {
    state.clicks.push(element.name);
    if (element.role === 'textbox') state.focused = element.name;
    if (element.name === 'Log Out') state.screen = 'login';
    if (element.name === 'Attendance') state.screen = 'punch';
    if (element.name === 'OUT' && outChanges) state.screen = 'done-out';
    if (element.name === 'IN' && inChanges) state.punchedIn = true;
  };
  const query = (match) => ({
    count: async () => elements().filter(match).length,
    nth: (index) => {
      const pick = () => elements().filter(match)[index];
      return { isVisible: async () => Boolean(pick()), click: async () => click(pick()), getAttribute: async () => pick()?.name ?? null, innerText: async () => pick()?.name ?? '', boundingBox: async () => ({ x: 0, y: 0, width: 10, height: 10 }) };
    },
  });
  return {
    state,
    url: () => `https://hr.example/${state.screen === 'punch' ? '#punch%20in%20out%20page' : '#home'}`,
    goto: async (url) => { state.gotoUrls.push(url); if (url.includes('punch%20in%20out')) state.screen = 'punch'; },
    waitForTimeout: async () => {},
    screenshot: async ({ path: file }) => { await fs.writeFile(file, 'png'); },
    mouse: { click: async () => { state.clicks.push('mouse'); } },
    locator: (selector) => (selector === 'body'
      ? { ariaSnapshot: async () => elements().map((item) => `- ${item.role} "${item.name}"`).join('\n'), innerText: async () => '' }
      : { waitFor: async () => {}, count: async () => (state.semantics ? 0 : 1), first: () => ({ evaluate: async () => { state.semantics = true; } }) }),
    getByRole: (role, { name } = {}) => query((item) => item.role === role && (!name || name.test(item.name))),
    getByText: (pattern) => query((item) => item.role !== 'textbox' && pattern.test(item.name)),
    getByLabel: (pattern) => query((item) => item.role === 'textbox' && pattern.test(item.name)),
    getByPlaceholder: (pattern) => query((item) => item.role === 'textbox' && pattern.test(item.name)),
    keyboard: {
      press: async (key) => {
        if (key === 'Backspace' && state.focused) state.typed[state.focused] = '';
        if (key === 'Enter' && state.focused === 'Password') state.screen = state.typed.Password === goodPassword ? 'home' : 'error';
      },
      type: async (text) => { state.typed[state.focused] += text; },
    },
  };
}

const tmp = await fs.mkdtemp(path.join(os.tmpdir(), 'attendance-'));
const base = { email: 'someone@example.com', password: 'pw-ok', timeoutMs: 50, successTimeoutMs: 50, loginTimeoutMs: 50 };
// Runs the workflow's phases in order, the way the designer steps do.
async function runPhases(page, action, extra = {}) {
  const out = {};
  out.login = await runFlutterAttendance(page, { ...base, ...extra, action, phase: 'login' }, { storageRoot: tmp });
  out.attendance = await runFlutterAttendance(page, { ...base, ...extra, action, phase: 'attendance', password: undefined }, { storageRoot: tmp });
  out.punch = await runFlutterAttendance(page, { ...base, ...extra, action, phase: 'punch', password: undefined }, { storageRoot: tmp });
  out.verify = await runFlutterAttendance(page, { ...base, ...extra, action, phase: 'verify', password: undefined, previousStatus: out.punch.status }, { storageRoot: tmp });
  return out;
}

describe('Flutter attendance punch (RewaHR)', () => {
  it('matches whole button labels only, so OUT never matches Log Out', () => {
    expect(labelPattern('OUT').test('out')).toBe(true);
    expect(labelPattern('OUT').test('Log Out')).toBe(false);
    expect(labelPattern('IN').test('Punch In/Out')).toBe(false);
    expect(isNeverClick('Log Out')).toBe(true);
    expect(isNeverClick('OUT')).toBe(false);
    expect(buttonTexts('out', 'OUT')).toEqual(['OUT', 'Punch Out']);
    expect(buttonTexts('in', 'Mark In')).toEqual(['Mark In', 'IN', 'Punch In']);
  });

  it('Punch Out: logs in, opens Attendance from the sidebar, clicks OUT (never Log Out), and verifies', async () => {
    const page = fakeRewa({ punchedIn: true });
    const out = await runPhases(page, 'out');
    expect(page.state.typed).toEqual({ Email: 'someone@example.com', Password: 'pw-ok' });
    expect(out.attendance).toMatchObject({ onPunchPage: true, state: 'punched_in' });
    expect(out.punch).toMatchObject({ status: 'CLICKED', button: 'OUT' });
    expect(out.verify).toMatchObject({ status: 'PUNCHED', confirmed: true });
    expect(page.state.clicks).toContain('Attendance');
    expect(page.state.clicks).toContain('OUT');
    expect(page.state.clicks).not.toContain('Log Out');
    expect(page.state.clicks).not.toContain('Punch Out');
    for (const step of Object.values(out)) expect(step.screenshots.length).toBeGreaterThan(0);
    expect(JSON.stringify(out)).not.toContain('pw-ok');
  });

  it('Punch In: clicks IN and verifies it is now punched in', async () => {
    const page = fakeRewa({ punchedIn: false });
    const out = await runPhases(page, 'in');
    expect(out.punch).toMatchObject({ status: 'CLICKED', button: 'IN' });
    expect(out.verify).toMatchObject({ status: 'PUNCHED' });
  });

  it('Punch In when already punched in: ALREADY_DONE, nothing clicked', async () => {
    const page = fakeRewa({ punchedIn: true });
    const out = await runPhases(page, 'in');
    expect(out.punch).toMatchObject({ status: 'ALREADY_DONE', clicked: false });
    expect(out.verify).toMatchObject({ status: 'ALREADY_DONE' });
    expect(page.state.clicks).not.toContain('OUT');
    expect(page.state.clicks).not.toContain('IN');
  });

  it('Punch Out when not punched in: NOT_PUNCHED_IN, nothing clicked', async () => {
    const page = fakeRewa({ punchedIn: false });
    const out = await runPhases(page, 'out');
    expect(out.punch).toMatchObject({ status: 'NOT_PUNCHED_IN', clicked: false });
    expect(page.state.clicks).not.toContain('IN');
  });

  it('falls back to the Punch In/Out URL when the sidebar has no Attendance item', async () => {
    const page = fakeRewa({ punchedIn: true, sidebar: false });
    const out = await runPhases(page, 'out');
    expect(page.state.gotoUrls.at(-1)).toBe('https://hr.example/#punch%20in%20out%20page');
    expect(out.verify.status).toBe('PUNCHED');
  });

  it('fails Verify (with a screenshot) when the page does not change after OUT', async () => {
    const page = fakeRewa({ punchedIn: true, outChanges: false });
    await expect(runPhases(page, 'out')).rejects.toMatchObject({ code: 'PUNCH_UNCONFIRMED', screenshots: expect.arrayContaining([expect.stringMatching(/failed\.png$/)]) });
  });

  it('fails clearly when the password is missing, before touching the page', async () => {
    const page = fakeRewa();
    await expect(runFlutterAttendance(page, { ...base, password: '', action: 'in', phase: 'login', missingCredentialMessage: MISSING_PASSWORD_MESSAGE }, { storageRoot: tmp }))
      .rejects.toMatchObject({ code: 'CREDENTIAL_MISSING', message: 'Set REWAHR_PASSWORD in Settings (Connections → REWAHR_PASSWORD → Set password)' });
    expect(page.state.clicks).toEqual([]);
  });

  it('reports a login failure with a screenshot and without the password', async () => {
    const page = fakeRewa();
    const error = await runFlutterAttendance(page, { ...base, password: 'wrong-secret', action: 'in', phase: 'login' }, { storageRoot: tmp }).catch((caught) => caught);
    expect(error.code).toBe('LOGIN_FAILED');
    expect(error.message).not.toContain('wrong-secret');
    expect(error.screenshots.at(-1)).toMatch(/failed\.png$/);
  });

  it('runs every phase in one step with phase "all"', async () => {
    const page = fakeRewa({ punchedIn: true });
    const result = await runFlutterAttendance(page, { ...base, action: 'out' }, { storageRoot: tmp });
    expect(result).toMatchObject({ phase: 'all', status: 'PUNCHED' });
  });

  it('builds the designer steps: Open, Log in, Go to Attendance, Punch, Verify, Close, Record', () => {
    const credentialId = crypto.randomUUID();
    for (const punch of PUNCHES) {
      const definition = attendanceDefinition({ action: punch.action, credentialId });
      expect(definition.steps.map((step) => step.name)).toEqual(['Start', 'Open RewaHR', 'Log in', 'Go to Attendance', punch.action === 'in' ? 'Punch In (click IN)' : 'Punch Out (click OUT)', 'Verify', 'Close browser', 'Record result', 'End']);
      const validation = validateDefinition(definition, { connectionIds: new Set([credentialId]), connectionTypes: new Map([[credentialId, 'credential']]) });
      expect(validation.errors).toEqual([]);
      expect(JSON.stringify(definition)).not.toMatch(/"password"\s*:/);
      expect(unsupportedSteps(definition)).toHaveLength(4);
    }
    expect(validateDefinition(attendanceDefinition({ action: 'sideways', credentialId }), { connectionIds: new Set([credentialId]) }).valid).toBe(false);
  });
});

describe('RewaHR setup and the password credential', () => {
  const cfg = loadConfig();
  const pool = createPool(cfg.databaseUrl);
  const app = createApp({ pool, config: { ...cfg, signupRateLimitMax: 1000 } });
  const t = `${Date.now()}${Math.random().toString(36).slice(2, 6)}`;
  const email = `attendance.${t}@example.com`;
  let session; let summary;
  const as = () => ({ Authorization: `Bearer ${session.accessToken}` });

  beforeAll(async () => {
    const res = await request(app).post('/api/auth/signup').send({ displayName: 'Attendance', email, password: 'Blue-river-2026-lamp', organization: `Attendance ${t}`, acceptTerms: true });
    expect(res.status).toBe(201);
    session = res.body.data;
    summary = await ensureRewahrAttendance(pool, { ownerEmail: email });
  });
  afterAll(async () => {
    // Never leave enabled schedules behind for the worker tests.
    await pool.query(`UPDATE schedules SET enabled = 0, next_run_at = NULL WHERE project_id = ?`, [summary.projectId]);
    await pool.end();
  });

  it('creates an empty REWAHR_PASSWORD credential, two published workflows, and Mon-Fri schedules in Asia/Kolkata', async () => {
    expect(summary.projectId).toBe(session.projectId);
    expect(summary.passwordSet).toBe(false);
    const [workflows] = await pool.query(`SELECT name, status, execution_type FROM workflows WHERE project_id = ? ORDER BY name`, [summary.projectId]);
    expect(workflows.filter((row) => row.name.startsWith('RewaHR'))).toEqual([
      { name: 'RewaHR Punch In', status: 'published', execution_type: 'native' },
      { name: 'RewaHR Punch Out', status: 'published', execution_type: 'native' },
    ]);
    const [schedules] = await pool.query(`SELECT name, cron_expression, timezone, enabled, input_json FROM schedules WHERE project_id = ? ORDER BY cron_expression DESC`, [summary.projectId]);
    expect(schedules.map((row) => [row.cron_expression, row.timezone, row.enabled])).toEqual([['45 17 * * 1-5', 'Asia/Kolkata', 1], ['10 9 * * 1-5', 'Asia/Kolkata', 1]]);
    expect(schedules[0].input_json).toEqual({ email });
    const [connections] = await pool.query(`SELECT name, connector_type, secret_ciphertext FROM connections WHERE id = ?`, [summary.credentialId]);
    expect(connections[0]).toMatchObject({ name: 'REWAHR_PASSWORD', connector_type: 'credential', secret_ciphertext: null });
  });

  it('creates a RewaHR Attendance project when the owner has none', async () => {
    const ownerEmail = `noproject.${t}@example.com`;
    const [[tenant]] = await pool.query(`SELECT tenant_id FROM users WHERE email = ?`, [email]);
    await pool.query(`INSERT INTO users (id, tenant_id, email, display_name, password_hash, role, status, created_at, updated_at)
      VALUES (?, ?, ?, 'No Project', 'x', 'administrator', 'active', UTC_TIMESTAMP(3), UTC_TIMESTAMP(3))`, [crypto.randomUUID(), tenant.tenant_id, ownerEmail]);
    const made = await ensureRewahrAttendance(pool, { ownerEmail });
    expect(made.projectName).toBe('RewaHR Attendance');
    expect(made.created[0]).toBe('project RewaHR Attendance');
    await pool.query(`UPDATE schedules SET enabled = 0, next_run_at = NULL WHERE project_id = ?`, [made.projectId]);
  });

  it('is safe to run again', async () => {
    const again = await ensureRewahrAttendance(pool, { ownerEmail: email });
    expect(again.created).toEqual([]);
    expect(again.workflows.every((item) => item.published === false)).toBe(true);
  });

  it('fails the punch with "Set REWAHR_PASSWORD in Settings" while the password is empty', async () => {
    const runtime = createRuntime(pool, cfg, { tenant_id: summary.tenantId, project_id: summary.projectId, id: crypto.randomUUID() });
    await expect(runtime.web('browser_flutter_attendance', { phase: 'login', action: 'in', email, credentialId: summary.credentialId, missingCredentialMessage: MISSING_PASSWORD_MESSAGE }))
      .rejects.toMatchObject({ code: 'CREDENTIAL_MISSING', message: expect.stringMatching(/^Set REWAHR_PASSWORD in Settings/) });
  });

  it('lets the user set the password; it is stored encrypted and never returned or audited', async () => {
    const value = `pw-${t}`;
    const res = await request(app).put(`/api/connections/${summary.credentialId}/secret`).set(as()).send({ secret: { password: value } });
    expect(res.status).toBe(200);
    expect(res.body.data.hasSecret).toBe(true);
    expect(JSON.stringify(res.body)).not.toContain(value);
    expect((await request(app).put(`/api/connections/${summary.credentialId}/secret`).set(as()).send({ secret: { password: '' } })).status).toBe(400);
    const [rows] = await pool.query(`SELECT secret_ciphertext FROM connections WHERE id = ?`, [summary.credentialId]);
    expect(rows[0].secret_ciphertext.toString('latin1')).not.toContain(value);
    const [audit] = await pool.query(`SELECT metadata_json FROM audit_logs WHERE entity_id = ? AND action = 'connection.secret_update'`, [summary.credentialId]);
    expect(audit).toHaveLength(1);
    expect(JSON.stringify(audit[0].metadata_json)).not.toContain(value);
    // With a password the step gets past the credential check (and stops at "no browser open").
    const runtime = createRuntime(pool, cfg, { tenant_id: summary.tenantId, project_id: summary.projectId, id: crypto.randomUUID() });
    await expect(runtime.web('browser_flutter_attendance', { action: 'in', email, credentialId: summary.credentialId })).rejects.toMatchObject({ code: 'NO_BROWSER' });
    const list = await request(app).get(`/api/projects/${summary.projectId}/connections`).set(as());
    expect(JSON.stringify(list.body)).not.toContain(value);
  });

  it('keeps other tenants out of the secret endpoint', async () => {
    const other = await request(app).post('/api/auth/signup').send({ displayName: 'Other', email: `other.${t}@example.com`, password: 'Blue-river-2026-lamp', organization: `Other ${t}`, acceptTerms: true });
    const res = await request(app).put(`/api/connections/${summary.credentialId}/secret`).set({ Authorization: `Bearer ${other.body.data.accessToken}` }).send({ secret: { password: 'x' } });
    expect(res.status).toBe(404);
  });
});
