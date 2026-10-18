// Converts a script recorded with Playwright codegen (npx playwright codegen <url>, JavaScript or
// TypeScript target) into designer activities. Lines it does not understand are reported back
// so nothing is silently dropped.

const STRING = String.raw`'(?:[^'\\]|\\.)*'|"(?:[^"\\]|\\.)*"|\x60(?:[^\x60\\]|\\.)*\x60`;

function unquote(text) {
  const value = String(text || '').trim();
  if (!value) return '';
  const quote = value[0];
  if (!["'", '"', '`'].includes(quote)) return value;
  return value.slice(1, -1).replace(/\\(.)/g, '$1');
}

/** Splits a.b(x).c(y, z) into [{ name, args }] honouring quotes and nesting. */
function calls(chain) {
  const result = [];
  let index = 0;
  while (index < chain.length) {
    const match = /^\.?\s*([A-Za-z_$][\w$]*)\s*\(/.exec(chain.slice(index));
    if (!match) break;
    index += match[0].length;
    let depth = 1;
    let start = index;
    let quote = null;
    while (index < chain.length && depth > 0) {
      const char = chain[index];
      if (quote) {
        if (char === '\\') index += 1;
        else if (char === quote) quote = null;
      } else if (char === "'" || char === '"' || char === '`') quote = char;
      else if (char === '(' || char === '{' || char === '[') depth += 1;
      else if (char === ')' || char === '}' || char === ']') depth -= 1;
      index += 1;
    }
    result.push({ name: match[1], args: chain.slice(start, index - 1) });
  }
  return result;
}

function splitArgs(args) {
  const parts = [];
  let depth = 0;
  let quote = null;
  let current = '';
  for (let i = 0; i < args.length; i += 1) {
    const char = args[i];
    if (quote) {
      current += char;
      if (char === '\\') { current += args[i + 1] || ''; i += 1; } else if (char === quote) quote = null;
      continue;
    }
    if (char === "'" || char === '"' || char === '`') quote = char;
    if ('({['.includes(char)) depth += 1;
    if (')}]'.includes(char)) depth -= 1;
    if (char === ',' && depth === 0) { parts.push(current.trim()); current = ''; continue; }
    current += char;
  }
  if (current.trim()) parts.push(current.trim());
  return parts;
}

function option(objectText, key) {
  const match = new RegExp(`${key}\\s*:\\s*(${STRING}|true|false|\\d+)`).exec(objectText || '');
  if (!match) return undefined;
  if (match[1] === 'true') return true;
  if (match[1] === 'false') return false;
  if (/^\d+$/.test(match[1])) return Number(match[1]);
  return unquote(match[1]);
}

/** Turns the locator part of a chain into { selector, selectorType, exact?, index?, frame? }. */
function locatorFrom(list) {
  const target = {};
  for (const call of list) {
    const [first, second] = splitArgs(call.args);
    if (call.name === 'frameLocator') target.frame = unquote(first);
    else if (call.name === 'locator') {
      const value = unquote(first);
      if (value.startsWith('xpath=')) Object.assign(target, { selector: value.slice(6), selectorType: 'xpath' });
      else if (value.startsWith('text=')) Object.assign(target, { selector: value.slice(5).replace(/^"|"$/g, ''), selectorType: 'text' });
      else if (value.startsWith('css=')) Object.assign(target, { selector: value.slice(4), selectorType: 'css' });
      else if (value.startsWith('//') || value.startsWith('(//')) Object.assign(target, { selector: value, selectorType: 'xpath' });
      else if (target.selector && target.selectorType === 'css') target.selector = `${target.selector} ${value}`;
      else Object.assign(target, { selector: value, selectorType: 'css' });
    } else if (call.name === 'getByRole') {
      const role = unquote(first);
      const name = option(second, 'name');
      Object.assign(target, { selector: name !== undefined ? `${role}[name="${String(name).replace(/"/g, '\\"')}"]` : role, selectorType: 'role' });
    } else if (['getByText', 'getByLabel', 'getByPlaceholder', 'getByTestId', 'getByTitle', 'getByAltText'].includes(call.name)) {
      const type = { getByText: 'text', getByLabel: 'label', getByPlaceholder: 'placeholder', getByTestId: 'testid', getByTitle: 'css', getByAltText: 'css' }[call.name];
      const value = unquote(first);
      const selector = call.name === 'getByTitle' ? `[title="${value}"]` : call.name === 'getByAltText' ? `[alt="${value}"]` : value;
      Object.assign(target, { selector, selectorType: type });
      if (option(second, 'exact') === true) target.exact = true;
    } else if (call.name === 'first') target.index = 0;
    else if (call.name === 'last') target.index = -1;
    else if (call.name === 'nth') target.index = Number(first);
    else if (call.name === 'filter') {
      const hasText = option(first, 'hasText');
      if (hasText && target.selectorType === 'css') target.selector = `${target.selector}:has-text("${hasText}")`;
    }
  }
  if (target.index === -1 || target.index === 0) delete target.index;
  return target;
}

const ACTIONS = new Set(['click', 'dblclick', 'fill', 'press', 'type', 'pressSequentially', 'selectOption', 'check', 'uncheck', 'setInputFiles', 'hover']);

export function parseCodegen(source) {
  const steps = [];
  const skipped = [];
  let opened = false;
  const lines = String(source || '').split(/\r?\n/);
  for (const raw of lines) {
    const line = raw.trim().replace(/;$/, '');
    if (!line || line.startsWith('//') || line.startsWith('import ') || line.startsWith('const {') || /^test\(|^\}\)|^\}|^const (browser|context|page\d*) = await|^await (context|browser)\.close|^\(async|^const \w+Promise = |^const \w+ = await \w+Promise/.test(line)) continue;
    const expectMatch = /^await expect\((page\d*\..*)\)\.(not\.)?(toBeVisible|toBeHidden|toHaveText|toContainText)\((.*)\)$/.exec(line);
    if (expectMatch) {
      const chain = calls(expectMatch[1].replace(/^page\d*/, ''));
      const target = locatorFrom(chain);
      if (target.selector) {
        const hidden = (expectMatch[3] === 'toBeHidden') !== Boolean(expectMatch[2]);
        steps.push({ type: 'browser_wait_for', name: `Wait for ${target.selector}`.slice(0, 80), config: { ...target, state: hidden ? 'hidden' : 'visible' } });
        continue;
      }
    }
    const match = /^await (page\d*)\.(.*)$/.exec(line);
    if (!match) { skipped.push(raw.trim()); continue; }
    const chain = calls(`.${match[2]}`);
    if (!chain.length) { skipped.push(raw.trim()); continue; }
    const head = chain[0];
    if (head.name === 'goto') {
      const url = unquote(splitArgs(head.args)[0]);
      steps.push(opened ? { type: 'browser_navigate', name: 'Navigate To', config: { url } } : { type: 'browser_open', name: 'Open Browser', config: { url, browser: 'chromium' } });
      opened = true;
      continue;
    }
    if (['goBack', 'goForward', 'reload'].includes(head.name)) {
      steps.push({ type: 'browser_navigate', name: head.name, config: { action: { goBack: 'back', goForward: 'forward', reload: 'reload' }[head.name] } });
      continue;
    }
    if (head.name === 'close') { steps.push({ type: 'browser_close', name: 'Close Browser', config: {} }); continue; }
    if (head.name === 'screenshot') { steps.push({ type: 'browser_screenshot', name: 'Take Screenshot', config: { fullPage: option(head.args, 'fullPage') === true } }); continue; }
    const actionIndex = chain.findIndex((call) => ACTIONS.has(call.name));
    if (actionIndex < 0) { skipped.push(raw.trim()); continue; }
    const action = chain[actionIndex];
    const target = locatorFrom(chain.slice(0, actionIndex));
    if (!target.selector) { skipped.push(raw.trim()); continue; }
    const args = splitArgs(action.args);
    const label = target.selector.length > 40 ? `${target.selector.slice(0, 40)}…` : target.selector;
    if (action.name === 'click' || action.name === 'check' || action.name === 'uncheck') {
      const config = { ...target };
      const button = option(args[0], 'button');
      if (button) config.button = button;
      steps.push({ type: 'browser_click', name: `Click ${label}`, config });
    } else if (action.name === 'dblclick') {
      steps.push({ type: 'browser_click', name: `Double click ${label}`, config: { ...target, clickCount: 2 } });
    } else if (action.name === 'fill' || action.name === 'type' || action.name === 'pressSequentially') {
      const text = unquote(args[0]);
      const previous = steps[steps.length - 1];
      if (previous?.type === 'browser_type' && previous.config.selector === target.selector && !previous.config.key) previous.config.text = text;
      else steps.push({ type: 'browser_type', name: `Type into ${label}`, config: { ...target, text, ...(action.name === 'fill' ? {} : { clearBefore: false }) } });
    } else if (action.name === 'press') {
      const key = unquote(args[0]);
      const previous = steps[steps.length - 1];
      if (key === 'Enter' && previous?.type === 'browser_type' && previous.config.selector === target.selector) previous.config.pressEnter = true;
      else steps.push({ type: 'browser_type', name: `Press ${key}`, config: { ...target, key } });
    } else if (action.name === 'selectOption') {
      const value = args[0]?.startsWith('{') ? option(args[0], 'label') ?? option(args[0], 'value') : unquote(args[0]);
      const byLabel = args[0]?.startsWith('{') && option(args[0], 'label') !== undefined;
      steps.push({ type: 'browser_select_option', name: `Select ${value}`, config: { ...target, ...(byLabel ? { label: value } : { value }) } });
    } else if (action.name === 'hover') {
      steps.push({ type: 'browser_wait_for', name: `Wait for ${label}`, config: { ...target, state: 'visible' } });
    } else {
      skipped.push(raw.trim());
    }
  }
  return { steps, skipped };
}
