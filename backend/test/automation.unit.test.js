// Unit tests for the UiPath-style activity modules: selectors, recorder conversion, desktop
// adapter and Windows driver (mocked), document extraction, database and Google Sheets
// connectors, Action Center form rules, robot package checks, and workflow validation.
import { EventEmitter } from 'node:events';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import http from 'node:http';
import crypto from 'node:crypto';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { normalizeSelector, toLocator, describeSelector } from '../src/automation/web/selectors.js';
import { checkUrl } from '../src/automation/web/browserManager.js';
import { eventsToSteps, stepsToDefinition } from '../src/automation/web/recorder.js';
import { parseHotkey, escapeSendKeys, normalizeDesktopSelector } from '../src/automation/desktop/keys.js';
import { createDesktopAdapter, createMockDesktopDriver, pickDesktopDriver } from '../src/automation/desktop/adapter.js';
import { buildPowershellArgs, parseHelperOutput, createWindowsDriver, HELPER_SCRIPT } from '../src/automation/desktop/windowsDriver.js';
import { extractFields, parseAmount, parseDate } from '../src/automation/documents/extraction.js';
import { extractPdfText } from '../src/automation/documents/pdf.js';
import { checkCustomQuery, runDatabaseStep, buildPostgresOperation } from '../src/connectors/database.js';
import { createSheetsClient, rowsToValues, valuesToRows } from '../src/connectors/googleSheets.js';
import { normalizeFormSchema, validateFormData, canCompleteTask } from '../src/services/taskService.js';
import { packageNeedsExecution, unsupportedSteps } from '../src/robot/robotRuntime.js';
import { validateDefinition } from '../src/workflow/validate.js';
import { executeWorkflow } from '../src/workflow/engine.js';

const fixtures = path.join(path.dirname(fileURLToPath(import.meta.url)), 'fixtures');
const INVOICE_TEXT = fs.readFileSync(path.join(fixtures, 'make-fixtures.mjs'), 'utf8').match(/INVOICE_LINES = \[([\s\S]*?)\];/)[1]
  .split('\n').map((line) => line.trim().replace(/^'|',?$/g, '')).filter(Boolean).join('\n');

function wf(steps) {
  return { schemaVersion: '1.0', retryPolicy: { maxAttempts: 1, backoffSeconds: 0 }, steps };
}

describe('web selectors and recorder', () => {
  it('normalizes selectors and builds Playwright locators', () => {
    expect(normalizeSelector({ selector: '//button[1]' })).toEqual({ selector: '//button[1]', selectorType: 'xpath' });
    expect(normalizeSelector({ selector: '#save' })).toEqual({ selector: '#save', selectorType: 'css' });
    expect(() => normalizeSelector({ selector: '' })).toThrow(/selector is required/);
    expect(() => normalizeSelector({ selector: 'x', selectorType: 'magic' })).toThrow(/Unsupported/);
    const calls = [];
    const locator = { first: () => ({ kind: 'first' }), nth: (n) => ({ kind: `nth${n}` }) };
    const page = new Proxy({}, { get: (_t, name) => (...args) => { calls.push([name, ...args]); return name === 'frameLocator' ? page : locator; } });
    expect(toLocator(page, { selector: 'Save', selectorType: 'text', exact: true })).toEqual({ kind: 'first' });
    expect(toLocator(page, { selector: 'button[name="Go"]', selectorType: 'role', index: 2 })).toEqual({ kind: 'nth2' });
    toLocator(page, { selector: '#q', frame: 'iframe#main' });
    expect(calls).toEqual([
      ['getByText', 'Save', { exact: true }],
      ['locator', 'role=button[name="Go"]'],
      ['frameLocator', 'iframe#main'],
      ['locator', 'css=#q'],
    ]);
    expect(describeSelector({ selector: 'Email', selectorType: 'label' })).toBe('label:Email');
  });

  it('allows only http(s) URLs and the configured hosts', () => {
    expect(checkUrl('https://example.com/a', [])).toBe('https://example.com/a');
    expect(() => checkUrl('file:///etc/passwd', [])).toThrow();
    expect(() => checkUrl('javascript:alert(1)', [])).toThrow();
    expect(() => checkUrl('https://evil.test/', ['example.com'])).toThrow();
    expect(checkUrl('https://app.example.com/', ['example.com'])).toBeTruthy();
  });

  it('turns recorded events into steps and a valid workflow', () => {
    const el = (selector, selectorType, text) => ({ text, candidates: [{ selector, selectorType }] });
    const steps = eventsToSteps([
      { kind: 'fill', element: el('Email', 'label'), value: 'a' },
      { kind: 'fill', element: el('Email', 'label'), value: 'ana@example.com' },
      { kind: 'fill', element: el('#pw', 'css'), value: 'secret', secret: true },
      { kind: 'enter', element: el('#pw', 'css'), value: 'secret', secret: true },
      { kind: 'navigate', url: 'http://x.test/home', afterAction: true },
      { kind: 'select', element: el('#country', 'css'), value: 'IN' },
      { kind: 'click', element: el('button[name="Save"]', 'role', 'Save') },
      { kind: 'navigate', url: 'http://x.test/other' },
    ], { startUrl: 'http://x.test/' });
    expect(steps.map((step) => step.type)).toEqual(['browser_open', 'browser_type', 'browser_type', 'browser_select_option', 'browser_click', 'browser_navigate']);
    expect(steps[1].config).toEqual({ selector: 'Email', selectorType: 'label', text: 'ana@example.com' });
    expect(steps[2].config).toMatchObject({ credentialId: '', credentialField: 'password', pressEnter: true });
    expect(JSON.stringify(steps)).not.toContain('secret');
    const definition = stepsToDefinition(steps);
    expect(definition.steps[0].next).toBe('open_1');
    expect(definition.steps.at(-2).type).toBe('browser_close');
    expect(validateDefinition(definition).errors).toEqual([]);
  });
});

describe('desktop automation adapter (mock driver)', () => {
  it('parses hotkeys and escapes SendKeys text', () => {
    expect(parseHotkey('Ctrl+Shift+S')).toEqual({ modifiers: [0x11, 0x10], keys: [0x53], text: 'Ctrl+Shift+S' });
    expect(parseHotkey('Alt+F4').keys).toEqual([0x73]);
    expect(parseHotkey('Enter')).toEqual({ modifiers: [], keys: [0x0d], text: 'Enter' });
    expect(() => parseHotkey('Ctrl+Bogus')).toThrow(/Unknown key/);
    expect(escapeSendKeys('a+b (50%) {x}\nnext')).toBe('a{+}b {(}50{%}{)} {{}x{}}{ENTER}next');
    expect(normalizeDesktopSelector({ name: 'Save', controlType: 'Button', index: '1' })).toEqual({ name: 'Save', controlType: 'Button', index: 1 });
    expect(() => normalizeDesktopSelector({ controlType: 'Widget' })).toThrow(/Unknown controlType/);
  });

  it('drives open, click, type, hotkey, read, and close through the driver interface', async () => {
    const driver = createMockDesktopDriver({ get_text: { text: '42' } });
    const desktop = createDesktopAdapter({ driver });
    await expect(desktop.run('desktop_click', { selector: { name: 'OK' } })).rejects.toMatchObject({ code: 'NO_WINDOW' });
    const opened = await desktop.run('desktop_open_app', { path: 'calc.exe', windowTitle: 'Calculator' });
    expect(opened.window).toEqual({ handle: 4242, title: 'Calculator', processId: 1234 });
    await desktop.run('desktop_click', { selector: { automationId: 'num4Button' }, double: true });
    await desktop.run('desktop_click', { x: 10, y: 20, button: 'right' });
    expect(await desktop.run('desktop_type', { selector: { controlType: 'Edit' }, text: '1+1' })).toEqual({ typedCharacters: 3, method: 'keys' });
    expect(await desktop.run('desktop_hotkey', { keys: 'Ctrl+C' })).toEqual({ keys: 'Ctrl+C' });
    expect(await desktop.run('desktop_get_text', { selector: { automationId: 'CalculatorResults' } })).toEqual({ text: '42' });
    expect(await desktop.run('desktop_close_window', {})).toEqual({ closed: true });
    expect(driver.calls.map((call) => call.command)).toEqual(['open_app', 'click', 'click', 'type', 'hotkey', 'get_text', 'close']);
    expect(driver.calls[1].payload).toMatchObject({ window: { handle: 4242 }, selector: { automationId: 'num4Button' }, double: true, button: 'left' });
    expect(driver.calls[2].payload).toMatchObject({ x: 10, y: 20, button: 'right' });
    expect(driver.calls[3].payload).toMatchObject({ sendKeys: '1{+}1', clearBefore: true });
    expect(driver.calls[4].payload).toMatchObject({ modifiers: [0x11], keys: [0x43] });
    await expect(desktop.run('desktop_get_text', { selector: { name: 'Result' } })).rejects.toMatchObject({ code: 'NO_WINDOW' });
    await expect(desktop.run('desktop_get_text', {})).rejects.toMatchObject({ code: 'VALIDATION' });
  });

  it('picks no driver off Windows and explains why', async () => {
    const driver = pickDesktopDriver({ desktopDriver: 'auto' }, 'linux');
    expect(driver.name).toBe('none');
    await expect(driver.execute('attach', {})).rejects.toMatchObject({ code: 'DESKTOP_UNSUPPORTED', status: 501 });
    expect(pickDesktopDriver({ desktopDriver: 'auto' }, 'win32').name).toBe('windows');
    expect(pickDesktopDriver({ desktopDriver: 'mock' }, 'linux').name).toBe('mock');
  });

  it('builds PowerShell arguments and maps helper output to errors', async () => {
    const args = buildPowershellArgs('click', { window: { handle: 1 }, selector: { name: 'OK' } });
    expect(args.slice(0, 6)).toEqual(['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File', HELPER_SCRIPT]);
    const payload = JSON.parse(Buffer.from(args[args.indexOf('-Payload') + 1], 'base64').toString('utf8'));
    expect(payload).toEqual({ command: 'click', window: { handle: 1 }, selector: { name: 'OK' } });
    expect(parseHelperOutput('noise\n{"ok":true,"result":{"text":"hi"}}\n')).toEqual({ text: 'hi' });
    expect(() => parseHelperOutput('{"ok":false,"code":"ELEMENT_NOT_FOUND","message":"No element"}')).toThrow(/No element/);
    try { parseHelperOutput('{"ok":false,"code":"ELEMENT_NOT_FOUND","message":"x"}'); } catch (error) { expect(error.retryable).toBe(true); }
    expect(() => parseHelperOutput('', 'boom', 1)).toThrow();

    const spawned = [];
    const spawnImpl = (command, argv) => {
      spawned.push([command, argv]);
      const child = new EventEmitter();
      child.stdout = new EventEmitter();
      child.stderr = new EventEmitter();
      child.kill = () => {};
      setImmediate(() => {
        child.stdout.emit('data', '{"ok":true,"result":{"handle":7,"title":"Untitled - Notepad","processId":9}}\n');
        child.emit('close', 0);
      });
      return child;
    };
    const driver = createWindowsDriver({ spawnImpl, powershell: 'powershell.exe' });
    const desktop = createDesktopAdapter({ driver });
    expect((await desktop.run('desktop_open_app', { path: 'notepad.exe' })).window.handle).toBe(7);
    expect(spawned[0][0]).toBe('powershell.exe');
  });

  const pwsh = ['/workspace/tools/pwsh/pwsh', 'pwsh'].find((candidate) => spawnSync(candidate, ['-v']).status === 0);
  it.skipIf(!pwsh)('parses and answers the real uia-helper.ps1 with pwsh (no UI Automation on this OS)', () => {
    const call = (command) => {
      const args = buildPowershellArgs(command, {});
      const result = spawnSync(pwsh, args, { env: { ...process.env, URAP_UIA_SKIP_ASSEMBLIES: '1' }, encoding: 'utf8' });
      return parseHelperOutput(result.stdout, result.stderr, result.status);
    };
    expect(call('ping')).toHaveProperty('powershell');
    expect(() => call('explode')).toThrow(/explode/);
  });
});

describe('document understanding', () => {
  it('parses amounts and dates in common formats', () => {
    expect(parseAmount('1,23,456.50')).toBe(123456.5);
    expect(parseAmount('1.234,56')).toBe(1234.56);
    expect(parseAmount('Rs 11,800.00')).toBe(11800);
    expect(parseDate('15/09/2026')).toBe('2026-09-15');
    expect(parseDate('09/15/2026', 'MDY')).toBe('2026-09-15');
    expect(parseDate('5 Sep 2026')).toBe('2026-09-05');
    expect(parseDate('31/02/2026')).toBe(null);
  });

  it('extracts invoice fields with confidence scores', () => {
    const result = extractFields(INVOICE_TEXT, { documentType: 'invoice', ocrConfidence: 99 });
    expect(result.values).toMatchObject({
      invoiceNumber: 'INV-2026-0042', invoiceDate: '2026-09-15', dueDate: '2026-10-15', vendorGstin: '29ABCDE1234F1Z5',
      subtotal: 10000, taxAmount: 1800, totalAmount: 11800, currency: 'INR', vendorName: 'ACME TRADERS PVT LTD',
    });
    expect(result.missing).toEqual([]);
    expect(result.needsReview).toBe(false);
    expect(result.fields.invoiceNumber.confidence).toBeGreaterThan(0.85);
    expect(result.fields.vendorName.confidence).toBeLessThan(0.8);
    const blurry = extractFields(INVOICE_TEXT, { documentType: 'invoice', ocrConfidence: 60 });
    expect(blurry.needsReview).toBe(true);
    expect(blurry.lowConfidence).toContain('totalAmount');
  });

  it('supports custom fields and reports missing required ones', () => {
    const result = extractFields('Ref: AB-77\nAmount paid 1,500.00', {
      fields: [
        { name: 'reference', label: 'Ref', type: 'id', required: true },
        { name: 'paid', pattern: 'Amount paid\\s+([\\d,.]+)', type: 'amount' },
        { name: 'customer', label: 'Customer', required: true },
      ],
    });
    expect(result.values).toMatchObject({ reference: 'AB-77', paid: 1500, customer: null });
    expect(result.missing).toEqual(['customer']);
    expect(result.needsReview).toBe(true);
    expect(() => extractFields('x', { fields: [{ name: 'bad', pattern: '(' }] })).toThrow(/Invalid pattern/);
  });

  it('reads the PDF text layer', async () => {
    const result = await extractPdfText(fs.readFileSync(path.join(fixtures, 'invoice-text.pdf')));
    const text = typeof result === 'string' ? result : result.text;
    expect(text).toContain('INV-2026-0042');
  });
});

describe('database and Google Sheets connectors', () => {
  it('enforces the custom query policy', () => {
    expect(() => checkCustomQuery({}, { query: 'SELECT 1' })).toThrow(/does not allow custom queries/);
    const config = { allowCustomQueries: true };
    expect(checkCustomQuery(config, { query: 'SELECT * FROM t WHERE id = ?;', parameters: [1] })).toEqual({ query: 'SELECT * FROM t WHERE id = ?', parameters: [1], readOnly: true });
    expect(() => checkCustomQuery(config, { query: 'DELETE FROM t' })).toThrow(/read-only/);
    expect(() => checkCustomQuery(config, { query: 'SELECT 1; DROP TABLE t' })).toThrow(/one statement/);
    expect(checkCustomQuery({ ...config, readOnly: false }, { query: 'UPDATE t SET a = 1' }).readOnly).toBe(false);
  });

  it('runs approved and custom PostgreSQL operations (PGlite in-process server)', async () => {
    const { PGlite } = await import('@electric-sql/pglite');
    const db = new PGlite();
    await db.exec(`CREATE TABLE invoices (id serial primary key, number text, total numeric); INSERT INTO invoices (number, total) VALUES ('A-1', 100), ('A-2', 250);`);
    const clientFactory = async () => ({ query: (text, params) => db.query(text, params), end: async () => {} });
    const config = { allowedTables: ['invoices'], allowedColumns: { invoices: ['id', 'number', 'total'] }, allowCustomQueries: true };
    expect(buildPostgresOperation(config, { operation: 'select_rows', table: 'invoices', filters: [{ column: 'number', op: 'eq', value: 'A-1' }] }).text).toBe('SELECT * FROM "invoices" WHERE "number" = $1 LIMIT 100');
    const selected = await runDatabaseStep('postgres', config, {}, { operation: 'select_rows', table: 'invoices', filters: [{ column: 'number', op: 'eq', value: 'A-2' }] }, { clientFactory });
    expect(selected.result).toHaveLength(1);
    const inserted = await runDatabaseStep('postgres', config, {}, { operation: 'insert_row', table: 'invoices', row: { number: 'A-3', total: 5 } }, { clientFactory });
    expect(inserted.result.affectedRows).toBe(1);
    const query = await runDatabaseStep('postgres', config, {}, { operation: 'run_query', query: 'SELECT number, total::float AS total FROM invoices WHERE total > $1 ORDER BY number', parameters: [50] }, { clientFactory });
    expect(query.rows).toEqual([{ number: 'A-1', total: 100 }, { number: 'A-2', total: 250 }]);
    await expect(runDatabaseStep('postgres', config, {}, { operation: 'run_query', query: 'WITH x AS (DELETE FROM invoices RETURNING *) SELECT * FROM x' }, { clientFactory })).rejects.toThrow();
    expect((await db.query('SELECT COUNT(*)::int AS n FROM invoices')).rows[0].n).toBe(3);
    await expect(runDatabaseStep('postgres', config, {}, { operation: 'select_rows', table: 'users' }, { clientFactory })).rejects.toMatchObject({ code: 'TABLE_NOT_ALLOWED' });
    await db.close();
  });

  it('reads, appends, and updates Google Sheets through the REST API (local mock server)', async () => {
    const { privateKey } = crypto.generateKeyPairSync('rsa', { modulusLength: 2048 });
    const sheet = [['Name', 'Amount'], ['Ana', '10']];
    const seen = [];
    const server = http.createServer((req, res) => {
      let body = '';
      req.on('data', (chunk) => { body += chunk; });
      req.on('end', () => {
        seen.push(`${req.method} ${decodeURIComponent(req.url)}`);
        res.setHeader('content-type', 'application/json');
        if (req.url === '/token') {
          const assertion = new URLSearchParams(body).get('assertion');
          const claims = JSON.parse(Buffer.from(assertion.split('.')[1], 'base64url').toString());
          res.end(JSON.stringify(claims.iss === 'bot@demo.iam.gserviceaccount.com' ? { access_token: 'tok', expires_in: 3600 } : { error: 'bad' }));
          return;
        }
        if (req.headers.authorization !== 'Bearer tok') { res.statusCode = 401; res.end('{}'); return; }
        if (req.method === 'GET') { res.end(JSON.stringify({ range: 'Sheet1!A1:B10', values: sheet })); return; }
        const values = JSON.parse(body).values;
        if (req.method === 'POST') { sheet.push(...values); res.end(JSON.stringify({ updates: { updatedRange: 'Sheet1!A3:B3', updatedRows: values.length } })); return; }
        res.end(JSON.stringify({ updatedRange: 'Sheet1!B2', updatedRows: 1, updatedCells: 1 }));
      });
    });
    await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
    const base = `http://127.0.0.1:${server.address().port}`;
    try {
      const client = createSheetsClient({
        config: { spreadsheetId: '1AbCdEfGhIjKlMnOp', apiBaseUrl: base, authUrl: `${base}/token` },
        secret: { client_email: 'bot@demo.iam.gserviceaccount.com', private_key: privateKey.export({ type: 'pkcs8', format: 'pem' }) },
      });
      expect((await client.readRange({ range: 'Sheet1!A1:B10' })).rows).toEqual([{ Name: 'Ana', Amount: '10' }]);
      expect((await client.appendRows({ range: 'Sheet1!A1', rows: [{ Name: 'Ben', Amount: 20 }] })).updatedRows).toBe(1);
      expect(sheet.at(-1)).toEqual(['Ben', 20]);
      expect((await client.updateRange({ range: 'Sheet1!B2', values: [['11']] })).updatedCells).toBe(1);
      expect(seen.filter((line) => line.startsWith('POST /token'))).toHaveLength(1);
      expect(seen).toContain('POST /v4/spreadsheets/1AbCdEfGhIjKlMnOp/values/Sheet1!A1:append?valueInputOption=USER_ENTERED&insertDataOption=INSERT_ROWS');
      await expect(client.readRange({})).rejects.toThrow(/range is required/);
    } finally {
      server.close();
    }
    expect(rowsToValues([{ a: 1, b: { c: 2 } }])).toEqual({ values: [[1, '{"c":2}']], columns: ['a', 'b'] });
    expect(valuesToRows([['x'], ['1'], []])).toEqual([{ x: '1' }, { x: '' }]);
  });
});

describe('Action Center rules and robot packages', () => {
  it('validates task forms', () => {
    const schema = normalizeFormSchema([
      { name: 'approvedAmount', label: 'Approved amount', type: 'number', required: true },
      { name: 'costCenter', type: 'select', options: ['FIN', 'OPS'] },
      { name: 'urgent', type: 'checkbox' },
    ]);
    expect(validateFormData(schema, { approvedAmount: '1200.5', costCenter: 'FIN' })).toEqual({ approvedAmount: 1200.5, costCenter: 'FIN', urgent: false });
    expect(() => validateFormData(schema, { costCenter: 'HR' })).toThrow(/incomplete/);
    expect(() => normalizeFormSchema([{ name: '1bad' }])).toThrow();
    expect(() => normalizeFormSchema([{ name: 'a', type: 'select' }])).toThrow(/options/);
    expect(canCompleteTask({ id: 'u1', role: 'operator' }, { assigned_user_id: null, assigned_role: null })).toBe(true);
    expect(canCompleteTask({ id: 'u1', role: 'viewer' }, {})).toBe(false);
    expect(canCompleteTask({ id: 'u1', role: 'operator' }, { assigned_user_id: 'u2' })).toBe(false);
    expect(canCompleteTask({ id: 'u1', role: 'project_manager' }, { assigned_user_id: 'u2' })).toBe(true);
  });

  it('suspends at a task step and resumes with the task result', async () => {
    const definition = wf([
      { id: 'start', type: 'start', name: 'Start', next: 'approve' },
      { id: 'approve', type: 'create_task', name: 'Approve', config: { title: 'Approve {{input.amount}}', taskType: 'approval' }, next: 'end' },
      { id: 'end', type: 'end', name: 'End', config: { summaryFrom: ['approve'] } },
    ]);
    expect(validateDefinition(definition).errors).toEqual([]);
    const created = [];
    const services = { createTask: async (config, stepId) => { created.push([config.title, stepId]); return { taskId: 't-1', status: 'pending' }; } };
    const first = await executeWorkflow(definition, { amount: 500 }, services);
    expect(first.status).toBe('SUSPENDED');
    expect(first.suspend).toEqual({ stepId: 'approve', taskId: 't-1' });
    expect(created).toEqual([['Approve 500', 'approve']]);
    const second = await executeWorkflow(definition, { amount: 500 }, services, {}, 0, { steps: first.steps, stepId: 'approve', output: { taskId: 't-1', outcome: 'approve' } });
    expect(second.status).toBe('SUCCEEDED');
    expect(JSON.stringify(second.output)).toContain('approve');
    expect(created).toHaveLength(1);
  });

  it('knows which steps the robot can run', () => {
    expect(packageNeedsExecution(wf([{ id: 'start', type: 'start' }, { id: 'end', type: 'end' }]))).toBe(false);
    const definition = wf([
      { id: 'start', type: 'start', next: 'open' },
      { id: 'open', type: 'browser_open', config: { url: 'https://example.com' }, next: 'mail' },
      { id: 'mail', type: 'send_notification', config: {}, next: 'end' },
      { id: 'end', type: 'end' },
    ]);
    expect(packageNeedsExecution(definition)).toBe(true);
    expect(unsupportedSteps(definition)).toEqual(['mail (send_notification)']);
  });

  it('validates the new activity configurations', () => {
    const { errors } = validateDefinition(wf([
      { id: 'start', type: 'start', name: 'Start', next: 'open' },
      { id: 'open', type: 'browser_open', name: 'Open', config: { url: 'ftp://x' }, next: 'click' },
      { id: 'click', type: 'browser_click', name: 'Click', config: {}, next: 'key' },
      { id: 'key', type: 'desktop_hotkey', name: 'Keys', config: { keys: 'Ctrl+Bogus' }, next: 'ocr' },
      { id: 'ocr', type: 'ocr_extract', name: 'OCR', config: {}, next: 'task' },
      { id: 'task', type: 'create_task', name: 'Task', config: { title: '', taskType: 'nope' }, next: 'end' },
      { id: 'end', type: 'end', name: 'End' },
    ]));
    const paths = errors.map((error) => error.path);
    expect(paths).toEqual(expect.arrayContaining(['open.config.url', 'click.config.selector', 'key.config.keys', 'ocr.config.path', 'task.config.title', 'task.config.taskType']));
  });
});
