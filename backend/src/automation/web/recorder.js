// Web recorder: opens a browser on the machine that runs the API (or the robot via the CLI),
// records clicks, typing, and selections, and turns them into workflow steps. "Pick" mode
// returns selector candidates for one element without recording a step.
import crypto from 'node:crypto';
import { AppError } from '../../lib/errors.js';
import { checkUrl } from './browserManager.js';
import { RECORDER_SCRIPT } from './recorderScript.js';

const IDLE_MS = 15 * 60 * 1000;

function stepName(prefix, element) {
  const label = element?.text || element?.candidates?.[0]?.selector || '';
  return `${prefix}${label ? ` ${label}` : ''}`.slice(0, 80);
}

/** Converts recorded browser events to workflow steps (without ids or next links). */
export function eventsToSteps(events, { startUrl } = {}) {
  const steps = [];
  if (startUrl) steps.push({ type: 'browser_open', name: 'Open Browser', config: { url: startUrl, browser: 'chromium' } });
  let lastUrl = startUrl;
  for (const event of events) {
    if (event.kind === 'navigate') {
      if (event.url !== lastUrl && !event.afterAction) steps.push({ type: 'browser_navigate', name: 'Navigate', config: { url: event.url } });
      lastUrl = event.url;
      continue;
    }
    const primary = event.element?.candidates?.[0];
    if (!primary) continue;
    const base = { selector: primary.selector, selectorType: primary.selectorType };
    if (event.kind === 'click') {
      steps.push({ type: 'browser_click', name: stepName('Click', event.element), config: base });
    } else if (event.kind === 'fill' || event.kind === 'enter') {
      // Passwords are never recorded: the step asks for a Credential connection instead.
      const value = event.secret ? { credentialId: '', credentialField: 'password' } : { text: event.value };
      const previous = steps[steps.length - 1];
      if (previous?.type === 'browser_type' && previous.config.selector === base.selector && previous.config.selectorType === base.selectorType) {
        Object.assign(previous.config, value);
        if (event.kind === 'enter') previous.config.pressEnter = true;
      } else {
        const name = event.secret ? 'Type password (choose a credential)' : stepName('Type into', event.element);
        steps.push({ type: 'browser_type', name, config: { ...base, ...value, ...(event.kind === 'enter' ? { pressEnter: true } : {}) } });
      }
    } else if (event.kind === 'select') {
      steps.push({ type: 'browser_select_option', name: stepName('Select option', event.element), config: { ...base, value: event.value } });
    }
  }
  return steps;
}

/** Wraps recorded steps in a runnable definition: start -> steps -> close browser -> end. */
export function stepsToDefinition(steps) {
  const counters = {};
  const body = [...steps, { type: 'browser_close', name: 'Close Browser', config: {} }].map((step) => {
    const short = step.type.replace(/^browser_/, '');
    counters[short] = (counters[short] || 0) + 1;
    return { id: `${short}_${counters[short]}`, ...step };
  });
  const all = [{ id: 'start', type: 'start', name: 'Start' }, ...body, { id: 'end', type: 'end', name: 'End', config: {} }];
  all.forEach((step, index) => { if (index < all.length - 1) step.next = all[index + 1].id; });
  return { schemaVersion: '1.0', retryPolicy: { maxAttempts: 1, backoffSeconds: 0 }, steps: all };
}

export function createRecorder({ cfg = {}, playwright = null } = {}) {
  const sessions = new Map();

  async function loadPlaywright() {
    if (playwright) return playwright;
    try {
      return await import('playwright');
    } catch {
      throw new AppError(500, 'PLAYWRIGHT_MISSING', 'Playwright is not installed. Run npm install, then npx playwright install chromium');
    }
  }

  function get(id, ownerId) {
    const session = sessions.get(id);
    if (!session || (ownerId && session.ownerId !== ownerId)) throw new AppError(404, 'NOT_FOUND', 'Recorder session not found');
    session.touched = Date.now();
    return session;
  }

  function present(session) {
    return {
      id: session.id,
      status: session.status,
      mode: session.mode,
      startUrl: session.startUrl,
      events: session.events.length,
      picks: session.picks,
      steps: eventsToSteps(session.events, { startUrl: session.startUrl }),
      headless: session.headless,
      error: session.error || null,
    };
  }

  async function start({ url, headless, ownerId }) {
    const startUrl = checkUrl(url, cfg.browserAllowedHosts || []);
    const pw = await loadPlaywright();
    const useHeadless = headless ?? cfg.recorderHeadless ?? false;
    let browser;
    try {
      browser = await pw.chromium.launch({
        headless: useHeadless,
        executablePath: cfg.browserExecutablePath || undefined,
        channel: cfg.browserChannel || undefined,
      });
    } catch (error) {
      throw new AppError(500, 'BROWSER_LAUNCH_FAILED', `Could not start the recorder browser. On a server without a display, set RECORDER_HEADLESS=true or run "npm run record" on a desktop. ${String(error.message).split('\n')[0]}`);
    }
    const session = { id: crypto.randomUUID(), ownerId, startUrl, browser, events: [], picks: [], status: 'recording', mode: 'record', headless: useHeadless, touched: Date.now() };
    const context = await browser.newContext({ viewport: { width: 1280, height: 800 } });
    await context.exposeBinding('__urapRecord', (_source, event) => {
      if (!event || typeof event !== 'object') return;
      session.touched = Date.now();
      if (event.kind === 'pick') session.picks.unshift({ at: new Date().toISOString(), url: event.url, element: event.element });
      else if (['click', 'fill', 'enter', 'select'].includes(event.kind)) session.events.push({ ...event, at: Date.now() });
      session.picks = session.picks.slice(0, 20);
    });
    await context.addInitScript({ content: RECORDER_SCRIPT });
    const page = await context.newPage();
    page.on('framenavigated', (frame) => {
      if (frame !== page.mainFrame()) return;
      const last = session.events[session.events.length - 1];
      const afterAction = last && last.kind !== 'navigate' && Date.now() - last.at < 3000;
      session.events.push({ kind: 'navigate', url: frame.url(), afterAction, at: Date.now() });
    });
    browser.on('disconnected', () => { if (session.status === 'recording') session.status = 'closed'; });
    session.context = context;
    session.page = page;
    sessions.set(session.id, session);
    try {
      await page.goto(startUrl);
    } catch (error) {
      session.error = String(error.message).split('\n')[0];
    }
    // The first navigation is the start URL itself.
    session.events = session.events.filter((event, index) => !(index === 0 && event.kind === 'navigate'));
    return present(session);
  }

  async function setMode(id, ownerId, mode) {
    if (!['record', 'pick'].includes(mode)) throw new AppError(400, 'VALIDATION', 'mode must be record or pick');
    const session = get(id, ownerId);
    session.mode = mode;
    if (session.status === 'recording') {
      await session.context.addInitScript({ content: `window.__urapMode = ${JSON.stringify(mode)};` }).catch(() => {});
      for (const page of session.context.pages()) await page.evaluate((value) => { window.__urapMode = value; }, mode).catch(() => {});
    }
    return present(session);
  }

  async function stop(id, ownerId) {
    const session = get(id, ownerId);
    if (session.status === 'recording') session.status = 'stopped';
    await session.browser.close().catch(() => {});
    if (session.status !== 'stopped') session.status = 'stopped';
    const result = present(session);
    setTimeout(() => sessions.delete(id), 60_000).unref?.();
    return result;
  }

  async function sweep() {
    for (const session of sessions.values()) {
      if (Date.now() - session.touched > IDLE_MS) {
        await session.browser.close().catch(() => {});
        sessions.delete(session.id);
      }
    }
  }
  const timer = setInterval(() => { sweep().catch(() => {}); }, 60_000);
  timer.unref?.();

  return {
    start,
    get: (id, ownerId) => present(get(id, ownerId)),
    page: (id) => sessions.get(id)?.page,
    setMode,
    stop,
    async closeAll() {
      clearInterval(timer);
      for (const session of sessions.values()) await session.browser.close().catch(() => {});
      sessions.clear();
    },
  };
}
