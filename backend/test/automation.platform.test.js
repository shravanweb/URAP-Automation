// End-to-end tests (API + worker + robot + MariaDB) for the UiPath-style activities: real
// Playwright browser runs against a local page, the recorder, OCR and field extraction on
// fixtures, Action Center suspend/resume, Credential typing, the HTTP connector options, and
// web steps executed by the robot agent.
import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import http from 'node:http';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { loadConfig } from '../src/config.js';
import { createPool } from '../src/db/pool.js';
import { createApp } from '../src/http/createApp.js';
import { hashPassword } from '../src/lib/passwords.js';
import { processNextNativeJob } from '../src/services/jobService.js';
import { stopOcrWorkers } from '../src/automation/documents/ocr.js';

const cfg = loadConfig();
const pool = createPool(cfg.databaseUrl);
const app = createApp({ pool, config: cfg });
const tenantId = '00000000-0000-4000-8000-000000000001';
const fixtures = path.join(path.dirname(fileURLToPath(import.meta.url)), 'fixtures');
const PASSWORD = 'Automation-pass-12';
let admin;
let operator;
let viewer;
let server;
let apiUrl;
let site;
let siteUrl;
const posted = [];

const TEST_PAGE = `<!doctype html><html><head><title>Order entry</title></head><body>
<h1>Order entry</h1>
<label for="customer">Customer</label> <input id="customer" name="customer">
<input type="password" id="pin" placeholder="PIN">
<select id="region"><option value="">Pick</option><option value="north">North</option><option value="south">South</option></select>
<button data-testid="save" onclick="setTimeout(() => { const r = document.getElementById('result'); r.textContent = 'Saved ' + customer.value + ' (' + region.value + ') pin ' + pin.value.length; r.hidden = false; }, 300)">Save</button>
<p id="result" hidden></p>
<table id="orders"><thead><tr><th>Order</th><th>Amount</th></tr></thead>
<tbody><tr><td>A-1</td><td>100</td></tr><tr><td>A-2</td><td>250</td></tr></tbody></table>
<a href="/page2">Next page</a>
</body></html>`;

function definition(steps) {
  return { schemaVersion: '1.0', retryPolicy: { maxAttempts: 1, backoffSeconds: 0 }, steps };
}

async function createUser(email, role) {
  const id = crypto.randomUUID();
  await pool.query(
    `INSERT INTO users (id, tenant_id, email, display_name, password_hash, role, status, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, 'active', UTC_TIMESTAMP(3), UTC_TIMESTAMP(3))`,
    [id, tenantId, email, `${role} user`, await hashPassword(PASSWORD, 4), role],
  );
  const response = await request(app).post('/api/auth/login').send({ email, password: PASSWORD });
  expect(response.status).toBe(200);
  return { id, email, token: response.body.data.accessToken };
}

const as = (user) => ({ Authorization: `Bearer ${user.token}` });

async function createProject(name) {
  const response = await request(app).post('/api/projects').set(as(admin)).send({ name, description: name, category: 'automation' });
  expect(response.status).toBe(201);
  return response.body.data;
}

async function addMember(projectId, user, role) {
  const response = await request(app).post(`/api/projects/${projectId}/members`).set(as(admin)).send({ userId: user.id, role });
  expect([200, 201]).toContain(response.status);
}

async function connection(projectId, connectorType, name, config, secret) {
  const response = await request(app).post(`/api/projects/${projectId}/connections`).set(as(admin)).send({ connectorType, name, config, secret });
  expect(response.status).toBe(201);
  return response.body.data.id;
}

async function publish(projectId, name, body, executionType = 'native') {
  const created = await request(app).post('/api/workflows').set(as(admin)).send({ projectId, name, executionType });
  expect(created.status).toBe(201);
  const draft = await request(app).post(`/api/workflows/${created.body.data.id}/draft`).set(as(admin)).send({ definition: body });
  expect(draft.body.data.validation.errors).toEqual([]);
  const published = await request(app).post(`/api/workflows/${created.body.data.id}/publish`).set(as(admin));
  expect(published.status).toBe(200);
  return created.body.data.id;
}

async function run(workflowId, input = {}) {
  const queued = await request(app).post(`/api/workflows/${workflowId}/run`).set(as(admin)).send({ input });
  expect(queued.status).toBe(202);
  return queued.body.data;
}

async function jobDetail(id) {
  const response = await request(app).get(`/api/jobs/${id}`).set(as(admin));
  expect(response.status).toBe(200);
  return response.body.data;
}

function stepOutput(detail, stepKey) {
  const runs = detail.steps.filter((step) => step.step_key === stepKey && step.status !== 'RUNNING');
  const last = runs.at(-1);
  return typeof last?.output_json === 'string' ? JSON.parse(last.output_json) : last?.output_json;
}

beforeAll(async () => {
  admin = await createUser('automation-admin@example.com', 'administrator');
  operator = await createUser('automation-operator@example.com', 'operator');
  viewer = await createUser('automation-viewer@example.com', 'viewer');
  server = app.listen(0, '127.0.0.1');
  await new Promise((resolve) => server.once('listening', resolve));
  apiUrl = `http://127.0.0.1:${server.address().port}`;
  site = http.createServer((req, res) => {
    let body = '';
    req.on('data', (chunk) => { body += chunk; });
    req.on('end', () => {
      if (req.url.startsWith('/api/echo')) {
        posted.push({ method: req.method, url: req.url, headers: req.headers, body });
        res.setHeader('content-type', 'application/json');
        res.setHeader('x-request-id', 'req-77');
        res.statusCode = req.url.includes('fail') ? 404 : 200;
        res.end(JSON.stringify({ ok: true, received: body }));
        return;
      }
      res.setHeader('content-type', 'text/html');
      res.end(req.url === '/page2' ? '<html><title>Page 2</title><body><h1 id="h">Second page</h1></body></html>' : TEST_PAGE);
    });
  });
  await new Promise((resolve) => site.listen(0, '127.0.0.1', resolve));
  siteUrl = `http://127.0.0.1:${site.address().port}`;
});

afterAll(async () => {
  await app.locals.recorder?.closeAll();
  await stopOcrWorkers();
  server?.close();
  site?.close();
});

describe('web automation', () => {
  it('runs open, type (with a credential), select, click, wait, get text, extract table, and screenshot in Chromium', async () => {
    const project = await createProject('Web orders');
    const credentialId = await connection(project.id, 'credential', 'Portal PIN', { description: 'demo' }, { username: 'ana', password: '4321' });
    const workflowId = await publish(project.id, 'Order entry', definition([
      { id: 'start', type: 'start', name: 'Start', next: 'open' },
      { id: 'open', type: 'browser_open', name: 'Open', config: { url: `${siteUrl}/` }, next: 'customer' },
      { id: 'customer', type: 'browser_type', name: 'Customer', config: { selector: 'Customer', selectorType: 'label', text: '{{input.customer}}' }, next: 'pin' },
      { id: 'pin', type: 'browser_type', name: 'PIN', config: { selector: 'PIN', selectorType: 'placeholder', credentialId }, next: 'region' },
      { id: 'region', type: 'browser_select_option', name: 'Region', config: { selector: '#region', label: 'South' }, next: 'save' },
      { id: 'save', type: 'browser_click', name: 'Save', config: { selector: 'save', selectorType: 'testid' }, next: 'wait' },
      { id: 'wait', type: 'browser_wait_for', name: 'Wait', config: { selector: '#result', state: 'visible', timeoutMs: 5000 }, next: 'result' },
      { id: 'result', type: 'browser_get_text', name: 'Result', config: { selector: '//p[@id="result"]' }, next: 'orders' },
      { id: 'orders', type: 'browser_extract_table', name: 'Orders', config: { selector: '#orders' }, next: 'shot' },
      { id: 'shot', type: 'browser_screenshot', name: 'Shot', config: { fullPage: true }, next: 'next' },
      { id: 'next', type: 'browser_click', name: 'Next', config: { selector: 'Next page', selectorType: 'text', waitForNavigation: true }, next: 'heading' },
      { id: 'heading', type: 'browser_get_text', name: 'Heading', config: { selector: '#h' }, next: 'close' },
      { id: 'close', type: 'browser_close', name: 'Close', config: {}, next: 'end' },
      { id: 'end', type: 'end', name: 'End', config: { summaryFrom: ['result', 'orders', 'heading'] } },
    ]));
    const job = await run(workflowId, { customer: 'Globex' });
    const finished = await processNextNativeJob(pool, cfg, 'web-worker');
    expect(finished.id).toBe(job.id);
    const detail = await jobDetail(job.id);
    expect(detail.errorSummary).toBe(null);
    expect(detail.status).toBe('SUCCEEDED');
    expect(stepOutput(detail, 'result').text).toBe('Saved Globex (south) pin 4');
    expect(stepOutput(detail, 'orders').rows).toEqual([{ Order: 'A-1', Amount: '100' }, { Order: 'A-2', Amount: '250' }]);
    expect(stepOutput(detail, 'heading').text).toBe('Second page');
    expect(JSON.stringify(detail.steps)).not.toContain('4321');
    const shot = detail.artifacts.find((item) => item.file_name.endsWith('.png'));
    expect(shot.mime_type).toBe('image/png');
    expect(Number(shot.size_bytes)).toBeGreaterThan(1000);
  });

  it('fails a missing element as a retryable ELEMENT_NOT_FOUND error', async () => {
    const project = await createProject('Web failure');
    const workflowId = await publish(project.id, 'Missing button', definition([
      { id: 'start', type: 'start', name: 'Start', next: 'open' },
      { id: 'open', type: 'browser_open', name: 'Open', config: { url: siteUrl } , next: 'click' },
      { id: 'click', type: 'browser_click', name: 'Click', config: { selector: '#does-not-exist', timeoutMs: 800 }, next: 'end' },
      { id: 'end', type: 'end', name: 'End' },
    ]));
    const job = await run(workflowId);
    await processNextNativeJob(pool, cfg, 'web-worker');
    const detail = await jobDetail(job.id);
    expect(detail.status).toBe('FAILED');
    expect(detail.attempts[0].error_code).toBe('ELEMENT_NOT_FOUND');
  });

  it('records clicks and typing into workflow steps and returns picked selectors', async () => {
    const started = await request(app).post('/api/recorder/sessions').set(as(admin)).send({ url: `${siteUrl}/`, headless: true });
    expect(started.status).toBe(201);
    const id = started.body.data.id;
    expect((await request(app).post('/api/recorder/sessions').set(as(operator)).send({ url: siteUrl })).status).toBe(403);
    const page = app.locals.recorder.page(id);
    await page.getByLabel('Customer').fill('Initech');
    await page.locator('#customer').press('Tab');
    await page.locator('#pin').fill('9999');
    await page.locator('#region').selectOption('north');
    await page.getByTestId('save').click();
    await page.waitForTimeout(300);
    await request(app).post(`/api/recorder/sessions/${id}/mode`).set(as(admin)).send({ mode: 'pick' });
    await page.locator('#orders').click();
    await page.waitForTimeout(200);
    const state = await request(app).get(`/api/recorder/sessions/${id}`).set(as(admin));
    expect(state.body.data.picks[0].element.candidates.length).toBeGreaterThan(0);
    const stopped = await request(app).post(`/api/recorder/sessions/${id}/stop`).set(as(admin));
    const steps = stopped.body.data.steps;
    expect(steps.map((step) => step.type)).toEqual(['browser_open', 'browser_type', 'browser_type', 'browser_select_option', 'browser_click']);
    expect(steps[1].config).toMatchObject({ text: 'Initech' });
    expect(['#customer', 'Customer']).toContain(steps[1].config.selector);
    expect(steps[2].config).toMatchObject({ credentialField: 'password' });
    expect(JSON.stringify(steps)).not.toContain('9999');
    expect(steps[3].config.value).toBe('north');
    expect(steps[4].config).toMatchObject({ selector: 'save', selectorType: 'testid' });
  });
});

describe('documents', () => {
  it('OCRs an uploaded invoice image and a scanned PDF and extracts the fields', async () => {
    const project = await createProject('Invoices OCR');
    const image = await request(app).post(`/api/projects/${project.id}/files`).set(as(admin)).attach('file', path.join(fixtures, 'invoice-sample.png'));
    expect(image.status).toBe(201);
    const scan = await request(app).post(`/api/projects/${project.id}/files`).set(as(admin)).attach('file', path.join(fixtures, 'invoice-scan.pdf'));
    expect(scan.status).toBe(201);
    const fake = await request(app).post(`/api/projects/${project.id}/files`).set(as(admin)).attach('file', Buffer.from('not an image'), 'fake.png');
    expect(fake.status).toBe(400);
    const workflowId = await publish(project.id, 'Read invoice', definition([
      { id: 'start', type: 'start', name: 'Start', next: 'ocr' },
      { id: 'ocr', type: 'ocr_extract', name: 'OCR', config: { path: '{{input.file}}', language: 'eng' }, next: 'fields' },
      { id: 'fields', type: 'extract_document_fields', name: 'Fields', config: { source: '{{steps.ocr}}', documentType: 'invoice' }, next: 'end' },
      { id: 'end', type: 'end', name: 'End', config: { summaryFrom: ['fields'] } },
    ]));
    for (const file of [image.body.data.path, scan.body.data.path]) {
      const job = await run(workflowId, { file });
      await processNextNativeJob(pool, cfg, 'ocr-worker');
      const detail = await jobDetail(job.id);
      expect(detail.errorSummary).toBe(null);
      expect(detail.status).toBe('SUCCEEDED');
      expect(stepOutput(detail, 'ocr').confidence).toBeGreaterThan(70);
      const fields = stepOutput(detail, 'fields');
      expect(fields.values).toMatchObject({ invoiceNumber: 'INV-2026-0042', invoiceDate: '2026-09-15', totalAmount: 11800, taxAmount: 1800 });
      expect(fields.fields.totalAmount.confidence).toBeGreaterThan(0.5);
      expect(detail.artifacts).toHaveLength(0);
    }
  });
});

describe('Action Center', () => {
  it('suspends a job on a form task, lets a user complete it, and resumes the job', async () => {
    const project = await createProject('Approvals');
    await addMember(project.id, operator, 'operator');
    await addMember(project.id, viewer, 'viewer');
    const workflowId = await publish(project.id, 'Approve invoice', definition([
      { id: 'start', type: 'start', name: 'Start', next: 'approve' },
      {
        id: 'approve', type: 'create_task', name: 'Approve',
        config: {
          taskType: 'approval', title: 'Approve invoice {{input.invoice}}', priority: 'high', data: { amount: '{{input.amount}}' },
          formFields: [{ name: 'approvedAmount', label: 'Approved amount', type: 'number', required: true }],
          outcomes: ['approve', 'reject'], requireCommentOnReject: true, assignedRole: 'operator',
        },
        next: 'end',
      },
      { id: 'end', type: 'end', name: 'End', config: { summaryFrom: ['approve'] } },
    ]));
    const job = await run(workflowId, { invoice: 'INV-9', amount: 1200 });
    const suspended = await processNextNativeJob(pool, cfg, 'task-worker');
    expect(suspended.status).toBe('SUSPENDED');
    expect(await processNextNativeJob(pool, cfg, 'task-worker')).toBe(null);

    const list = await request(app).get('/api/tasks').query({ mine: 'true' }).set(as(operator));
    const task = list.body.data.find((item) => item.jobId === job.id);
    expect(task).toMatchObject({ title: 'Approve invoice INV-9', priority: 'high', status: 'pending', canComplete: true, data: { amount: 1200 } });
    expect((await request(app).get('/api/tasks/summary').set(as(operator))).body.data.pending).toBeGreaterThanOrEqual(1);
    expect((await request(app).post(`/api/tasks/${task.id}/complete`).set(as(viewer)).send({ outcome: 'approve' })).status).toBe(403);
    expect((await request(app).post(`/api/tasks/${task.id}/complete`).set(as(operator)).send({ outcome: 'approve', data: {} })).status).toBe(400);
    expect((await request(app).post(`/api/tasks/${task.id}/complete`).set(as(operator)).send({ outcome: 'reject', data: { approvedAmount: 0 } })).status).toBe(400);
    const assigned = await request(app).post(`/api/tasks/${task.id}/assign`).set(as(operator)).send({});
    expect(assigned.body.data.assignedUserId).toBe(operator.id);
    const done = await request(app).post(`/api/tasks/${task.id}/complete`).set(as(operator)).send({ outcome: 'approve', data: { approvedAmount: '1100' }, comment: 'ok' });
    expect(done.status).toBe(200);
    expect(done.body.data.resumedJobId).toBe(job.id);
    expect((await request(app).post(`/api/tasks/${task.id}/complete`).set(as(operator)).send({ outcome: 'approve', data: { approvedAmount: 1 } })).status).toBe(409);

    const resumed = await processNextNativeJob(pool, cfg, 'task-worker');
    expect(resumed.id).toBe(job.id);
    const detail = await jobDetail(job.id);
    expect(detail.status).toBe('SUCCEEDED');
    expect(detail.attempts).toHaveLength(1);
    expect(stepOutput(detail, 'approve')).toMatchObject({ outcome: 'approve', data: { approvedAmount: 1100 }, comment: 'ok', completedBy: operator.email });
    const output = typeof detail.attempts[0].output_json === 'string' ? JSON.parse(detail.attempts[0].output_json) : detail.attempts[0].output_json;
    expect(JSON.stringify(output)).toContain('1100');
  });

  it('cancels the open task when a suspended job is cancelled', async () => {
    const project = await createProject('Cancel approvals');
    const workflowId = await publish(project.id, 'Review', definition([
      { id: 'start', type: 'start', name: 'Start', next: 'review' },
      { id: 'review', type: 'create_task', name: 'Review', config: { taskType: 'validation', title: 'Check data' }, next: 'end' },
      { id: 'end', type: 'end', name: 'End' },
    ]));
    const job = await run(workflowId);
    await processNextNativeJob(pool, cfg, 'task-worker');
    const cancelled = await request(app).post(`/api/jobs/${job.id}/cancel`).set(as(admin));
    expect(cancelled.body.data.status).toBe('CANCELLED');
    const tasks = await request(app).get('/api/tasks').query({ status: 'all', jobId: job.id }).set(as(admin));
    expect(tasks.body.data[0].status).toBe('cancelled');
  });
});

describe('HTTP connector options', () => {
  it('sends query, headers, form bodies, and basic auth and returns response headers', async () => {
    const project = await createProject('HTTP options');
    const connectionId = await connection(project.id, 'rest_api', 'Echo', { baseUrl: siteUrl, allowedMethods: ['GET', 'POST'] }, { username: 'svc', password: 'pw' });
    const workflowId = await publish(project.id, 'Echo', definition([
      { id: 'start', type: 'start', name: 'Start', next: 'post' },
      { id: 'post', type: 'http_request', name: 'Post', config: { connectionId, method: 'POST', path: '/api/echo', query: { page: 2 }, headers: { 'X-Trace': 'abc' }, bodyType: 'form', body: { a: '1', b: 'two' } }, next: 'missing' },
      { id: 'missing', type: 'http_request', name: 'Missing', config: { connectionId, method: 'GET', path: '/api/echo/fail', failOnError: false }, next: 'end' },
      { id: 'end', type: 'end', name: 'End', config: { summaryFrom: ['post', 'missing'] } },
    ]));
    const job = await run(workflowId);
    await processNextNativeJob(pool, cfg, 'http-worker');
    const detail = await jobDetail(job.id);
    expect(detail.status).toBe('SUCCEEDED');
    expect(posted[0]).toMatchObject({ method: 'POST', url: '/api/echo?page=2', body: 'a=1&b=two' });
    expect(posted[0].headers).toMatchObject({ 'x-trace': 'abc', 'content-type': 'application/x-www-form-urlencoded', authorization: `Basic ${Buffer.from('svc:pw').toString('base64')}` });
    expect(stepOutput(detail, 'post').headers['x-request-id']).toBe('req-77');
    expect(stepOutput(detail, 'missing')).toMatchObject({ status: 404, ok: false });
  });
});

describe('robot agent', () => {
  it('runs browser steps on the robot and uploads the screenshot as a job artifact', async () => {
    const project = await createProject('Robot web');
    const robot = await request(app).post('/api/robots').set(as(admin)).send({ name: 'Web robot', adapter: 'local_file_handoff', projectIds: [project.id] });
    process.env.ROBOT_TOKEN = robot.body.data.token;
    process.env.API_URL = apiUrl;
    const workflowId = await publish(project.id, 'Robot scrape', definition([
      { id: 'start', type: 'start', name: 'Start', next: 'open' },
      { id: 'open', type: 'browser_open', name: 'Open', config: { url: siteUrl }, next: 'type' },
      { id: 'type', type: 'browser_type', name: 'Type', config: { selector: '#customer', text: 'Robot' }, next: 'orders' },
      { id: 'orders', type: 'browser_extract_table', name: 'Orders', config: { selector: '#orders' }, next: 'shot' },
      { id: 'shot', type: 'browser_screenshot', name: 'Shot', config: { path: 'shots/orders.png' }, next: 'end' },
      { id: 'end', type: 'end', name: 'End', config: { summaryFrom: ['orders'] } },
    ]), 'uipath');
    const job = await run(workflowId);
    const { processInboxOnce } = await import('../src/robotSimulator.js');
    const processed = await processInboxOnce({ log: () => {} });
    expect(processed.find((item) => item.file === `${job.id}.json`)?.status).toBe('SUCCEEDED');
    const detail = await jobDetail(job.id);
    expect(detail.status).toBe('SUCCEEDED');
    expect(detail.robotId).toBe(robot.body.data.id);
    expect(stepOutput(detail, 'orders').count).toBe(2);
    expect(detail.artifacts.map((item) => item.file_name)).toContain('orders.png');

    const blocked = await publish(project.id, 'Robot cannot notify', definition([
      { id: 'start', type: 'start', name: 'Start', next: 'note' },
      { id: 'note', type: 'send_notification', name: 'Note', config: { channel: 'in_app', message: 'hi' }, next: 'end' },
      { id: 'end', type: 'end', name: 'End' },
    ]), 'uipath');
    const second = await run(blocked);
    await processInboxOnce({ log: () => {} });
    const failed = await jobDetail(second.id);
    expect(failed.status).toBe('FAILED');
    expect(failed.attempts[0].error_code).toBe('ROBOT_UNSUPPORTED');
  });
});
