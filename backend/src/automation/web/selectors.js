// Element selectors shared by the worker, the robot agent, and the recorder.
// A selector is a string plus a selectorType:
//   css          #login button.primary
//   xpath        //form//button[text()="Sign in"]
//   text         Sign in                       (visible text, substring unless exact: true)
//   role         button[name="Sign in"]        (ARIA role with accessible name)
//   label        Email                         (form control by its <label>)
//   placeholder  name@example.com
//   testid       submit-order                  (data-testid)
//   auto         css, or xpath when it starts with / or (
import { AppError } from '../../lib/errors.js';

export const SELECTOR_TYPES = ['auto', 'css', 'xpath', 'text', 'role', 'label', 'placeholder', 'testid', 'image'];

export function normalizeSelector(config = {}) {
  const selector = typeof config.selector === 'string' ? config.selector.trim() : '';
  if (!selector) throw new AppError(400, 'VALIDATION', 'selector is required');
  let selectorType = config.selectorType || 'auto';
  if (!SELECTOR_TYPES.includes(selectorType)) throw new AppError(400, 'VALIDATION', `Unsupported selectorType ${selectorType}`);
  if (selectorType === 'auto') selectorType = /^\(?\/\//.test(selector) || selector.startsWith('/') ? 'xpath' : 'css';
  return { selector, selectorType };
}

/** Builds a Playwright locator on a page or frame. */
export function toLocator(page, config = {}) {
  const { selector, selectorType } = normalizeSelector(config);
  const root = config.frame ? page.frameLocator(config.frame) : page;
  const exact = config.exact === true;
  let locator;
  if (selectorType === 'image') throw new AppError(400, 'VALIDATION', 'Image targeting is only supported on Click');
  if (selectorType === 'css') locator = root.locator(`css=${selector}`);
  else if (selectorType === 'xpath') locator = root.locator(`xpath=${selector}`);
  else if (selectorType === 'text') locator = root.getByText(selector, { exact });
  else if (selectorType === 'role') locator = root.locator(`role=${selector}`);
  else if (selectorType === 'label') locator = root.getByLabel(selector, { exact });
  else if (selectorType === 'placeholder') locator = root.getByPlaceholder(selector, { exact });
  else locator = root.getByTestId(selector);
  if (Number.isInteger(config.index)) return locator.nth(config.index);
  return locator.first();
}

/** Readable form used in step names and logs. */
export function describeSelector(config = {}) {
  try {
    const { selector, selectorType } = normalizeSelector(config);
    return `${selectorType}:${selector}`.slice(0, 120);
  } catch {
    return '(no selector)';
  }
}
