// Attendance punch on a Flutter web app (RewaHR). Flutter draws on a canvas, so the page has no
// normal inputs or buttons. Clicking the hidden "Enable accessibility" placeholder makes Flutter
// add semantics nodes with roles and labels, which Playwright can then find.
//
// One step type, several phases, so the designer shows each stage as its own activity:
//   login       enable semantics → Email → Password (from a Credential) → Login
//   attendance  sidebar "Attendance" (or the #punch%20in%20out%20page URL) → "Punch In/Out" tab
//   punch       read the state; click IN / OUT only when it applies (else ALREADY_DONE / NOT_PUNCHED_IN)
//   verify      wait until the clicked button is gone or a success text shows
// phase "all" runs them in order. A screenshot is saved after every phase.
// Button labels match the WHOLE label (ignoring case and spaces): "OUT" never matches "Log Out",
// and anything that looks like log out / sign out is never clicked.
// The password is never returned, logged, or put in an error message.
import fs from 'node:fs/promises';
import path from 'node:path';
import { AppError } from '../../lib/errors.js';
import { resolveInside } from '../../lib/paths.js';

export const PHASES = ['all', 'login', 'attendance', 'punch', 'verify'];
export const DEFAULT_BUTTONS = { in: ['IN', 'Punch In'], out: ['OUT', 'Punch Out'] };
export const PUNCHED_IN_TEXTS = ['Punched in Date/Time', 'Punched in Date', 'Punched In'];
export const DEFAULT_SUCCESS_TEXTS = ['success', 'successfully', 'punched out', 'marked', 'recorded'];
export const DEFAULT_CONFIRM_TEXTS = ['Confirm', 'Yes'];
export const DEFAULT_LOGIN_ERROR_TEXTS = ['invalid', 'incorrect', 'wrong password', 'not found', 'failed'];
export const PUNCH_PAGE_HASH = '#punch%20in%20out%20page';
export const MISSING_PASSWORD_MESSAGE = 'Set REWAHR_PASSWORD in Settings (Connections → REWAHR_PASSWORD → Set password)';
const NEVER_CLICK = /\b(log\s*-?\s*out|sign\s*-?\s*out|logout|signout)\b/i;

const escapeRegex = (text) => String(text).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const words = (text) => String(text).trim().split(/\s+/).map(escapeRegex).join('\\s*');
/** Whole-label match, ignoring case and spacing: "OUT" matches " out " but not "Log Out". */
export function labelPattern(text) {
  return new RegExp(`^\\s*${words(text)}\\s*$`, 'i');
}
/** Contains match for page text such as headings. */
export function textPattern(text) {
  return new RegExp(words(text), 'i');
}
export const isNeverClick = (label) => NEVER_CLICK.test(String(label || ''));

export function listOf(value, fallback) {
  const items = (Array.isArray(value) ? value : typeof value === 'string' ? value.split(',') : [])
    .map((item) => String(item).trim()).filter(Boolean);
  return items.length ? items : fallback;
}

/** Button labels for an action: the configured one first, then the defaults, without repeats. */
export function buttonTexts(action, configured) {
  const all = [...listOf(configured, []), ...DEFAULT_BUTTONS[action]];
  return all.filter((item, index) => all.findIndex((other) => other.toLowerCase() === item.toLowerCase()) === index);
}

async function labelOf(locator) {
  return (await locator.getAttribute?.('aria-label').catch(() => null)) || (await locator.innerText?.().catch(() => '')) || '';
}

async function firstVisible(candidates) {
  for (const locator of candidates) {
    const count = await locator.count().catch(() => 0);
    for (let index = 0; index < Math.min(count, 8); index += 1) {
      const item = locator.nth(index);
      if (!(await item.isVisible().catch(() => false))) continue;
      if (isNeverClick(await labelOf(item))) continue;
      return item;
    }
  }
  return null;
}

function buttonCandidates(page, text) {
  const pattern = labelPattern(text);
  return [page.getByRole('button', { name: pattern }), page.getByRole('tab', { name: pattern }), page.getByRole('menuitem', { name: pattern }), page.getByText(pattern)];
}

function fieldCandidates(page, label) {
  const pattern = textPattern(label);
  return [page.getByRole('textbox', { name: pattern }), page.getByLabel(pattern), page.getByPlaceholder(pattern)];
}

async function poll(page, timeoutMs, check) {
  const until = Date.now() + timeoutMs;
  for (;;) {
    const found = await check();
    if (found) return found;
    if (Date.now() >= until) return null;
    await page.waitForTimeout(400);
  }
}

async function findButton(page, texts) {
  // Real buttons (and tabs / menu items) first for every label, plain text only after that, so a
  // heading such as "Punch Out" is never preferred over the OUT button.
  const safe = texts.filter((text) => !isNeverClick(text));
  for (let kind = 0; kind < 4; kind += 1) {
    for (const text of safe) {
      const locator = await firstVisible([buttonCandidates(page, text)[kind]]);
      if (locator) return { text, locator };
    }
  }
  return null;
}

async function bodyText(page) {
  // Flutter keeps its semantics nodes in a shadow root; the accessibility snapshot reaches them.
  const body = page.locator('body');
  const [aria, text] = await Promise.all([body.ariaSnapshot().catch(() => ''), body.innerText().catch(() => '')]);
  return `${aria}\n${text}`;
}

export async function enableFlutterSemantics(page, timeoutMs) {
  const placeholder = page.locator('flt-semantics-placeholder');
  await placeholder.waitFor({ state: 'attached', timeout: Math.min(timeoutMs, 15000) }).catch(() => {});
  // The placeholder sits off-screen, so dispatch the click on the element itself.
  if (await placeholder.count().catch(() => 0)) await placeholder.first().evaluate((node) => node.click()).catch(() => {});
  const ready = await poll(page, timeoutMs, async () => (await page.getByRole('textbox').count().catch(() => 0)) + (await page.getByRole('button').count().catch(() => 0)) + (await page.getByText(/\S/).count().catch(() => 0)) > 0);
  return Boolean(ready);
}

async function typeInto(page, locator, text) {
  await locator.click();
  await page.waitForTimeout(250);
  // Flutter moves focus to its own hidden <input>; clear anything already there, then type.
  await page.keyboard.press('Control+A').catch(() => {});
  await page.keyboard.press('Backspace').catch(() => {});
  await page.keyboard.type(text, { delay: 20 });
}

/** Reads the Punch In/Out tab: punched_in (OUT shown or "Punched in Date/Time"), not_punched_in (IN shown), or unknown. */
export async function readPunchState(page, config = {}) {
  const outButton = await findButton(page, buttonTexts('out', config.punchOutText));
  const inButton = await findButton(page, buttonTexts('in', config.punchInText));
  const text = (await bodyText(page)).toLowerCase();
  const punchedText = listOf(config.punchedInTexts, PUNCHED_IN_TEXTS).find((item) => text.includes(item.toLowerCase()));
  if (outButton || punchedText) return { state: 'punched_in', outButton, inButton, evidence: outButton ? `"${outButton.text}" button` : `text "${punchedText}"` };
  if (inButton) return { state: 'not_punched_in', outButton, inButton, evidence: `"${inButton.text}" button` };
  return { state: 'unknown', outButton, inButton, evidence: 'no IN or OUT button' };
}

function phaseContext(page, config, storageRoot) {
  const action = config.action === 'out' ? 'out' : 'in';
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  const folder = String(config.screenshotFolder || 'screenshots/attendance').replace(/\\/g, '/').replace(/\/+$/, '');
  const screenshots = [];
  const log = [];
  const shot = async (label) => {
    if (!storageRoot) return;
    const relative = `${folder}/${stamp}-${String(screenshots.length + 1).padStart(2, '0')}-${label}.png`;
    const file = resolveInside(storageRoot, relative);
    await fs.mkdir(path.dirname(file), { recursive: true });
    await page.screenshot({ path: file }).then(() => screenshots.push(relative)).catch(() => {});
  };
  const fail = async (code, message) => {
    await shot('failed');
    const error = new AppError(code === 'ELEMENT_NOT_FOUND' ? 504 : 422, code, message);
    error.screenshots = screenshots;
    throw error;
  };
  return { action, screenshots, log, shot, fail, wait: Number(config.timeoutMs) || 30000 };
}

async function loginPhase(page, config, ctx) {
  const email = String(config.email || '').trim();
  if (!email) throw new AppError(400, 'VALIDATION', 'email is required');
  if (config.password == null || String(config.password) === '') throw new AppError(400, 'CREDENTIAL_MISSING', config.missingCredentialMessage || MISSING_PASSWORD_MESSAGE);
  const password = String(config.password);
  if (config.url) await page.goto(String(config.url), { waitUntil: 'load' });
  ctx.log.push((await enableFlutterSemantics(page, ctx.wait)) ? 'accessibility enabled' : 'accessibility placeholder not found');
  await ctx.shot('login-page');
  const emailField = await poll(page, ctx.wait, () => firstVisible(fieldCandidates(page, config.emailLabel || 'Email')));
  if (!emailField) await ctx.fail('ELEMENT_NOT_FOUND', 'Could not find the Email field on the login page');
  await typeInto(page, emailField, email);
  const passwordField = await poll(page, ctx.wait, () => firstVisible(fieldCandidates(page, config.passwordLabel || 'Password')));
  if (!passwordField) await ctx.fail('ELEMENT_NOT_FOUND', 'Could not find the Password field on the login page');
  await typeInto(page, passwordField, password);
  ctx.log.push('credentials entered');
  // RewaHR's Login button has no semantics node, so: the button if exposed, else Enter in the
  // password field, else a click just below the password field where the button is drawn.
  const login = await poll(page, 3000, () => findButton(page, listOf(config.loginTexts, ['Login', 'Log in', 'Sign in'])));
  if (login) {
    await login.locator.click();
    ctx.log.push(`clicked ${login.text}`);
  } else {
    await page.keyboard.press('Enter');
    ctx.log.push('pressed Enter in the password field');
    const left = await poll(page, 4000, async () => !(await firstVisible(fieldCandidates(page, config.passwordLabel || 'Password'))));
    const box = left ? null : await passwordField.boundingBox().catch(() => null);
    if (box) {
      const x = box.x + box.width / 2;
      const y = box.y + box.height + (Number(config.loginButtonOffsetY) || 43);
      await page.mouse.click(x, y);
      ctx.log.push(`clicked the Login button area at ${Math.round(x)},${Math.round(y)}`);
    }
  }
  const loginErrors = listOf(config.loginErrorTexts, DEFAULT_LOGIN_ERROR_TEXTS);
  const outcome = await poll(page, Number(config.loginTimeoutMs) || ctx.wait, async () => {
    const stillLogin = await firstVisible(fieldCandidates(page, config.passwordLabel || 'Password'));
    if (!stillLogin) return { ok: true };
    const text = (await bodyText(page)).toLowerCase();
    const problem = loginErrors.find((item) => text.includes(item.toLowerCase()));
    return problem ? { ok: false, problem } : null;
  });
  await ctx.shot('after-login');
  if (!outcome) await ctx.fail('LOGIN_FAILED', 'Still on the login page after Login. Check the email and REWAHR_PASSWORD.');
  if (!outcome.ok) await ctx.fail('LOGIN_FAILED', `Login failed (the page says "${outcome.problem}"). Check the email and REWAHR_PASSWORD.`);
  ctx.log.push('logged in');
  return { loggedIn: true };
}

async function attendancePhase(page, config, ctx) {
  await enableFlutterSemantics(page, Math.min(ctx.wait, 10000));
  const menu = await poll(page, Math.min(ctx.wait, 15000), () => findButton(page, listOf(config.menuTexts, ['Attendance'])));
  if (menu) {
    await menu.locator.click();
    ctx.log.push(`clicked sidebar ${menu.text}`);
  } else {
    // Fallback: the Punch In/Out page has its own URL.
    const target = new URL(config.punchPageUrl || PUNCH_PAGE_HASH, page.url()).toString();
    await page.goto(target, { waitUntil: 'load' });
    await enableFlutterSemantics(page, Math.min(ctx.wait, 10000));
    ctx.log.push('sidebar Attendance not found; opened the Punch In/Out page URL');
  }
  await page.waitForTimeout(1000);
  const tab = await poll(page, 5000, () => findButton(page, listOf(config.tabTexts, ['Punch In/Out', 'Punch In / Out'])));
  if (tab) {
    await tab.locator.click();
    ctx.log.push(`selected tab ${tab.text}`);
  }
  const state = await poll(page, ctx.wait, async () => {
    const read = await readPunchState(page, config);
    return read.state === 'unknown' ? null : read;
  });
  await ctx.shot('attendance-page');
  if (!state) await ctx.fail('ELEMENT_NOT_FOUND', 'The Punch In/Out page did not show an IN or OUT button');
  ctx.log.push(`punch page shows ${state.state} (${state.evidence})`);
  return { onPunchPage: true, state: state.state, url: page.url() };
}

async function punchPhase(page, config, ctx) {
  const read = await poll(page, ctx.wait, async () => {
    const value = await readPunchState(page, config);
    return value.state === 'unknown' ? null : value;
  });
  if (!read) await ctx.fail('ELEMENT_NOT_FOUND', 'The Punch In/Out page did not show an IN or OUT button');
  if (ctx.action === 'in' && read.state === 'punched_in') {
    ctx.log.push(`already punched in (${read.evidence}); not clicking`);
    await ctx.shot('already-punched-in');
    return { action: 'in', status: 'ALREADY_DONE', clicked: false, state: read.state };
  }
  if (ctx.action === 'out' && read.state === 'not_punched_in') {
    ctx.log.push(`not punched in today (${read.evidence}); not clicking OUT`);
    await ctx.shot('not-punched-in');
    return { action: 'out', status: 'NOT_PUNCHED_IN', clicked: false, state: read.state };
  }
  const button = ctx.action === 'in' ? read.inButton : read.outButton;
  if (!button) await ctx.fail('ELEMENT_NOT_FOUND', `Could not find the ${ctx.action === 'in' ? 'IN' : 'OUT'} button`);
  if (isNeverClick(button.text) || isNeverClick(await labelOf(button.locator))) await ctx.fail('UNSAFE_TARGET', 'Refused to click a log out control');
  await button.locator.click();
  ctx.log.push(`clicked ${button.text}`);
  await page.waitForTimeout(1000);
  const confirm = await poll(page, 3000, () => findButton(page, listOf(config.confirmTexts, DEFAULT_CONFIRM_TEXTS)));
  if (confirm) {
    await confirm.locator.click();
    ctx.log.push(`confirmed with ${confirm.text}`);
  }
  await ctx.shot(`clicked-${ctx.action}`);
  return { action: ctx.action, status: 'CLICKED', clicked: true, button: button.text };
}

async function verifyPhase(page, config, ctx) {
  const previous = String(config.previousStatus || '');
  if (['ALREADY_DONE', 'NOT_PUNCHED_IN'].includes(previous)) {
    ctx.log.push(`nothing to verify: ${previous}`);
    return { action: ctx.action, status: previous, confirmed: true, clicked: false };
  }
  const successTexts = listOf(config.successTexts, DEFAULT_SUCCESS_TEXTS);
  const changed = await poll(page, Number(config.successTimeoutMs) || 15000, async () => {
    const text = (await bodyText(page)).toLowerCase();
    const hit = successTexts.find((item) => text.includes(item.toLowerCase()));
    if (hit) return `text "${hit}"`;
    const read = await readPunchState(page, config);
    if (ctx.action === 'out' && !read.outButton) return read.inButton ? 'IN button is shown' : 'OUT button is gone';
    if (ctx.action === 'in' && !read.inButton && read.state === 'punched_in') return `now punched in (${read.evidence})`;
    return null;
  });
  await ctx.shot('verified');
  if (!changed) {
    if (config.failIfUnconfirmed === false) return { action: ctx.action, status: 'UNCONFIRMED', confirmed: false };
    await ctx.fail('PUNCH_UNCONFIRMED', `Clicked ${ctx.action === 'in' ? 'IN' : 'OUT'} but the page did not change; check the screenshot before punching again`);
  }
  ctx.log.push(`confirmed by ${changed}`);
  return { action: ctx.action, status: 'PUNCHED', confirmed: true, by: changed };
}

/**
 * Runs one phase (or "all") on an open page. `config.password` is filled in by the runtime from
 * the credential for the login phase; it is never part of the workflow definition or the output.
 */
export async function runFlutterAttendance(page, config, { storageRoot, timeoutMs = 30000 } = {}) {
  const phase = config.phase || 'all';
  if (!PHASES.includes(phase)) throw new AppError(400, 'VALIDATION', `phase must be one of ${PHASES.join(', ')}`);
  const ctx = phaseContext(page, { timeoutMs, ...config }, storageRoot);
  const password = config.password == null ? '' : String(config.password);
  const scrub = (text) => (password ? String(text).split(password).join('***') : String(text));
  const finish = (output) => ({ phase, action: ctx.action, ...output, url: page.url(), log: ctx.log, screenshots: ctx.screenshots, artifacts: ctx.screenshots });
  try {
    if (phase === 'login') return finish(await loginPhase(page, config, ctx));
    if (phase === 'attendance') return finish(await attendancePhase(page, config, ctx));
    if (phase === 'punch') return finish(await punchPhase(page, config, ctx));
    if (phase === 'verify') return finish(await verifyPhase(page, config, ctx));
    await loginPhase(page, config, ctx);
    await attendancePhase(page, config, ctx);
    const punched = await punchPhase(page, config, ctx);
    return finish(await verifyPhase(page, { ...config, previousStatus: punched.status }, ctx));
  } catch (error) {
    if (error instanceof AppError) {
      error.screenshots ||= ctx.screenshots;
      error.message = scrub(error.message);
      throw error;
    }
    await ctx.shot('failed');
    const wrapped = new AppError(502, 'BROWSER_ERROR', `Attendance ${phase}: ${scrub(String(error?.message || error).split('\n')[0]).slice(0, 400)}`);
    wrapped.screenshots = ctx.screenshots;
    throw wrapped;
  }
}

/** Phases that need the password. */
export const needsPassword = (config = {}) => ['all', 'login'].includes(config.phase || 'all');
