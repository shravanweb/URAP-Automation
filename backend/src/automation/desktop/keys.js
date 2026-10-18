// Pure helpers for the Windows desktop driver. Kept separate so they can be unit tested on any OS.
import { AppError } from '../../lib/errors.js';

// Windows virtual-key codes.
const VK = {
  ctrl: 0x11, control: 0x11, shift: 0x10, alt: 0x12, menu: 0x12, win: 0x5b, windows: 0x5b, meta: 0x5b,
  enter: 0x0d, return: 0x0d, tab: 0x09, esc: 0x1b, escape: 0x1b, space: 0x20, backspace: 0x08,
  delete: 0x2e, del: 0x2e, insert: 0x2d, home: 0x24, end: 0x23, pageup: 0x21, pagedown: 0x22,
  up: 0x26, down: 0x28, left: 0x25, right: 0x27, printscreen: 0x2c, capslock: 0x14,
};
const MODIFIERS = new Set([0x11, 0x10, 0x12, 0x5b]);

/**
 * Parses "Ctrl+Shift+S", "Alt+F4", "Win+R", "Enter" into virtual-key codes. Modifiers come
 * first and are released last by the driver.
 */
export function parseHotkey(value) {
  const text = String(value || '').trim();
  if (!text) throw new AppError(400, 'VALIDATION', 'keys is required, for example Ctrl+S');
  const parts = text.split('+').map((part) => part.trim()).filter(Boolean);
  if (!parts.length || parts.length > 4) throw new AppError(400, 'VALIDATION', 'A hotkey has one to four keys joined with +');
  const codes = parts.map((part) => {
    const lower = part.toLowerCase();
    if (VK[lower] !== undefined) return VK[lower];
    const fn = /^f([1-9]|1[0-9]|2[0-4])$/.exec(lower);
    if (fn) return 0x6f + Number(fn[1]);
    if (/^[a-z0-9]$/.test(lower)) return lower.toUpperCase().charCodeAt(0);
    throw new AppError(400, 'VALIDATION', `Unknown key "${part}" in hotkey ${text}`);
  });
  const modifiers = codes.filter((code) => MODIFIERS.has(code));
  const keys = codes.filter((code) => !MODIFIERS.has(code));
  if (!keys.length && modifiers.length > 1) throw new AppError(400, 'VALIDATION', 'A hotkey needs a key besides modifiers');
  return { modifiers, keys: keys.length ? keys : modifiers.splice(-1), text };
}

/** Escapes text for System.Windows.Forms.SendKeys, where + ^ % ~ ( ) { } [ ] are special. */
export function escapeSendKeys(text) {
  return String(text ?? '').replace(/[+^%~(){}[\]]/g, (char) => `{${char}}`).replace(/\r?\n/g, '{ENTER}').replace(/\t/g, '{TAB}');
}

const SELECTOR_KEYS = ['name', 'automationId', 'className', 'controlType', 'index'];
const CONTROL_TYPES = ['Button', 'Calendar', 'CheckBox', 'ComboBox', 'Custom', 'DataGrid', 'DataItem', 'Document', 'Edit', 'Group', 'Header', 'HeaderItem', 'Hyperlink', 'Image', 'List', 'ListItem', 'Menu', 'MenuBar', 'MenuItem', 'Pane', 'ProgressBar', 'RadioButton', 'ScrollBar', 'Separator', 'Slider', 'Spinner', 'SplitButton', 'StatusBar', 'Tab', 'TabItem', 'Table', 'Text', 'Thumb', 'TitleBar', 'ToolBar', 'ToolTip', 'Tree', 'TreeItem', 'Window'];

/**
 * A desktop selector names a UI Automation element inside the attached window:
 * { name, automationId, className, controlType, index }. At least one property is required.
 */
export function normalizeDesktopSelector(selector) {
  if (!selector || typeof selector !== 'object') return null;
  const clean = {};
  for (const key of SELECTOR_KEYS) {
    if (selector[key] !== undefined && selector[key] !== '' && selector[key] !== null) clean[key] = key === 'index' ? Number(selector[key]) : String(selector[key]);
  }
  if (clean.controlType && !CONTROL_TYPES.includes(clean.controlType)) {
    throw new AppError(400, 'VALIDATION', `Unknown controlType ${clean.controlType}`);
  }
  if (!clean.name && !clean.automationId && !clean.className && !clean.controlType) {
    throw new AppError(400, 'VALIDATION', 'A desktop selector needs name, automationId, className, or controlType');
  }
  return clean;
}

export { CONTROL_TYPES };
