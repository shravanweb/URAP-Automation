// Runs web UI activities with Playwright. One manager belongs to one job execution (worker or
// robot). Sessions are named so a workflow can drive more than one browser; the default session
// is "default". closeAll() must be called when the execution ends or suspends.
import fs from 'node:fs/promises';
import path from 'node:path';
import { AppError } from '../../lib/errors.js';
import { resolveInside } from '../../lib/paths.js';
import { describeSelector, toLocator } from './selectors.js';
import { runFlutterAttendance } from './flutterAttendance.js';

const ENGINES = ['chromium', 'firefox', 'webkit'];

export function checkUrl(value, allowedHosts = []) {
  let url;
  try {
    url = new URL(String(value));
  } catch {
    throw new AppError(400, 'INVALID_URL', `Not a valid URL: ${String(value).slice(0, 200)}`);
  }
  if (!['http:', 'https:'].includes(url.protocol)) throw new AppError(400, 'URL_NOT_ALLOWED', 'Browser activities only open http and https URLs');
  if (allowedHosts.length && !allowedHosts.some((host) => url.hostname === host || url.hostname.endsWith(`.${host}`))) {
    throw new AppError(400, 'URL_NOT_ALLOWED', `Host ${url.hostname} is not in BROWSER_ALLOWED_HOSTS`);
  }
  return url.toString();
}

function wrapPlaywrightError(error, what) {
  if (error instanceof AppError) return error;
  const timeout = error?.name === 'TimeoutError' || /Timeout \d+ms exceeded/.test(error?.message || '');
  const wrapped = new AppError(timeout ? 504 : 502, timeout ? 'ELEMENT_NOT_FOUND' : 'BROWSER_ERROR', `${what}: ${String(error?.message || error).split('\n')[0].slice(0, 400)}`);
  wrapped.retryable = timeout;
  return wrapped;
}

async function loadPlaywright() {
  try {
    return await import('playwright');
  } catch {
    throw new AppError(500, 'PLAYWRIGHT_MISSING', 'Playwright is not installed. Run npm install in backend, then npx playwright install chromium');
  }
}

export function createBrowserManager({ cfg = {}, storageRoot, playwright = null } = {}) {
  const sessions = new Map();
  const defaults = {
    headless: cfg.browserHeadless !== false,
    timeoutMs: cfg.browserTimeoutMs || 15000,
    allowedHosts: cfg.browserAllowedHosts || [],
  };

  function session(name = 'default') {
    const found = sessions.get(name || 'default');
    if (!found) throw new AppError(409, 'NO_BROWSER', `No open browser session "${name || 'default'}". Add an Open Browser activity first.`);
    return found;
  }

  async function open(config) {
    const name = config.session || 'default';
    if (sessions.has(name)) await close({ session: name });
    const engine = config.browser || 'chromium';
    if (!ENGINES.includes(engine)) throw new AppError(400, 'VALIDATION', `browser must be one of ${ENGINES.join(', ')}`);
    const url = config.url ? checkUrl(config.url, defaults.allowedHosts) : null;
    const pw = playwright || await loadPlaywright();
    let browser;
    try {
      browser = await pw[engine].launch({
        headless: config.headless ?? defaults.headless,
        executablePath: engine === 'chromium' && cfg.browserExecutablePath ? cfg.browserExecutablePath : undefined,
        channel: engine === 'chromium' && cfg.browserChannel ? cfg.browserChannel : undefined,
      });
    } catch (error) {
      const wrapped = new AppError(500, 'BROWSER_LAUNCH_FAILED', `Could not start ${engine}. Run "npx playwright install ${engine}" in backend. ${String(error.message).split('\n')[0]}`);
      throw wrapped;
    }
    const context = await browser.newContext({
      viewport: { width: Number(config.width) || 1366, height: Number(config.height) || 768 },
      ignoreHTTPSErrors: config.ignoreHttpsErrors === true,
      acceptDownloads: false,
    });
    const page = await context.newPage();
    page.setDefaultTimeout(Number(config.timeoutMs) || defaults.timeoutMs);
    sessions.set(name, { browser, context, page });
    if (url) {
      try {
        await page.goto(url, { waitUntil: config.waitUntil || 'load' });
      } catch (error) {
        throw wrapPlaywrightError(error, `Open ${url}`);
      }
    }
    return { session: name, browser: engine, url: page.url(), title: await page.title() };
  }

  async function navigate(config) {
    const { page } = session(config.session);
    try {
      if (config.action === 'back') await page.goBack();
      else if (config.action === 'forward') await page.goForward();
      else if (config.action === 'reload') await page.reload();
      else await page.goto(checkUrl(config.url, defaults.allowedHosts), { waitUntil: config.waitUntil || 'load' });
    } catch (error) {
      throw wrapPlaywrightError(error, 'Navigate');
    }
    return { url: page.url(), title: await page.title() };
  }

  async function withElement(config, what, work) {
    const { page } = session(config.session);
    const locator = toLocator(page, config);
    try {
      return await work(locator, page);
    } catch (error) {
      throw wrapPlaywrightError(error, `${what} ${describeSelector(config)}`);
    }
  }

  const click = (config) => withElement(config, 'Click', async (locator, page) => {
    const options = { button: config.button || 'left', clickCount: Number(config.clickCount) || 1, timeout: Number(config.timeoutMs) || undefined };
    if (config.modifiers?.length) options.modifiers = config.modifiers;
    await locator.click(options);
    if (config.waitForNavigation) await page.waitForLoadState(config.waitForNavigation === true ? 'load' : config.waitForNavigation);
    return { clicked: describeSelector(config), url: page.url() };
  });

  const typeInto = (config) => withElement(config, 'Type into', async (locator) => {
    const text = config.text == null ? '' : String(config.text);
    if (text) {
      if (config.clearBefore === false) await locator.pressSequentially(text, { delay: Number(config.delayMs) || 0 });
      else await locator.fill(text);
    }
    if (config.key) await locator.press(String(config.key));
    else if (config.pressEnter) await locator.press('Enter');
    // Typed text is not echoed back so passwords do not land in the execution log.
    return { typedCharacters: text.length, key: config.key || (config.pressEnter ? 'Enter' : null) };
  });

  const getText = (config) => withElement(config, 'Get text', async (locator, page) => {
    if (config.all) {
      const base = config.frame ? page.frameLocator(config.frame) : page;
      const many = toLocatorAll(base, config);
      const texts = (await many.allInnerTexts()).map((item) => item.trim());
      return { texts, count: texts.length, text: texts.join('\n') };
    }
    let text;
    if (config.attribute === 'value') text = await locator.inputValue();
    else if (config.attribute) text = await locator.getAttribute(String(config.attribute));
    else text = (await locator.innerText()).trim();
    return { text: text ?? '' };
  });

  const waitFor = async (config) => {
    const started = Date.now();
    const { page } = session(config.session);
    const state = config.state || 'visible';
    try {
      await toLocator(page, config).waitFor({ state, timeout: Number(config.timeoutMs) || defaults.timeoutMs });
      return { found: true, state, waitedMs: Date.now() - started };
    } catch (error) {
      if (config.failIfNotFound === false) return { found: false, state, waitedMs: Date.now() - started };
      throw wrapPlaywrightError(error, `Wait for ${describeSelector(config)} to be ${state}`);
    }
  };

  const selectOption = (config) => withElement(config, 'Select option', async (locator) => {
    let option;
    if (config.label != null && config.label !== '') option = { label: String(config.label) };
    else if (config.optionIndex != null && config.optionIndex !== '') option = { index: Number(config.optionIndex) };
    else option = String(config.value ?? '');
    const selected = await locator.selectOption(option);
    return { selected };
  });

  async function screenshot(config) {
    const { page } = session(config.session);
    if (!storageRoot) throw new AppError(500, 'NO_STORAGE', 'Screenshots need a storage folder');
    const relative = config.path || `screenshots/${new Date().toISOString().replace(/[:.]/g, '-')}.png`;
    if (!/\.png$/i.test(relative)) throw new AppError(400, 'VALIDATION', 'Screenshot path must end with .png');
    const file = resolveInside(storageRoot, relative);
    await fs.mkdir(path.dirname(file), { recursive: true });
    try {
      if (config.selector) await toLocator(page, config).screenshot({ path: file });
      else await page.screenshot({ path: file, fullPage: config.fullPage === true });
    } catch (error) {
      throw wrapPlaywrightError(error, 'Screenshot');
    }
    return { path: relative.replace(/\\/g, '/'), bytes: (await fs.stat(file)).size, url: page.url() };
  }

  async function extractTable(config) {
    const { page } = session(config.session);
    const maxRows = Math.min(Math.max(Number(config.maxRows) || 500, 1), 5000);
    const maxPages = Math.min(Math.max(Number(config.maxPages) || 1, 1), 50);
    const rows = [];
    let pages = 0;
    try {
      while (pages < maxPages && rows.length < maxRows) {
        pages += 1;
        const batch = config.mode === 'list' ? await extractList(page, config) : await extractHtmlTable(page, config);
        rows.push(...batch);
        if (!config.nextSelector || pages >= maxPages) break;
        const next = toLocator(page, { selector: config.nextSelector, selectorType: config.nextSelectorType || 'auto', frame: config.frame });
        if (!(await next.count()) || !(await next.isEnabled())) break;
        await next.click();
        await page.waitForLoadState(config.waitUntil || 'load');
        if (config.pageDelayMs) await page.waitForTimeout(Math.min(Number(config.pageDelayMs), 10000));
      }
    } catch (error) {
      throw wrapPlaywrightError(error, `Extract data ${describeSelector(config)}`);
    }
    const limited = rows.slice(0, maxRows);
    return { rows: limited, count: limited.length, pages, columns: limited.length ? Object.keys(limited[0]) : [] };
  }

  async function close(config = {}) {
    const name = config.session || 'default';
    const found = sessions.get(name);
    if (!found) return { closed: false, session: name };
    sessions.delete(name);
    await found.browser.close().catch(() => {});
    return { closed: true, session: name };
  }

  async function closeAll() {
    for (const name of [...sessions.keys()]) await close({ session: name });
  }

  async function flutterAttendance(config) {
    const { page } = session(config.session);
    if (config.url) checkUrl(config.url, defaults.allowedHosts);
    return runFlutterAttendance(page, config, { storageRoot, timeoutMs: Math.max(defaults.timeoutMs, 30000) });
  }

  const handlers = {
    browser_open: open,
    browser_navigate: navigate,
    browser_click: click,
    browser_type: typeInto,
    browser_get_text: getText,
    browser_extract_table: extractTable,
    browser_wait_for: waitFor,
    browser_screenshot: screenshot,
    browser_select_option: selectOption,
    browser_close: close,
    browser_flutter_attendance: flutterAttendance,
  };

  return {
    async run(type, config) {
      const handler = handlers[type];
      if (!handler) throw new AppError(400, 'UNKNOWN_STEP', `Unsupported browser activity ${type}`);
      return handler(config || {});
    },
    closeAll,
    sessionCount: () => sessions.size,
  };
}

function toLocatorAll(base, config) {
  // Same as toLocator but without .first() so every match is returned.
  const selector = String(config.selector).trim();
  let type = config.selectorType || 'auto';
  if (type === 'auto') type = /^\(?\/\//.test(selector) || selector.startsWith('/') ? 'xpath' : 'css';
  const exact = config.exact === true;
  if (type === 'css') return base.locator(`css=${selector}`);
  if (type === 'xpath') return base.locator(`xpath=${selector}`);
  if (type === 'text') return base.getByText(selector, { exact });
  if (type === 'role') return base.locator(`role=${selector}`);
  if (type === 'label') return base.getByLabel(selector, { exact });
  if (type === 'placeholder') return base.getByPlaceholder(selector, { exact });
  return base.getByTestId(selector);
}

async function extractHtmlTable(page, config) {
  const locator = toLocator(page, config);
  return locator.evaluate((table, options) => {
    const clean = (value) => String(value || '').replace(/\s+/g, ' ').trim();
    const element = table.tagName === 'TABLE' ? table : table.querySelector('table');
    if (!element) throw new Error('The selector did not match a <table>');
    const allRows = [...element.querySelectorAll('tr')];
    let headerCells = element.querySelectorAll('thead tr th');
    let bodyRows = allRows;
    if (!headerCells.length && allRows[0]?.querySelectorAll('th').length) headerCells = allRows[0].querySelectorAll('th');
    let headers = [...headerCells].map((cell, index) => clean(cell.innerText) || `Column${index + 1}`);
    if (headers.length) bodyRows = allRows.filter((row) => !row.querySelector('th') || row.querySelector('td'));
    else if (options.firstRowHeader !== false && allRows.length) {
      headers = [...allRows[0].children].map((cell, index) => clean(cell.innerText) || `Column${index + 1}`);
      bodyRows = allRows.slice(1);
    }
    return bodyRows.map((row) => {
      const cells = [...row.querySelectorAll('td')];
      const record = {};
      cells.forEach((cell, index) => { record[headers[index] || `Column${index + 1}`] = clean(cell.innerText); });
      return record;
    }).filter((record) => Object.keys(record).length);
  }, { firstRowHeader: config.firstRowHeader });
}

async function extractList(page, config) {
  if (!Array.isArray(config.fields) || !config.fields.length) throw new AppError(400, 'VALIDATION', 'List extraction needs fields: [{ name, selector, attribute }]');
  const base = config.frame ? page.frameLocator(config.frame) : page;
  const containers = toLocatorAll(base, config);
  return containers.evaluateAll((elements, fields) => elements.map((element) => {
    const record = {};
    for (const field of fields) {
      const target = field.selector ? element.querySelector(field.selector) : element;
      let value = null;
      if (target) {
        if (field.attribute) value = target.getAttribute(field.attribute);
        else value = String(target.innerText || target.textContent || '').replace(/\s+/g, ' ').trim();
      }
      record[field.name] = value;
    }
    return record;
  }), config.fields.map((field) => ({ name: String(field.name), selector: field.selector ? String(field.selector) : '', attribute: field.attribute ? String(field.attribute) : '' })));
}
