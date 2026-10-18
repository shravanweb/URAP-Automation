// Desktop UI automation adapter. Workflow steps call this interface; a driver does the work:
//   windows  PowerShell + .NET UI Automation helper (windows/uia-helper.ps1), Windows only
//   mock     records calls and returns canned results (tests, demos on other systems)
//   none     every call fails with DESKTOP_UNSUPPORTED
// DESKTOP_DRIVER=auto (default) picks windows on Windows and none elsewhere.
//
// Driver contract: driver.execute(command, payload) resolves to an object or rejects. Commands:
//   open_app { path, args, workingDirectory, windowTitle, match, timeoutMs }
//   attach   { title, processName, match, timeoutMs }
//   click    { window, selector | x,y, button, double, timeoutMs }
//   type     { window, selector, text, sendKeys, clearBefore, method, timeoutMs }
//   hotkey   { window, modifiers[], keys[] }
//   get_text { window, selector, timeoutMs }
//   close    { window }
import { AppError } from '../../lib/errors.js';
import { escapeSendKeys, normalizeDesktopSelector, parseHotkey } from './keys.js';
import { createWindowsDriver } from './windowsDriver.js';

const MATCH = ['exact', 'contains', 'regex'];

export function createMockDesktopDriver(responses = {}) {
  const calls = [];
  return {
    name: 'mock',
    calls,
    async execute(command, payload) {
      calls.push({ command, payload });
      const response = typeof responses[command] === 'function' ? responses[command](payload) : responses[command];
      if (response instanceof Error) throw response;
      if (response !== undefined) return response;
      if (command === 'open_app' || command === 'attach') return { handle: 4242, title: payload.title || payload.windowTitle || 'Mock window', processId: 1234, processName: 'mock' };
      if (command === 'get_text') return { text: 'mock text' };
      return { ok: true };
    },
  };
}

function unsupportedDriver(reason) {
  return {
    name: 'none',
    async execute() {
      throw new AppError(501, 'DESKTOP_UNSUPPORTED', reason);
    },
  };
}

export function pickDesktopDriver(cfg = {}, platform = process.platform) {
  const choice = cfg.desktopDriver || 'auto';
  if (choice === 'mock') return createMockDesktopDriver();
  if (choice === 'windows' || (choice === 'auto' && platform === 'win32')) {
    if (platform !== 'win32') return unsupportedDriver('DESKTOP_DRIVER=windows only works on Windows');
    return createWindowsDriver({ timeoutMs: cfg.desktopCommandTimeoutMs, powershell: cfg.desktopPowershell });
  }
  return unsupportedDriver('Desktop activities need Windows. Run this workflow on a Windows worker or a Windows robot (npm run robot).');
}

function timeout(config, fallback = 10000) {
  const value = Number(config.timeoutMs);
  return Number.isFinite(value) && value > 0 ? Math.min(value, 120000) : fallback;
}

export function createDesktopAdapter({ driver }) {
  let window = null; // { handle, title, processId }

  function requireWindow(config) {
    if (config.window?.handle || config.window?.title) return config.window;
    if (!window) throw new AppError(409, 'NO_WINDOW', 'No window is attached. Add an Open Application or Attach Window activity first.');
    return window;
  }

  function selectorOrPoint(config) {
    const selector = normalizeDesktopSelector(config.selector);
    const hasPoint = Number.isFinite(Number(config.x)) && Number.isFinite(Number(config.y)) && config.x !== '' && config.y !== '';
    if (!selector && !hasPoint) throw new AppError(400, 'VALIDATION', 'Give a selector or x and y coordinates');
    return selector ? { selector } : { x: Number(config.x), y: Number(config.y) };
  }

  const handlers = {
    async desktop_open_app(config) {
      if (!config.path) throw new AppError(400, 'VALIDATION', 'path is required (for example notepad.exe)');
      const result = await driver.execute('open_app', {
        path: String(config.path),
        args: Array.isArray(config.args) ? config.args.map(String) : (config.args ? [String(config.args)] : []),
        workingDirectory: config.workingDirectory || null,
        windowTitle: config.windowTitle || null,
        match: MATCH.includes(config.match) ? config.match : 'contains',
        timeoutMs: timeout(config, 20000),
      });
      window = { handle: result.handle, title: result.title, processId: result.processId };
      return { window, processName: result.processName || null };
    },
    async desktop_attach_window(config) {
      if (!config.title && !config.processName) throw new AppError(400, 'VALIDATION', 'title or processName is required');
      const match = MATCH.includes(config.match) ? config.match : 'contains';
      if (match === 'regex' && config.title) {
        try { new RegExp(config.title); } catch { throw new AppError(400, 'VALIDATION', 'title is not a valid regular expression'); }
      }
      const result = await driver.execute('attach', { title: config.title || null, processName: config.processName || null, match, timeoutMs: timeout(config) });
      window = { handle: result.handle, title: result.title, processId: result.processId };
      return { window };
    },
    async desktop_click(config) {
      const target = selectorOrPoint(config);
      const button = ['left', 'right', 'middle'].includes(config.button) ? config.button : 'left';
      await driver.execute('click', { window: requireWindow(config), ...target, button, double: config.double === true, timeoutMs: timeout(config) });
      return { clicked: target.selector || { x: target.x, y: target.y }, button, double: config.double === true };
    },
    async desktop_type(config) {
      const text = config.text == null ? '' : String(config.text);
      const selector = normalizeDesktopSelector(config.selector);
      const method = config.method === 'value' ? 'value' : 'keys';
      await driver.execute('type', {
        window: requireWindow(config),
        selector,
        text,
        sendKeys: escapeSendKeys(text),
        clearBefore: config.clearBefore !== false,
        method,
        timeoutMs: timeout(config),
      });
      return { typedCharacters: text.length, method };
    },
    async desktop_hotkey(config) {
      const parsed = parseHotkey(config.keys);
      await driver.execute('hotkey', { window: requireWindow(config), modifiers: parsed.modifiers, keys: parsed.keys });
      return { keys: parsed.text };
    },
    async desktop_get_text(config) {
      const selector = normalizeDesktopSelector(config.selector);
      if (!selector) throw new AppError(400, 'VALIDATION', 'selector is required');
      const result = await driver.execute('get_text', { window: requireWindow(config), selector, timeoutMs: timeout(config) });
      return { text: String(result.text ?? '') };
    },
    async desktop_close_window(config) {
      const target = requireWindow(config);
      await driver.execute('close', { window: target });
      if (window && target.handle === window.handle) window = null;
      return { closed: true };
    },
  };

  return {
    driverName: driver.name,
    async run(type, config) {
      const handler = handlers[type];
      if (!handler) throw new AppError(400, 'UNKNOWN_STEP', `Unsupported desktop activity ${type}`);
      return handler(config || {});
    },
    currentWindow: () => window,
  };
}
