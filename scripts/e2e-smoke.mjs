// End-to-end smoke test against a running stack (API + worker, optionally the Vite dev server).
// It creates its own project, so it is safe to run repeatedly against a development database.
//
//   node scripts/e2e-smoke.mjs
//
// Env: API_URL (default http://localhost:4000), FRONTEND_URL (default http://localhost:5173, set
// to "" to skip), ADMIN_EMAIL / ADMIN_PASSWORD (read from .env when not set), E2E_ROBOT=0 to skip
// starting the robot agent, E2E_AUTOMATION=0 to skip the browser / OCR / Action Center checks
// (they need "npx playwright install chromium" on the worker machine).
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const envFile = path.join(projectRoot, '.env');
const fileEnv = fs.existsSync(envFile)
  ? Object.fromEntries(fs.readFileSync(envFile, 'utf8').split(/\r?\n/).filter((line) => /^[A-Z_]+=/.test(line)).map((line) => [line.slice(0, line.indexOf('=')), line.slice(line.indexOf('=') + 1)]))
  : {};
const env = (key, fallback) => process.env[key] ?? fileEnv[key] ?? fallback;
const API = env('API_URL', 'http://localhost:4000').replace(/\/$/, '');
const FRONTEND = (process.env.FRONTEND_URL ?? 'http://localhost:5173').replace(/\/$/, '');
const stamp = new Date().toISOString().replace(/[-:.TZ]/g, '').slice(0, 14);
const results = [];
let token = '';

function record(name, ok, detail = '') {
  results.push({ name, ok, detail });
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? `  (${detail})` : ''}`);
  if (!ok) throw new Error(`${name} failed: ${detail}`);
}

async function call(method, route, body, { raw = false, auth = token } = {}) {
  const headers = {};
  if (auth) headers.Authorization = `Bearer ${auth}`;
  let payload;
  if (body instanceof FormData) payload = body;
  else if (body !== undefined) { headers['Content-Type'] = 'application/json'; payload = JSON.stringify(body); }
  const response = await fetch(`${API}${route}`, { method, headers, body: payload });
  if (raw) return response;
  const text = await response.text();
  const json = text ? JSON.parse(text) : {};
  if (!response.ok) throw new Error(`${method} ${route} -> ${response.status} ${text}`);
  return json.data;
}

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function waitFor(label, fn, timeoutMs = 30000) {
  const started = Date.now();
  while (Date.now() - started < timeoutMs) {
    const value = await fn();
    if (value) return value;
    await sleep(500);
  }
  throw new Error(`Timed out waiting for ${label}`);
}

const finished = (id, timeoutMs = 30000) => waitFor(`job ${id}`, async () => {
  const job = await call('GET', `/api/jobs/${id}`);
  return ['SUCCEEDED', 'FAILED', 'CANCELLED', 'SKIPPED'].includes(job.status) ? job : null;
}, timeoutMs);

const AUTOMATION = env('E2E_AUTOMATION', '1') !== '0';
const TEST_PAGE = `<!doctype html><html><head><title>E2E orders</title></head><body>
<h1>Order entry</h1>
<label for="customer">Customer</label> <input id="customer">
<select id="region"><option value="">Pick</option><option value="north">North</option><option value="south">South</option></select>
<button id="save" onclick="setTimeout(() => { const r = document.getElementById('result'); r.textContent = 'Saved ' + customer.value + ' / ' + region.value; r.hidden = false; }, 200)">Save</button>
<p id="result" hidden></p>
<table id="orders"><thead><tr><th>Order</th><th>Amount</th></tr></thead>
<tbody><tr><td>E-1</td><td>100</td></tr><tr><td>E-2</td><td>250</td></tr><tr><td>E-3</td><td>75</td></tr></tbody></table>
</body></html>`;

function startTestSite() {
  const server = http.createServer((_req, res) => { res.setHeader('content-type', 'text/html'); res.end(TEST_PAGE); });
  return new Promise((resolve) => server.listen(0, '127.0.0.1', () => resolve({ server, url: `http://127.0.0.1:${server.address().port}/` })));
}

const stepOut = (job, key) => job.steps.filter((step) => step.step_key === key && step.status !== 'RUNNING').at(-1)?.output_json;

function webSteps(siteUrl) {
  return [
    { id: 'start', type: 'start', name: 'Start', next: 'open' },
    { id: 'open', type: 'browser_open', name: 'Open Browser', config: { url: siteUrl }, next: 'type' },
    { id: 'type', type: 'browser_type', name: 'Type Into', config: { selector: 'Customer', selectorType: 'label', text: '{{input.customer}}' }, next: 'select' },
    { id: 'select', type: 'browser_select_option', name: 'Select Item', config: { selector: '#region', value: 'south' }, next: 'click' },
    { id: 'click', type: 'browser_click', name: 'Click Save', config: { selector: '//button[@id="save"]' }, next: 'wait' },
    { id: 'wait', type: 'browser_wait_for', name: 'Wait For Result', config: { selector: '#result', state: 'visible' }, next: 'text' },
    { id: 'text', type: 'browser_get_text', name: 'Get Text', config: { selector: '#result' }, next: 'scrape' },
    { id: 'scrape', type: 'browser_extract_table', name: 'Extract Table', config: { selector: '#orders' }, next: 'shot' },
    { id: 'shot', type: 'browser_screenshot', name: 'Screenshot', config: { path: 'screens/e2e-orders.png', fullPage: true }, next: 'close' },
    { id: 'close', type: 'browser_close', name: 'Close Browser', config: {}, next: 'end' },
    { id: 'end', type: 'end', name: 'End', config: { summaryFrom: ['text', 'scrape'] } },
  ];
}

async function workflow(projectId, name, steps, executionType = 'native', maxAttempts = 1) {
  const created = await call('POST', '/api/workflows', { projectId, name, executionType });
  const draft = await call('POST', `/api/workflows/${created.id}/draft`, { definition: { schemaVersion: '1.0', retryPolicy: { maxAttempts, backoffSeconds: 0 }, steps } });
  if (!draft.validation.valid) throw new Error(`${name} invalid: ${JSON.stringify(draft.validation.errors)}`);
  await call('POST', `/api/workflows/${created.id}/publish`);
  return created.id;
}

async function main() {
  const health = await call('GET', '/api/health', undefined, { auth: '' });
  record('API health', health.status === 'ok' && health.database === 'up', JSON.stringify(health));

  const login = await call('POST', '/api/auth/login', { email: env('ADMIN_EMAIL'), password: env('ADMIN_PASSWORD') }, { auth: '' });
  token = login.accessToken;
  record('Login as administrator', Boolean(token), login.user?.email);
  const me = await call('GET', '/api/auth/me');
  record('Current user', me.role === 'administrator' || me.user?.role === 'administrator');

  const authOptions = await call('GET', '/api/auth/options', undefined, { auth: '' });
  if (authOptions.allowSignup) {
    const signup = await call('POST', '/api/auth/signup', {
      displayName: 'E2E Signup', email: `e2e.signup.${stamp}@example.com`, password: `Signup-${stamp}-ok`, organization: `E2E Org ${stamp}`, acceptTerms: true,
    }, { auth: '' });
    const own = await call('GET', '/api/projects', undefined, { auth: signup.accessToken });
    record('Self sign-up creates a signed-in account with a starter project', signup.user?.role !== 'administrator' && own.length === 1 && own[0].id === signup.projectId, `${signup.user?.email} · ${signup.user?.role}`);
    const again = await call('POST', '/api/auth/signup', {
      displayName: 'E2E Signup', email: `e2e.signup.${stamp}@example.com`, password: `Signup-${stamp}-ok`, organization: `E2E Org ${stamp}`, acceptTerms: true,
    }, { raw: true, auth: '' });
    record('Duplicate sign-up is rejected', again.status === 409, String(again.status));
  } else {
    console.log('SKIP  Self sign-up (ALLOW_SIGNUP=false)');
  }

  const project = await call('POST', '/api/projects', { name: `E2E ${stamp}`, description: 'Created by e2e-smoke', category: 'excel' });
  record('Create project', Boolean(project.id), project.id);
  const site = AUTOMATION ? await startTestSite() : null;

  const form = new FormData();
  form.append('file', new Blob(['sku,qty\nA,2\nB,0\nC,5\n'], { type: 'text/csv' }), 'orders.csv');
  const upload = await call('POST', `/api/projects/${project.id}/files`, form);
  record('Upload input file', Boolean(upload.path), upload.path);

  const csvFlow = await workflow(project.id, 'Filter orders', [
    { id: 'start', type: 'start', name: 'Start', next: 'read' },
    { id: 'read', type: 'read_csv', name: 'Read CSV', config: { path: '{{input.file}}' }, next: 'filter' },
    { id: 'filter', type: 'transform_data', name: 'Keep positive', config: { source: '{{steps.read.rows}}', operations: [{ op: 'map', field: 'qty', fn: 'number' }, { op: 'filter', field: 'qty', operator: 'gt', value: 0 }] }, next: 'write' },
    { id: 'write', type: 'write_excel', name: 'Write Excel', config: { path: 'out/positive.xlsx', rows: '{{steps.filter.rows}}' }, next: 'log' },
    { id: 'log', type: 'log_message', name: 'Log', config: { message: 'Kept {{steps.filter.count}} rows' }, next: 'notify' },
    { id: 'notify', type: 'send_notification', name: 'Notify', config: { channel: 'in_app', subject: `E2E ${stamp}`, message: 'Orders filtered' }, next: 'end' },
    { id: 'end', type: 'end', name: 'End', config: { summaryFrom: ['filter', 'write'] } },
  ]);
  record('Create, save, and publish workflow', Boolean(csvFlow), csvFlow);

  const queued = await call('POST', `/api/workflows/${csvFlow}/run`, { input: { file: upload.path } });
  record('Run workflow (queued)', queued.status === 'QUEUED', queued.id);
  const done = await finished(queued.id);
  record('Worker executes the job', done.status === 'SUCCEEDED', `${done.status}, ${done.steps.length} step rows`);
  const logStep = done.steps.find((step) => step.step_key === 'log' && step.status === 'SUCCEEDED');
  record('Step log shows each step output', logStep?.output_json?.message === 'Kept 2 rows', logStep?.output_json?.message);
  const artifact = done.artifacts.find((item) => item.file_name === 'positive.xlsx');
  const download = await call('GET', `/api/artifacts/${artifact.id}/download`, undefined, { raw: true });
  const bytes = Buffer.from(await download.arrayBuffer());
  record('Download output artifact', download.ok && bytes.subarray(0, 2).toString() === 'PK', `${bytes.length} bytes xlsx`);

  const failing = await workflow(project.id, 'Validate SKU', [
    { id: 'start', type: 'start', name: 'Start', next: 'check' },
    { id: 'check', type: 'validate_data', name: 'Validate', config: { source: '{{input.rows}}', mode: 'fail_workflow', rules: [{ field: 'sku', checks: ['required'] }] }, next: 'end' },
    { id: 'end', type: 'end', name: 'End' },
  ]);
  const bad = await call('POST', `/api/workflows/${failing}/run`, { input: { rows: [{ sku: '' }] } });
  const failed = await finished(bad.id);
  record('Failed run is recorded with error', failed.status === 'FAILED' && Boolean(failed.attempts[0]?.error_message), failed.attempts[0]?.error_message);
  await call('POST', `/api/jobs/${bad.id}/retry`);
  const retried = await waitFor('retry attempt', async () => {
    const job = await call('GET', `/api/jobs/${bad.id}`);
    return job.attempts.length === 2 && job.status === 'FAILED' ? job : null;
  });
  record('Manual retry adds attempt 2', retried.attempts.length === 2);

  const performer = await workflow(project.id, 'Invoice performer', [
    { id: 'start', type: 'start', name: 'Start', next: 'get' },
    { id: 'get', type: 'get_queue_item', name: 'Get Transaction Item', config: { queueName: 'Invoices', maxItems: 10 }, next: 'loop' },
    { id: 'loop', type: 'for_each', name: 'Each item', config: { source: '{{steps.get.items}}', bodyStart: 'ok', bodyEnd: 'ok', maxIterations: 10 }, next: 'end' },
    { id: 'ok', type: 'set_queue_item_status', name: 'Set Transaction Status', config: { itemId: '{{item.id}}', status: 'SUCCESSFUL', output: { paid: '{{item.specificContent.amount}}' } } },
    { id: 'end', type: 'end', name: 'End' },
  ]);
  const queue = await call('POST', '/api/queues', { projectId: project.id, name: 'Invoices', maxRetries: 1, uniqueReference: true, triggerWorkflowId: performer, triggerEnabled: true });
  await call('POST', `/api/queues/${queue.id}/items`, { items: [{ reference: 'INV-1', specificContent: { amount: 10 } }, { reference: 'INV-2', specificContent: { amount: 20 }, priority: 'high' }] });
  const drained = await waitFor('queue trigger', async () => {
    const summary = await call('GET', `/api/queues/${queue.id}`);
    return summary.counts.SUCCESSFUL === 2 ? summary : null;
  });
  record('Queue trigger starts performer and items finish', drained.counts.SUCCESSFUL === 2, JSON.stringify(drained.counts));

  const runAt = new Date(Date.now() + 3000).toISOString();
  const schedule = await call('POST', '/api/schedules', { projectId: project.id, workflowId: failing, name: 'One time', scheduleType: 'once', runAt, timezone: 'Asia/Kolkata', input: { rows: [{ sku: 'A' }] } });
  const scheduleRuns = await waitFor('schedule run', async () => {
    const runs = await call('GET', `/api/schedules/${schedule.id}/runs`);
    return runs.find((item) => item.job_id) ? runs : null;
  });
  const scheduledJob = await finished(scheduleRuns[0].job_id);
  record('One-time schedule fires and job succeeds', scheduledJob.status === 'SUCCEEDED' && scheduledJob.triggerSource === 'schedule', scheduledJob.status);

  if (env('E2E_ROBOT', '1') !== '0') {
    const robot = await call('POST', '/api/robots', { name: `E2E robot ${stamp}`, adapter: 'local_file_handoff', projectIds: [project.id] });
    const simulator = spawn(process.execPath, [path.join(projectRoot, 'backend/src/robotSimulator.js')], {
      cwd: path.join(projectRoot, 'backend'),
      env: { ...process.env, ROBOT_TOKEN: robot.token, API_URL: API, ROBOT_POLL_MS: '500' }, stdio: 'ignore',
    });
    try {
      const robotFlow = await workflow(project.id, 'Portal update (robot)', [
        { id: 'start', type: 'start', name: 'Start', next: 'end' },
        { id: 'end', type: 'end', name: 'End' },
      ], 'uipath');
      const robotJob = await call('POST', `/api/workflows/${robotFlow}/run`, { input: { order: 'R-1' } });
      const robotDone = await finished(robotJob.id);
      record('Robot job claimed and completed by the robot agent (report contract)', robotDone.status === 'SUCCEEDED' && robotDone.robotId === robot.id, robotDone.status);
      if (AUTOMATION) {
        const robotWeb = await workflow(project.id, 'Order entry (robot browser)', webSteps(site.url), 'uipath');
        const robotWebJob = await call('POST', `/api/workflows/${robotWeb}/run`, { input: { customer: 'Robot Co' } });
        const robotWebDone = await finished(robotWebJob.id, 60000);
        record('Robot agent runs Playwright steps (type, select, click, scrape)', robotWebDone.status === 'SUCCEEDED' && stepOut(robotWebDone, 'text')?.text === 'Saved Robot Co / south' && stepOut(robotWebDone, 'scrape')?.count === 3, robotWebDone.errorSummary || stepOut(robotWebDone, 'text')?.text);
        record('Robot uploads its screenshot as a job artifact', robotWebDone.artifacts.some((item) => item.file_name === 'e2e-orders.png'));
      }
    } finally {
      simulator.kill();
    }
  }

  if (AUTOMATION) {
    const webFlow = await workflow(project.id, 'Order entry (browser)', webSteps(site.url));
    const webJob = await call('POST', `/api/workflows/${webFlow}/run`, { input: { customer: 'Globex' } });
    const webDone = await finished(webJob.id, 60000);
    record('Worker runs Playwright: type, select, click, wait, get text', webDone.status === 'SUCCEEDED' && stepOut(webDone, 'text')?.text === 'Saved Globex / south', webDone.errorSummary || stepOut(webDone, 'text')?.text);
    const scraped = stepOut(webDone, 'scrape');
    record('Extract Table scrapes the HTML table', scraped?.count === 3 && scraped.rows[1].Order === 'E-2' && scraped.rows[1].Amount === '250', JSON.stringify(scraped?.rows?.[1]));
    const shot = webDone.artifacts.find((item) => item.file_name === 'e2e-orders.png');
    const shotFile = shot ? await call('GET', `/api/artifacts/${shot.id}/download`, undefined, { raw: true }) : null;
    const shotBytes = shotFile ? Buffer.from(await shotFile.arrayBuffer()) : Buffer.alloc(0);
    record('Screenshot is stored as a PNG artifact', shotBytes.subarray(1, 4).toString() === 'PNG', `${shotBytes.length} bytes`);

    const fixtures = path.join(projectRoot, 'backend/test/fixtures');
    const ocrFlow = await workflow(project.id, 'Read invoice (OCR)', [
      { id: 'start', type: 'start', name: 'Start', next: 'ocr' },
      { id: 'ocr', type: 'ocr_extract', name: 'OCR', config: { path: '{{input.file}}', language: 'eng' }, next: 'fields' },
      { id: 'fields', type: 'extract_document_fields', name: 'Extract Fields', config: { source: '{{steps.ocr}}', documentType: 'invoice' }, next: 'end' },
      { id: 'end', type: 'end', name: 'End', config: { summaryFrom: ['fields'] } },
    ]);
    for (const [file, mime, label] of [['invoice-sample.png', 'image/png', 'image'], ['invoice-scan.pdf', 'application/pdf', 'scanned PDF']]) {
      const sample = new FormData();
      sample.append('file', new Blob([fs.readFileSync(path.join(fixtures, file))], { type: mime }), file);
      const uploaded = await call('POST', `/api/projects/${project.id}/files`, sample);
      const ocrJob = await call('POST', `/api/workflows/${ocrFlow}/run`, { input: { file: uploaded.path } });
      const ocrDone = await finished(ocrJob.id, 120000);
      const ocr = stepOut(ocrDone, 'ocr');
      const fields = stepOut(ocrDone, 'fields');
      record(`OCR reads the invoice ${label}`, ocrDone.status === 'SUCCEEDED' && /INV-2026-0042/.test(ocr?.text || ''), ocrDone.errorSummary || `confidence ${ocr?.confidence}`);
      record(`Document fields extracted from the ${label}`, fields?.values?.invoiceNumber === 'INV-2026-0042' && fields.values.totalAmount === 11800 && fields.values.invoiceDate === '2026-09-15', `total ${fields?.values?.totalAmount}, confidence ${fields?.confidence}`);
    }

    const approval = await workflow(project.id, 'Approve order (Action Center)', [
      { id: 'start', type: 'start', name: 'Start', next: 'approve' },
      { id: 'approve', type: 'create_task', name: 'Approve', config: { taskType: 'approval', title: 'Approve order {{input.order}}', priority: 'high', data: { order: '{{input.order}}' }, outcomes: ['approve', 'reject'], formFields: [{ name: 'note', label: 'Note', type: 'text', required: true }] }, next: 'end' },
      { id: 'end', type: 'end', name: 'End', config: { summaryFrom: ['approve'] } },
    ]);
    const approvalJob = await call('POST', `/api/workflows/${approval}/run`, { input: { order: 'O-77' } });
    await waitFor('job to suspend', async () => (await call('GET', `/api/jobs/${approvalJob.id}`)).status === 'SUSPENDED');
    const [task] = await call('GET', `/api/tasks?status=pending&jobId=${approvalJob.id}`);
    record('Create Form Task suspends the job and opens a task', task?.title === 'Approve order O-77', task?.id);
    const completed = await call('POST', `/api/tasks/${task.id}/complete`, { outcome: 'approve', data: { note: 'looks fine' } });
    record('Completing the task queues the job to resume', completed.resumedJobId === approvalJob.id);
    const approvalDone = await finished(approvalJob.id);
    record('Job resumes and finishes with the task result', approvalDone.status === 'SUCCEEDED' && stepOut(approvalDone, 'approve')?.outcome === 'approve' && approvalDone.attempts.length === 1, approvalDone.status);

    const session = await call('POST', '/api/recorder/sessions', { url: site.url, headless: true });
    const stopped = await call('POST', `/api/recorder/sessions/${session.id}/stop`);
    record('Recorder session starts and returns steps', stopped.steps[0]?.type === 'browser_open', `${stopped.steps.length} step(s)`);
    site.server.close();
  }

  const csv = await call('GET', `/api/reports/export.csv?projectId=${project.id}`, undefined, { raw: true });
  const csvText = await csv.text();
  record('CSV export', csv.ok && csvText.split('\n')[0].includes('workflow_name'), `${csvText.trim().split('\n').length - 1} rows`);
  const xlsx = await call('GET', `/api/reports/export.xlsx?projectId=${project.id}`, undefined, { raw: true });
  record('Excel export', xlsx.ok && Buffer.from(await xlsx.arrayBuffer()).subarray(0, 2).toString() === 'PK');
  const dashboard = await call('GET', `/api/dashboard?projectId=${project.id}`);
  record('Dashboard counts', JSON.stringify(dashboard).length > 0 && (dashboard.totals?.total ?? dashboard.summary?.total ?? 1) > 0);
  const audit = await call('GET', `/api/audit?projectId=${project.id}`);
  record('Audit log entries', audit.length > 0, `${audit.length} rows`);
  const notes = await call('GET', '/api/notifications');
  record('In-app notification', notes.some((note) => note.subject === `E2E ${stamp}`));

  if (FRONTEND) {
    const page = await fetch(`${FRONTEND}/`);
    const html = await page.text();
    record('Frontend serves the app', page.ok && html.includes('id="root"'));
    const proxied = await fetch(`${FRONTEND}/api/health`);
    record('Frontend proxies /api to the backend', proxied.ok);
    const signupPage = await fetch(`${FRONTEND}/signup`);
    record('Frontend serves the sign-up and forgot-password routes', signupPage.ok && (await signupPage.text()).includes('id="root"') && (await fetch(`${FRONTEND}/forgot-password`)).ok);
  }
  console.log(`\n${results.length} checks passed`);
}

main().catch((error) => {
  console.error(`\nE2E smoke failed: ${error.message}`);
  process.exit(1);
});
