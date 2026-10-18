// Flows: API (draft, validation, publish, run, cancel, retry, webhook, permissions) and the
// engine (robot -> human -> decision -> end, parallel/join with a timer, failure and retry).
import crypto from 'node:crypto';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { loadConfig } from '../src/config.js';
import { createPool } from '../src/db/pool.js';
import { createApp } from '../src/http/createApp.js';
import { hashPassword } from '../src/lib/passwords.js';
import { processNextNativeJob } from '../src/services/jobService.js';
import { advanceFlows } from '../src/flow/engine.js';
import { validateDefinition } from '../src/flow/definition.js';

const cfg = loadConfig();
const pool = createPool(cfg.databaseUrl);
const app = createApp({ pool, config: cfg });
const tenantId = '00000000-0000-4000-8000-000000000001';
const PASSWORD = 'Flows-pass-1234';
let admin;
let viewer;
let project;
let scoreWorkflow;
let failingWorkflow;

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

async function publishWorkflow(projectId, name, steps) {
  const created = await request(app).post('/api/workflows').set(as(admin)).send({ projectId, name });
  const draft = await request(app).post(`/api/workflows/${created.body.data.id}/draft`).set(as(admin)).send({ definition: { schemaVersion: '1.0', retryPolicy: { maxAttempts: 1, backoffSeconds: 0 }, steps } });
  expect(draft.body.data.validation.errors).toEqual([]);
  expect((await request(app).post(`/api/workflows/${created.body.data.id}/publish`).set(as(admin))).status).toBe(200);
  return created.body.data.id;
}

async function createFlow(name, definition) {
  const created = await request(app).post('/api/flows').set(as(admin)).send({ projectId: project.id, name });
  expect(created.status).toBe(201);
  const saved = await request(app).put(`/api/flows/${created.body.data.id}/draft`).set(as(admin)).send({ definition });
  expect(saved.status).toBe(200);
  return saved.body.data;
}

async function publishFlow(id) {
  const published = await request(app).post(`/api/flows/${id}/publish`).set(as(admin));
  expect(published.status, JSON.stringify(published.body)).toBe(200);
  return published.body.data;
}

async function runDetail(id) {
  const response = await request(app).get(`/api/flow-runs/${id}`).set(as(admin));
  expect(response.status).toBe(200);
  return response.body.data;
}

const nodeStatus = (detail, nodeId) => detail.nodes.filter((node) => node.nodeId === nodeId).at(-1)?.status;

function approvalFlow(workflowId) {
  return {
    variables: [{ name: 'amount', defaultValue: 0 }],
    nodes: [
      { id: 'start', type: 'start', name: 'Start', x: 0, y: 0, config: { trigger: 'manual' } },
      { id: 'score', type: 'robot', name: 'Score invoice', x: 1, y: 0, config: { workflowId, input: { amount: '{{vars.amount}}' }, outputVar: 'score' } },
      { id: 'review', type: 'human', name: 'Manager review', x: 2, y: 0, config: { title: 'Approve invoice of {{vars.amount}}', taskType: 'approval', outputVar: 'review', data: { amount: '{{vars.amount}}' } } },
      { id: 'gate', type: 'decision', name: 'Approved?', x: 3, y: 0, config: {} },
      { id: 'pay', type: 'end', name: 'Paid', x: 4, y: 0, config: {} },
      { id: 'stop', type: 'end', name: 'Rejected', x: 4, y: 1, config: {} },
    ],
    edges: [
      { id: 'e1', from: 'start', to: 'score' },
      { id: 'e2', from: 'score', to: 'review' },
      { id: 'e3', from: 'review', to: 'gate' },
      { id: 'e4', from: 'gate', to: 'pay', label: 'Approved', condition: { left: 'vars.review.outcome', op: 'eq', right: 'approve' } },
      { id: 'e5', from: 'gate', to: 'stop', label: 'Rejected', isDefault: true },
    ],
  };
}

beforeAll(async () => {
  admin = await createUser(`flows-admin-${Date.now()}@urap.test`, 'administrator');
  viewer = await createUser(`flows-viewer-${Date.now()}@urap.test`, 'viewer');
  const created = await request(app).post('/api/projects').set(as(admin)).send({ name: 'Flow project', description: 'flows', category: 'general' });
  project = created.body.data;
  scoreWorkflow = await publishWorkflow(project.id, 'Score invoice', [
    { id: 'start', type: 'start', name: 'Start', next: 'log' },
    { id: 'log', type: 'log_message', name: 'Log', config: { level: 'info', message: 'Scored {{input.amount}}' }, next: 'end' },
    { id: 'end', type: 'end', name: 'End', config: { summaryFrom: ['log'] } },
  ]);
  failingWorkflow = await publishWorkflow(project.id, 'Broken step', [
    { id: 'start', type: 'start', name: 'Start', next: 'read' },
    { id: 'read', type: 'read_csv', name: 'Read missing file', config: { path: 'missing/nothing-here.csv' }, next: 'end' },
    { id: 'end', type: 'end', name: 'End', config: {} },
  ]);
});

afterAll(async () => {
  await pool.end();
});

describe('flow definition validation', () => {
  it('reports structural problems and accepts a valid graph', () => {
    expect(validateDefinition(approvalFlow('w')).errors).toEqual([]);
    const broken = approvalFlow('');
    broken.edges = broken.edges.filter((edge) => edge.id !== 'e5');
    broken.edges.push({ id: 'loop', from: 'review', to: 'score' });
    const messages = validateDefinition(broken).errors.map((item) => item.message);
    expect(messages).toContain('Score invoice: choose the workflow the robot runs');
    expect(messages.some((message) => message.includes('needs at least two outgoing branches'))).toBe(true);
    expect(messages.some((message) => message.includes('exactly one outgoing'))).toBe(true);
    expect(validateDefinition({ nodes: [], edges: [] }).errors.map((item) => item.message)).toEqual(['Add a Start step', 'Add an End step']);
  });
});

describe('flows API and engine', () => {
  it('runs robot -> human -> decision -> end and records history', async () => {
    const flow = await createFlow('Invoice approval', approvalFlow(scoreWorkflow));
    expect(flow.validation.errors).toEqual([]);
    expect(flow.status).toBe('draft');
    const notYet = await request(app).post(`/api/flows/${flow.id}/run`).set(as(admin)).send({});
    expect(notYet.status).toBe(409);
    const published = await publishFlow(flow.id);
    expect(published.status).toBe('published');
    expect(published.versionNumber).toBe(1);

    const started = await request(app).post(`/api/flows/${flow.id}/run`).set(as(admin)).send({ input: { amount: 120 } });
    expect(started.status).toBe(202);
    const runId = started.body.data.id;
    let detail = await runDetail(runId);
    expect(detail.status).toBe('RUNNING');
    expect(nodeStatus(detail, 'start')).toBe('SUCCEEDED');
    expect(nodeStatus(detail, 'score')).toBe('WAITING');
    const jobId = detail.nodes.find((node) => node.nodeId === 'score').jobId;
    const [[job]] = await pool.query(`SELECT trigger_source, flow_run_id, input_json FROM automation_jobs WHERE id = ?`, [jobId]);
    expect(job.trigger_source).toBe('flow');
    expect(job.flow_run_id).toBe(runId);
    expect((typeof job.input_json === 'string' ? JSON.parse(job.input_json) : job.input_json).amount).toBe(120);

    expect((await processNextNativeJob(pool, cfg, 'flow-worker')).status).toBe('SUCCEEDED');
    await advanceFlows(pool, cfg);
    detail = await runDetail(runId);
    expect(nodeStatus(detail, 'score')).toBe('SUCCEEDED');
    expect(nodeStatus(detail, 'review')).toBe('WAITING');
    expect(detail.variables.score).toBeTruthy();

    const tasks = await request(app).get(`/api/tasks?status=pending&projectId=${project.id}`).set(as(admin));
    const task = tasks.body.data.find((item) => item.flowRunId === runId);
    expect(task.title).toBe('Approve invoice of 120');
    expect(task.data.amount).toBe(120);
    const completed = await request(app).post(`/api/tasks/${task.id}/complete`).set(as(admin)).send({ outcome: 'approve', comment: 'ok' });
    expect(completed.status).toBe(200);

    detail = await runDetail(runId);
    expect(detail.status).toBe('SUCCEEDED');
    expect(nodeStatus(detail, 'pay')).toBe('SUCCEEDED');
    expect(nodeStatus(detail, 'stop')).toBeUndefined();
    expect(detail.variables.review.outcome).toBe('approve');
    expect(detail.events.map((item) => item.event)).toEqual(expect.arrayContaining(['run.started', 'node.waiting', 'node.succeeded', 'run.succeeded']));
    expect(detail.definition.nodes).toHaveLength(6);

    const list = await request(app).get(`/api/flows?projectId=${project.id}`).set(as(admin));
    expect(list.body.data.find((item) => item.id === flow.id).lastRun.status).toBe('SUCCEEDED');
    const runs = await request(app).get(`/api/flow-runs?flowId=${flow.id}`).set(as(admin));
    expect(runs.body.meta.total).toBe(1);
    const [audit] = await pool.query(`SELECT action FROM audit_logs WHERE entity_id IN (?, ?)`, [flow.id, runId]);
    expect(audit.map((row) => row.action)).toEqual(expect.arrayContaining(['flow.create', 'flow.save_draft', 'flow.publish', 'flow.run']));
  });

  it('takes the default branch on reject', async () => {
    const flow = await createFlow('Invoice approval 2', approvalFlow(scoreWorkflow));
    await publishFlow(flow.id);
    const runId = (await request(app).post(`/api/flows/${flow.id}/run`).set(as(admin)).send({ input: { amount: 5 } })).body.data.id;
    await processNextNativeJob(pool, cfg, 'flow-worker');
    await advanceFlows(pool, cfg);
    const taskId = (await runDetail(runId)).nodes.find((node) => node.nodeId === 'review').taskId;
    await request(app).post(`/api/tasks/${taskId}/complete`).set(as(admin)).send({ outcome: 'reject' });
    const detail = await runDetail(runId);
    expect(detail.status).toBe('SUCCEEDED');
    expect(nodeStatus(detail, 'stop')).toBe('SUCCEEDED');
    expect(nodeStatus(detail, 'pay')).toBeUndefined();
  });

  it('blocks publishing an invalid flow with step-level messages', async () => {
    const definition = approvalFlow(crypto.randomUUID());
    const flow = await createFlow('Bad flow', definition);
    expect(flow.validation.errors.map((item) => item.message)).toContain('Score invoice: the workflow was not found in this project');
    const published = await request(app).post(`/api/flows/${flow.id}/publish`).set(as(admin));
    expect(published.status).toBe(400);
    expect(published.body.error.details[0].nodeId).toBe('score');
  });

  it('fails the run when a robot job fails, retries it, and cancels it', async () => {
    const flow = await createFlow('Fragile', {
      nodes: [
        { id: 'start', type: 'start', name: 'Start', config: {} },
        { id: 'work', type: 'robot', name: 'Do work', config: { workflowId: failingWorkflow } },
        { id: 'end', type: 'end', name: 'End', config: {} },
      ],
      edges: [{ id: 'a', from: 'start', to: 'work' }, { id: 'b', from: 'work', to: 'end' }],
    });
    await publishFlow(flow.id);
    const runId = (await request(app).post(`/api/flows/${flow.id}/run`).set(as(admin)).send({})).body.data.id;
    expect((await processNextNativeJob(pool, cfg, 'flow-worker')).status).toBe('FAILED');
    await advanceFlows(pool, cfg);
    let detail = await runDetail(runId);
    expect(detail.status).toBe('FAILED');
    expect(detail.error).toContain('Do work');
    expect(nodeStatus(detail, 'work')).toBe('FAILED');

    expect((await request(app).post(`/api/flow-runs/${runId}/retry`).set(as(viewer))).status).toBe(403);
    const retried = await request(app).post(`/api/flow-runs/${runId}/retry`).set(as(admin));
    expect(retried.status).toBe(200);
    expect(retried.body.data.status).toBe('RUNNING');
    detail = await runDetail(runId);
    const newJob = detail.nodes.filter((node) => node.nodeId === 'work').at(-1).jobId;
    expect(newJob).toBeTruthy();

    const cancelled = await request(app).post(`/api/flow-runs/${runId}/cancel`).set(as(admin));
    expect(cancelled.status).toBe(200);
    expect(cancelled.body.data.status).toBe('CANCELLED');
    const [[job]] = await pool.query(`SELECT status FROM automation_jobs WHERE id = ?`, [newJob]);
    expect(job.status).toBe('CANCELLED');
    expect((await request(app).post(`/api/flow-runs/${runId}/cancel`).set(as(admin))).status).toBe(409);
  });

  it('cancelling a run cancels its open Action Center task', async () => {
    const flow = await createFlow('Human only', {
      nodes: [
        { id: 'start', type: 'start', name: 'Start', config: {} },
        { id: 'ask', type: 'human', name: 'Ask', config: { title: 'Fill the form', taskType: 'form', formFields: [{ name: 'reason', label: 'Reason', type: 'text', required: true }] } },
        { id: 'end', type: 'end', name: 'End', config: {} },
      ],
      edges: [{ id: 'a', from: 'start', to: 'ask' }, { id: 'b', from: 'ask', to: 'end' }],
    });
    await publishFlow(flow.id);
    const runId = (await request(app).post(`/api/flows/${flow.id}/run`).set(as(admin)).send({})).body.data.id;
    const taskId = (await runDetail(runId)).nodes.find((node) => node.nodeId === 'ask').taskId;
    await request(app).post(`/api/flow-runs/${runId}/cancel`).set(as(admin));
    const task = await request(app).get(`/api/tasks/${taskId}`).set(as(admin));
    expect(task.body.data.status).toBe('cancelled');
  });

  it('runs parallel branches with a timer and joins them', async () => {
    const flow = await createFlow('Parallel', {
      nodes: [
        { id: 'start', type: 'start', name: 'Start', config: {} },
        { id: 'split', type: 'parallel', name: 'Split', config: {} },
        { id: 'wait', type: 'timer', name: 'Wait', config: { seconds: 1 } },
        { id: 'work', type: 'robot', name: 'Score', config: { workflowId: scoreWorkflow, outputVar: 'scored' } },
        { id: 'join', type: 'join', name: 'Join', config: {} },
        { id: 'end', type: 'end', name: 'End', config: {} },
      ],
      edges: [
        { id: 'a', from: 'start', to: 'split' }, { id: 'b', from: 'split', to: 'wait' }, { id: 'c', from: 'split', to: 'work' },
        { id: 'd', from: 'wait', to: 'join' }, { id: 'e', from: 'work', to: 'join' }, { id: 'f', from: 'join', to: 'end' },
      ],
    });
    await publishFlow(flow.id);
    const runId = (await request(app).post(`/api/flows/${flow.id}/run`).set(as(admin)).send({})).body.data.id;
    await processNextNativeJob(pool, cfg, 'flow-worker');
    await advanceFlows(pool, cfg);
    let detail = await runDetail(runId);
    expect(nodeStatus(detail, 'work')).toBe('SUCCEEDED');
    expect(nodeStatus(detail, 'join')).toBe('WAITING');
    expect(detail.status).toBe('RUNNING');
    await new Promise((resolve) => setTimeout(resolve, 1100));
    await advanceFlows(pool, cfg);
    detail = await runDetail(runId);
    expect(detail.status).toBe('SUCCEEDED');
    expect(nodeStatus(detail, 'join')).toBe('SUCCEEDED');
    expect(detail.nodes.find((node) => node.nodeId === 'join').arrivals).toBe(2);
  });

  it('starts a webhook flow with its token and enforces roles and project scope', async () => {
    const flow = await createFlow('Hooked', {
      nodes: [
        { id: 'start', type: 'start', name: 'Start', config: { trigger: 'webhook' } },
        { id: 'end', type: 'end', name: 'End', config: {} },
      ],
      edges: [{ id: 'a', from: 'start', to: 'end' }],
    });
    const published = await publishFlow(flow.id);
    expect(published.webhookToken).toMatch(/^[0-9a-f]{48}$/);
    expect((await request(app).post(`/api/hooks/flows/${flow.id}`).set('X-URAP-Flow-Token', 'nope').send({})).status).toBe(401);
    const hooked = await request(app).post(`/api/hooks/flows/${flow.id}`).set('X-URAP-Flow-Token', published.webhookToken).send({ orderId: 'A-1' });
    expect(hooked.status).toBe(202);
    const detail = await runDetail(hooked.body.data.id);
    expect(detail.status).toBe('SUCCEEDED');
    expect(detail.triggerSource).toBe('webhook');
    expect(detail.variables.orderId).toBe('A-1');

    expect((await request(app).post('/api/flows').set(as(viewer)).send({ projectId: project.id, name: 'x' })).status).toBe(403);
    expect((await request(app).get(`/api/flows/${flow.id}`).set(as(viewer))).status).toBe(403);
    const visible = await request(app).get('/api/flows').set(as(viewer));
    expect(visible.body.data).toEqual([]);
  });
});
