import { describe, expect, it } from 'vitest';
import { parseCodegen } from './codegenImport.js';

const SCRIPT = `import { test, expect } from '@playwright/test';

test('test', async ({ page }) => {
  await page.goto('https://demo.example.com/login');
  await page.getByLabel('Email').click();
  await page.getByLabel('Email').fill('ana@example.com');
  await page.getByPlaceholder('Password').fill('s3cret');
  await page.getByPlaceholder('Password').press('Enter');
  await page.getByRole('link', { name: 'Orders "open"' }).click();
  await page.locator('#status').selectOption('open');
  await page.getByTestId('row').nth(2).dblclick();
  await page.locator('//table//tr[2]').first().click({ button: 'right' });
  await page.frameLocator('iframe#pay').getByText('Pay now', { exact: true }).click();
  await expect(page.getByText('Saved')).toBeVisible();
  await page.goto('https://demo.example.com/report');
  await page.mouse.wheel(0, 300);
});`;

describe('Playwright codegen import', () => {
  it('maps codegen lines to designer activities', () => {
    const { steps, skipped } = parseCodegen(SCRIPT);
    expect(steps.map((step) => step.type)).toEqual([
      'browser_open', 'browser_click', 'browser_type', 'browser_type', 'browser_click', 'browser_select_option',
      'browser_click', 'browser_click', 'browser_click', 'browser_wait_for', 'browser_navigate',
    ]);
    expect(steps[0].config).toEqual({ url: 'https://demo.example.com/login', browser: 'chromium' });
    expect(steps[2].config).toEqual({ selector: 'Email', selectorType: 'label', text: 'ana@example.com' });
    expect(steps[3].config).toMatchObject({ selector: 'Password', selectorType: 'placeholder', pressEnter: true });
    expect(steps[4].config).toEqual({ selector: 'link[name="Orders \\"open\\""]', selectorType: 'role' });
    expect(steps[5].config).toEqual({ selector: '#status', selectorType: 'css', value: 'open' });
    expect(steps[6].config).toEqual({ selector: 'row', selectorType: 'testid', index: 2, clickCount: 2 });
    expect(steps[7].config).toEqual({ selector: '//table//tr[2]', selectorType: 'xpath', button: 'right' });
    expect(steps[8].config).toEqual({ frame: 'iframe#pay', selector: 'Pay now', selectorType: 'text', exact: true });
    expect(steps[9].config).toMatchObject({ selector: 'Saved', state: 'visible' });
    expect(skipped).toEqual(['await page.mouse.wheel(0, 300);']);
  });

  it('ignores empty input', () => {
    expect(parseCodegen('')).toEqual({ steps: [], skipped: [] });
  });
});
