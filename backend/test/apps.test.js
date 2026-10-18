// Apps: definition rules and bindings, CRUD, roles and project scoping, publish validation, access
// settings (project / tenant / roles / users), the runtime (data sources, actions that run
// workflows, flows, queue items, tasks, REST calls, agents), result polling, uploads, and audit.
import crypto from 'node:crypto';
import http from 'node:http';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { loadConfig } from '../src/config.js';
import { createPool } from '../src/db/pool.js';
import { createApp } from '../src/http/createApp.js';
import { hashPassword } from '../src/lib/passwords.js';
import { processNextNativeJob } from '../src/services/jobService.js';
import { advanceAgentRun } from '../src/agent/runtime.js';
import {
  canOpenApp, emptyDefinition, evaluateCondition, newAction, newComponent, newDataSource, renderMapping, renderTemplate,
  validateAppDefinition, validateFieldValue,
} from '../src/app/definition.js';

const base = loadConfig();
const cfg = { ...base, ai: { provider: 'mock', model: 'mock-1', apiKey: '', baseUrl: '', apiVersion: '', allowMock: true, requestTimeoutMs: 5000 } };
const pool = createPool(base.databaseUrl);
const app = createApp({ pool, config: cfg });
const tenantId = '00000000-0000-4000-8000-000000000001';
const PASSWORD = 'Apps-pass-1234';
let admin;
let developer;
let operator;
let viewer;
let outsider;
let project;
let workflowId;
let draftWorkflowId;
let flowId;
let queueId;
let agentId;
let connectionId;
let server;
const received = [];

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
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function workflow(name, publish = true) {
  const created = await request(app).post('/api/workflows').set(as(admin)).send({ projectId: project.id, name });
  const id = created.body.data.id;
  const draft = await request(app).post(`/api/workflows/${id}/draft`).set(as(admin)).send({ definition: { schemaVersion: '1.0', retryPolicy: { maxAttempts: 1, backoffSeconds: 0 }, steps: [
    { id: 'start', type: 'start', name: 'Start', next: 'log' },
    { id: 'log', type: 'log_message', name: 'Log', config: { level: 'info', message: 'Scored {{input.invoiceId}} for {{input.amount}}' }, next: 'end' },
    { id: 'end', type: 'end', name: 'End', config: { summaryFrom: ['log'] } },
  ] } });
  expect(draft.body.data.validation.errors).toEqual([]);
  if (publish) expect((await request(app).post(`/api/workflows/${id}/publish`).set(as(admin))).status).toBe(200);
  return id;
}

function intakeDefinition() {
  const definition = emptyDefinition('Invoice intake');
  const form = newComponent('form', ['heading1', 'text1']);
  form.props.title = 'New invoice';
  form.children = [
    { ...newComponent('text_input', []), id: 'invoice1', props: { ...newComponent('text_input', []).props, name: 'invoiceId', label: 'Invoice number', required: true, pattern: 'INV-[0-9]+', patternMessage: 'Use INV-123' } },
    { ...newComponent('number', ['text1']), id: 'amount1', props: { ...newComponent('number', []).props, name: 'amount', label: 'Amount', min: 1 } },
  ];
  form.events.onSubmit = [
    { ...newAction('run_workflow'), id: 'run', config: { workflowId, inputs: [{ key: 'invoiceId', value: '{{inputs.invoiceId}}' }, { key: 'amount', value: '{{inputs.amount}}' }], wait: true, timeoutSeconds: 60 }, resultVar: 'score' },
    { ...newAction('show_toast'), id: 'toast', config: { message: 'Scored {{inputs.invoiceId}}', tone: 'success' } },
  ];
  const queueButton = { ...newComponent('button', []), id: 'queueButton', props: { label: 'Queue it', variant: 'secondary' }, events: { onClick: [
    { id: 'q', type: 'add_queue_item', config: { queueId, reference: '{{inputs.invoiceId}}', content: [{ key: 'invoiceId', value: '{{inputs.invoiceId}}' }], priority: 'high' } },
    { id: 't', type: 'create_task', config: { title: 'Check invoice', description: 'From the app', priority: 'high', assignedRole: 'operator', data: [{ key: 'invoiceId', value: '' }] } },
    { id: 'f', type: 'start_flow', config: { flowId, inputs: [{ key: 'invoiceId', value: '' }] } },
    { id: 'h', type: 'call_http', config: { connectionId, method: 'POST', path: '/invoices/{{inputs.invoiceId}}', query: [{ key: 'source', value: 'app' }], body: [{ key: 'amount', value: '' }] } },
    { id: 'hf', type: 'call_http', config: { connectionId, method: 'GET', path: '/health', query: [], body: [] } },
    { id: 'ag', type: 'run_agent', config: { agentId, inputs: [], message: 'Hello from {{app.user.name}}' } },
  ] } };
  const table = { ...newComponent('table', []), props: { title: 'Recent jobs', rows: '{{data.recentJobs.rows}}', columns: [{ key: 'workflow', label: 'Workflow', format: 'text' }, { key: 'status', label: 'Status', format: 'status' }], pageSize: 10, emptyText: 'None' } };
  const chat = { ...newComponent('agent_chat', []), props: { agentId, title: 'Ask', placeholder: '', height: 300 } };
  definition.pages[0].components.push(form, queueButton, table, chat);
  definition.dataSources = [{ ...newDataSource('jobs'), config: { workflowId, status: '', limit: 5 } }, newDataSource('queue_items', [{ id: 'ds1', name: 'recentJobs' }])];
  return definition;
}

async function createAppWith(definition, user = admin) {
  const created = await request(app).post('/api/apps').set(as(user)).send({ projectId: project.id, name: 'Invoice intake' });
  expect(created.status, JSON.stringify(created.body)).toBe(201);
  const saved = await request(app).put(`/api/apps/${created.body.data.id}/draft`).set(as(user)).send({ definition });
  expect(saved.status, JSON.stringify(saved.body)).toBe(200);
  return saved.body.data;
}

async function pollAgent(appId, user, runId) {
  for (let i = 0; i < 80; i += 1) {
    await advanceAgentRun(pool, cfg, runId);
    const polled = await request(app).get(`/api/apps/${appId}/runtime/runs/agent_run/${runId}`).set(as(user));
    if (polled.body.data.done) return polled.body.data;
    await sleep(100);
  }
  throw new Error('agent run did not finish');
}

const action = (appId, user, componentId, event, actionId, values = {}, preview = false) => request(app).post(`/api/apps/${appId}/runtime/actions`).set(as(user)).send({ componentId, event, actionId, values, preview });

beforeAll(async () => {
  const stamp = Date.now();
  admin = await createUser(`apps-admin-${stamp}@urap.test`, 'administrator');
  developer = await createUser(`apps-dev-${stamp}@urap.test`, 'automation_developer');
  operator = await createUser(`apps-operator-${stamp}@urap.test`, 'operator');
  viewer = await createUser(`apps-viewer-${stamp}@urap.test`, 'viewer');
  outsider = await createUser(`apps-outsider-${stamp}@urap.test`, 'viewer');
  project = (await request(app).post('/api/projects').set(as(admin)).send({ name: 'App project', description: 'apps', category: 'general' })).body.data;
  for (const [user, role] of [[developer, 'automation_developer'], [operator, 'operator'], [viewer, 'viewer']]) {
    expect((await request(app).post(`/api/projects/${project.id}/members`).set(as(admin)).send({ userId: user.id, role })).status).toBe(201);
  }
  workflowId = await workflow('Score invoice');
  draftWorkflowId = await workflow('Not yet published', false);
  const flow = await request(app).post('/api/flows').set(as(admin)).send({ projectId: project.id, name: 'Intake flow' });
  flowId = flow.body.data.id;
  await request(app).put(`/api/flows/${flowId}/draft`).set(as(admin)).send({ definition: {
    variables: [{ name: 'invoiceId', defaultValue: '' }],
    nodes: [{ id: 'start', type: 'start', name: 'Start', x: 0, y: 0, config: { trigger: 'manual' } }, { id: 'end', type: 'end', name: 'End', x: 1, y: 0, config: {} }],
    edges: [{ id: 'e1', from: 'start', to: 'end' }],
  } });
  expect((await request(app).post(`/api/flows/${flowId}/publish`).set(as(admin))).status).toBe(200);
  queueId = (await request(app).post('/api/queues').set(as(admin)).send({ projectId: project.id, name: 'App intake' })).body.data.id;
  const agent = await request(app).post('/api/agents').set(as(admin)).send({ projectId: project.id, name: 'Helper', agentType: 'conversational' });
  agentId = agent.body.data.id;
  expect((await request(app).post(`/api/agents/${agentId}/publish`).set(as(admin))).status).toBe(200);
  server = http.createServer((req, res) => {
    let body = '';
    req.on('data', (chunk) => { body += chunk; });
    req.on('end', () => {
      received.push({ method: req.method, url: req.url, body });
      res.setHeader('content-type', 'application/json');
      res.end(JSON.stringify(req.url.startsWith('/health') ? [{ id: 1, name: 'ok' }] : { accepted: true }));
    });
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const connection = await request(app).post(`/api/projects/${project.id}/connections`).set(as(admin)).send({ connectorType: 'rest_api', name: 'Invoices API', config: { baseUrl: `http://127.0.0.1:${server.address().port}` } });
  expect(connection.status, JSON.stringify(connection.body)).toBe(201);
  connectionId = connection.body.data.id;
});

afterAll(async () => {
  await sleep(300);
  server?.close();
  await pool.end();
});

describe('app definitions', () => {
  it('renders bindings, conditions, and field validation', () => {
    const context = { app: { user: { name: 'Ana' } }, inputs: { amount: 12 }, data: { jobs: { rows: [{ status: 'SUCCEEDED' }] } }, vars: { result: null } };
    expect(renderTemplate('Hi {{app.user.name}}', context)).toBe('Hi Ana');
    expect(renderTemplate('{{data.jobs.rows}}', context)).toEqual([{ status: 'SUCCEEDED' }]);
    expect(renderTemplate('{{data.jobs.rows[0].status}}', context)).toBe('SUCCEEDED');
    expect(renderTemplate('{{constructor.prototype}}', context)).toBeUndefined();
    expect(renderMapping([{ key: 'amount', value: '{{inputs.amount}}' }, { key: 'bad key', value: 'x' }], context)).toEqual({ amount: 12 });
    expect(evaluateCondition({ path: 'vars.result', op: 'truthy' }, context)).toBe(false);
    expect(evaluateCondition({ path: '{{inputs.amount}}', op: 'gt', value: '10' }, context)).toBe(true);
    const field = { type: 'text_input', props: { label: 'Invoice', required: true, pattern: 'INV-[0-9]+', patternMessage: 'Use INV-123' } };
    expect(validateFieldValue(field, '')).toBe('Invoice is required');
    expect(validateFieldValue(field, 'X')).toBe('Use INV-123');
    expect(validateFieldValue(field, 'INV-7')).toBeNull();
    expect(validateFieldValue({ type: 'number', props: { label: 'Amount', min: 1 } }, 0)).toBe('Amount must be at least 1');
    expect(canOpenApp({ id: 'u', role: 'viewer' }, { access: 'project' }, null)).toBe(false);
    expect(canOpenApp({ id: 'u', role: 'viewer' }, { access: 'tenant' }, null)).toBe(true);
    expect(canOpenApp({ id: 'u', role: 'viewer' }, { access: 'roles', roles: ['operator'] }, 'viewer')).toBe(false);
    expect(canOpenApp({ id: 'u', role: 'viewer' }, { access: 'users', userIds: ['u'] }, null)).toBe(true);
  });

  it('validates structure and references', () => {
    expect(validateAppDefinition(emptyDefinition('x')).errors).toEqual([]);
    const definition = emptyDefinition('x');
    const form = newComponent('form', []);
    form.children = [newComponent('card', []), { ...newComponent('text_input', []), props: { ...newComponent('text_input', []).props, name: '1bad' } }];
    form.events.onSubmit = [{ id: 'a1', type: 'navigate', config: { pageId: 'nowhere' } }, { id: 'a2', type: 'run_workflow', config: { workflowId: 'w1', inputs: [] } }];
    definition.pages[0].components.push(form, { ...newComponent('table', []), props: { rows: '{{data.missing.rows}}', columns: [] } });
    const lookups = { workflows: new Map([['w1', { name: 'Draft wf', status: 'draft' }]]), flows: new Map(), agents: new Map(), queues: new Map(), connections: new Map() };
    const { errors, warnings } = validateAppDefinition(definition, lookups);
    const messages = errors.map((item) => item.message);
    expect(messages.some((m) => m.includes('cannot be placed inside'))).toBe(true);
    expect(messages.some((m) => m.includes('the field name must start with a letter'))).toBe(true);
    expect(messages.some((m) => m.includes('the page no longer exists'))).toBe(true);
    expect(messages.some((m) => m.includes('Draft wf must be published before the app can run it'))).toBe(true);
    expect(warnings.some((item) => item.message.includes('unknown data source "missing"'))).toBe(true);
  });
});

describe('apps API', () => {
  let intake;

  it('creates, saves, validates, and publishes with role checks and audit', async () => {
    expect((await request(app).post('/api/apps').set(as(viewer)).send({ projectId: project.id, name: 'Nope' })).status).toBe(403);
    expect((await request(app).post('/api/apps').set(as(operator)).send({ projectId: project.id, name: 'Nope' })).status).toBe(403);
    const blocked = intakeDefinition();
    blocked.pages[0].components[2].events.onSubmit[0].config.workflowId = draftWorkflowId;
    const app1 = await createAppWith(blocked, developer);
    expect(app1.status).toBe('draft');
    expect(app1.validation.errors.map((item) => item.message)).toEqual([expect.stringContaining('Not yet published must be published')]);
    const failed = await request(app).post(`/api/apps/${app1.id}/publish`).set(as(developer));
    expect(failed.status).toBe(400);
    expect(failed.body.error.details[0]).toMatchObject({ componentId: 'form1', actionId: 'run', field: 'workflowId' });
    const saved = await request(app).put(`/api/apps/${app1.id}/draft`).set(as(developer)).send({ definition: intakeDefinition() });
    expect(saved.body.data.validation.errors).toEqual([]);
    const published = await request(app).post(`/api/apps/${app1.id}/publish`).set(as(developer));
    expect(published.status, JSON.stringify(published.body)).toBe(200);
    expect(published.body.data).toMatchObject({ status: 'published', versionNumber: 1, settings: { access: 'project' } });
    intake = published.body.data;
    expect((await request(app).get(`/api/apps/${intake.id}`).set(as(outsider))).status).toBe(403);
    const list = await request(app).get(`/api/apps?projectId=${project.id}`).set(as(viewer));
    expect(list.body.data.map((item) => item.id)).toContain(intake.id);
    const [audit] = await pool.query(`SELECT action FROM audit_logs WHERE entity_id = ? ORDER BY created_at`, [intake.id]);
    expect(audit.map((row) => row.action)).toEqual(expect.arrayContaining(['app.create', 'app.save_draft', 'app.publish']));
  });

  it('enforces access settings for the runtime', async () => {
    const runtime = (user, preview = false) => request(app).get(`/api/apps/${intake.id}/runtime${preview ? '?preview=1' : ''}`).set(as(user));
    expect((await runtime(viewer)).status).toBe(200);
    const denied = await runtime(outsider);
    expect(denied.status).toBe(403);
    expect(denied.body.error.code).toBe('APP_ACCESS_DENIED');
    expect((await runtime(viewer, true)).status).toBe(403);
    expect((await runtime(developer, true)).body.data.preview).toBe(true);
    expect((await request(app).put(`/api/apps/${intake.id}/settings`).set(as(operator)).send({ settings: { access: 'tenant' } })).status).toBe(403);
    expect((await request(app).put(`/api/apps/${intake.id}/settings`).set(as(admin)).send({ settings: { access: 'roles', roles: [] } })).status).toBe(400);
    expect((await request(app).put(`/api/apps/${intake.id}/settings`).set(as(admin)).send({ settings: { access: 'users', userIds: [crypto.randomUUID()] } })).status).toBe(400);
    await request(app).put(`/api/apps/${intake.id}/settings`).set(as(admin)).send({ settings: { access: 'tenant' } });
    const opened = await runtime(outsider);
    expect(opened.status).toBe(200);
    expect(opened.body.data).toMatchObject({ app: { name: 'Invoice intake', versionNumber: 1 }, user: { id: outsider.id }, canEdit: false });
    expect((await request(app).get('/api/apps/available').set(as(outsider))).body.data.map((item) => item.id)).toContain(intake.id);
    await request(app).put(`/api/apps/${intake.id}/settings`).set(as(admin)).send({ settings: { access: 'roles', roles: ['operator'] } });
    expect((await runtime(outsider)).status).toBe(403);
    expect((await runtime(operator)).status).toBe(200);
    await request(app).put(`/api/apps/${intake.id}/settings`).set(as(admin)).send({ settings: { access: 'users', userIds: [outsider.id] } });
    expect((await runtime(outsider)).status).toBe(200);
    expect((await runtime(operator)).status).toBe(403);
    expect((await request(app).post(`/api/apps/${intake.id}/disable`).set(as(admin))).status).toBe(200);
    expect((await runtime(outsider)).body.error.code).toBe('APP_DISABLED');
    expect((await request(app).post(`/api/apps/${intake.id}/enable`).set(as(admin))).status).toBe(200);
  });

  it('runs a workflow from a form submit and returns the result', async () => {
    const bad = await action(intake.id, outsider, 'form1', 'onSubmit', 'nope');
    expect(bad.status).toBe(404);
    const toast = await action(intake.id, outsider, 'form1', 'onSubmit', 'toast');
    expect(toast.status).toBe(400);
    const started = await action(intake.id, outsider, 'form1', 'onSubmit', 'run', { inputs: { invoiceId: 'INV-42', amount: 120, injected: 'x' } });
    expect(started.status, JSON.stringify(started.body)).toBe(200);
    expect(started.body.data).toMatchObject({ kind: 'job', status: 'QUEUED', done: false });
    const [jobs] = await pool.query(`SELECT trigger_source, app_id, input_json, created_by FROM automation_jobs WHERE id = ?`, [started.body.data.id]);
    expect(jobs[0]).toMatchObject({ trigger_source: 'app', app_id: intake.id, created_by: outsider.id });
    expect(typeof jobs[0].input_json === 'string' ? JSON.parse(jobs[0].input_json) : jobs[0].input_json).toEqual({ invoiceId: 'INV-42', amount: 120 });
    expect((await processNextNativeJob(pool, cfg, 'app-worker')).status).toBe('SUCCEEDED');
    const polled = await request(app).get(`/api/apps/${intake.id}/runtime/runs/job/${started.body.data.id}`).set(as(outsider));
    expect(polled.body.data).toMatchObject({ status: 'SUCCEEDED', done: true });
    expect(JSON.stringify(polled.body.data.output)).toContain('Scored INV-42 for 120');
    expect((await request(app).get(`/api/apps/${intake.id}/runtime/runs/job/${started.body.data.id}`).set(as(operator))).status).toBe(403);
    const data = await request(app).post(`/api/apps/${intake.id}/runtime/data/ds1`).set(as(outsider)).send({});
    expect(data.status, JSON.stringify(data.body)).toBe(200);
    expect(data.body.data.rows[0]).toMatchObject({ id: started.body.data.id, workflow: 'Score invoice', status: 'SUCCEEDED', triggerSource: 'app' });
    const [audit] = await pool.query(`SELECT metadata_json FROM audit_logs WHERE action = 'app.action' AND entity_id = ? AND actor_user_id = ?`, [intake.id, outsider.id]);
    expect(audit.length).toBe(1);
  });

  it('adds queue items, creates tasks, starts flows, calls REST, and runs agents', async () => {
    const queued = await action(intake.id, outsider, 'queueButton', 'onClick', 'q', { reference: 'INV-9', content: { invoiceId: 'INV-9', extra: 1 } });
    expect(queued.body.data).toMatchObject({ kind: 'queue_item', status: 'NEW', done: true });
    const [items] = await pool.query(`SELECT specific_content_json, app_id, priority FROM queue_items WHERE id = ?`, [queued.body.data.id]);
    expect(items[0].app_id).toBe(intake.id);
    expect(typeof items[0].specific_content_json === 'string' ? JSON.parse(items[0].specific_content_json) : items[0].specific_content_json).toEqual({ invoiceId: 'INV-9' });
    const queueData = await request(app).post(`/api/apps/${intake.id}/runtime/data/ds2`).set(as(outsider)).send({});
    expect(queueData.body.data.rows[0]).toMatchObject({ reference: 'INV-9', queue: 'App intake', status: 'NEW' });
    const task = await action(intake.id, outsider, 'queueButton', 'onClick', 't', { title: 'Check INV-9', data: { invoiceId: 'INV-9' } });
    expect(task.body.data).toMatchObject({ kind: 'task', status: 'pending' });
    const [tasks] = await pool.query(`SELECT title, app_id, assigned_role, priority FROM action_tasks WHERE id = ?`, [task.body.data.id]);
    expect(tasks[0]).toMatchObject({ title: 'Check INV-9', app_id: intake.id, assigned_role: 'operator', priority: 'high' });
    const flowRun = await action(intake.id, outsider, 'queueButton', 'onClick', 'f', { inputs: { invoiceId: 'INV-9' } });
    expect(flowRun.body.data).toMatchObject({ kind: 'flow_run', status: 'SUCCEEDED', done: true });
    expect(flowRun.body.data.output.invoiceId).toBe('INV-9');
    const rest = await action(intake.id, outsider, 'queueButton', 'onClick', 'h', { path: '/invoices/INV-9', query: { source: 'app' }, body: { amount: 5 } });
    expect(rest.status, JSON.stringify(rest.body)).toBe(200);
    expect(rest.body.data).toMatchObject({ kind: 'http', status: 200, done: true });
    expect(received.at(-1)).toMatchObject({ method: 'POST', url: '/invoices/INV-9?source=app' });
    expect(JSON.parse(received.at(-1).body)).toEqual({ amount: 5 });
    expect((await action(intake.id, outsider, 'queueButton', 'onClick', 'h', { path: '/other/x' })).status).toBe(400);
    expect((await action(intake.id, outsider, 'queueButton', 'onClick', 'h', { path: '/invoices/../admin' })).status).toBe(400);
    expect((await action(intake.id, outsider, 'queueButton', 'onClick', 'hf', { path: '/health/x' })).status).toBe(400);
    const agentRun = await action(intake.id, outsider, 'queueButton', 'onClick', 'ag', { message: 'Hello from outsider' });
    expect(agentRun.body.data).toMatchObject({ kind: 'agent_run' });
    const polled = await pollAgent(intake.id, outsider, agentRun.body.data.id);
    expect(polled).toMatchObject({ status: 'IDLE', done: true });
    expect(polled.messages.at(-1).content).toContain('You said: Hello from outsider');
  });

  it('chats with an agent from the agent chat component and accepts uploads', async () => {
    const first = await request(app).post(`/api/apps/${intake.id}/runtime/agent-chat`).set(as(outsider)).send({ componentId: 'agentChat1', message: 'Where is INV-9?' });
    expect(first.status, JSON.stringify(first.body)).toBe(200);
    const runId = first.body.data.id;
    let polled = await pollAgent(intake.id, outsider, runId);
    expect(polled.messages.map((m) => m.role)).toEqual(['assistant', 'user', 'assistant']);
    const second = await request(app).post(`/api/apps/${intake.id}/runtime/agent-chat`).set(as(outsider)).send({ componentId: 'agentChat1', message: 'Thanks', runId });
    expect(second.status).toBe(200);
    await sleep(50);
    polled = await pollAgent(intake.id, outsider, runId);
    expect(polled.messages.at(-1).content).toBe('You said: Thanks');
    expect((await request(app).post(`/api/apps/${intake.id}/runtime/agent-chat`).set(as(outsider)).send({ componentId: 'form1', message: 'x' })).status).toBe(404);
    const upload = await request(app).post(`/api/apps/${intake.id}/runtime/files`).set(as(outsider)).attach('file', Buffer.from('a,b\n1,2\n'), 'invoice.csv');
    expect(upload.status, JSON.stringify(upload.body)).toBe(201);
    expect(upload.body.data).toMatchObject({ fileName: 'invoice.csv', size: 8 });
    expect((await request(app).post(`/api/apps/${intake.id}/runtime/files`).set(as(outsider)).attach('file', Buffer.from('nope'), 'fake.pdf')).status).toBe(400);
  });

  it('runs actions from the draft in preview for builders only', async () => {
    const draft = intakeDefinition();
    draft.pages[0].components[3].events.onClick.push({ id: 'new', type: 'create_task', config: { title: 'Draft only', priority: 'low', data: [] } });
    await request(app).put(`/api/apps/${intake.id}/draft`).set(as(developer)).send({ definition: draft });
    expect((await action(intake.id, outsider, 'queueButton', 'onClick', 'new', {}, false)).status).toBe(404);
    expect((await action(intake.id, outsider, 'queueButton', 'onClick', 'new', {}, true)).status).toBe(403);
    const preview = await action(intake.id, developer, 'queueButton', 'onClick', 'new', {}, true);
    expect(preview.body.data).toMatchObject({ kind: 'task' });
  });
});
