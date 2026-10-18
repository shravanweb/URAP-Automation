// Agents: CRUD, permissions, the "no AI provider" state, the tool-calling loop with the
// deterministic mock provider (query, workflow, and Action Center task tools, max steps, provider
// errors, cancel), the OpenAI-compatible wire format against a local fake server, AI provider
// connections, and the Flow "Agent" step.
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
import { buildToolSchemas, defaultAgentConfig, newTool, validateAgentConfig } from '../src/agent/config.js';
import { mockChat } from '../src/agent/providers.js';

const base = loadConfig();
const cfg = { ...base, ai: { provider: 'mock', model: 'mock-1', apiKey: '', baseUrl: '', apiVersion: '', allowMock: true, requestTimeoutMs: 5000 } };
const noKeyCfg = { ...base, ai: { provider: '', model: '', apiKey: '', baseUrl: '', apiVersion: '', allowMock: false, requestTimeoutMs: 5000 } };
const pool = createPool(base.databaseUrl);
const app = createApp({ pool, config: cfg });
const noKeyApp = createApp({ pool, config: noKeyCfg });
const tenantId = '00000000-0000-4000-8000-000000000001';
const PASSWORD = 'Agents-pass-1234';
let admin;
let operator;
let viewer;
let project;
let workflowId;

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

async function createAgent(name, agentType, patch = {}, projectId = project.id) {
  const created = await request(app).post('/api/agents').set(as(admin)).send({ projectId, name, agentType });
  expect(created.status, JSON.stringify(created.body)).toBe(201);
  const config = { ...created.body.data.config, ...patch };
  const saved = await request(app).put(`/api/agents/${created.body.data.id}/draft`).set(as(admin)).send({ config });
  expect(saved.status, JSON.stringify(saved.body)).toBe(200);
  return saved.body.data;
}

async function runDetail(id, user = admin) {
  const response = await request(app).get(`/api/agent-runs/${id}`).set(as(user));
  expect(response.status).toBe(200);
  return response.body.data;
}

async function waitFor(id, statuses, timeoutMs = 8000) {
  const started = Date.now();
  for (;;) {
    await advanceAgentRun(pool, cfg, id);
    const detail = await runDetail(id);
    if (statuses.includes(detail.status)) return detail;
    if (Date.now() - started > timeoutMs) throw new Error(`run ${id} stayed ${detail.status}: ${JSON.stringify(detail.messages.map((m) => [m.role, m.status, m.content]))}`);
    await sleep(100);
  }
}

beforeAll(async () => {
  const stamp = Date.now();
  admin = await createUser(`agents-admin-${stamp}@urap.test`, 'administrator');
  operator = await createUser(`agents-operator-${stamp}@urap.test`, 'operator');
  viewer = await createUser(`agents-viewer-${stamp}@urap.test`, 'viewer');
  project = (await request(app).post('/api/projects').set(as(admin)).send({ name: 'Agent project', description: 'agents', category: 'general' })).body.data;
  expect((await request(app).post(`/api/projects/${project.id}/members`).set(as(admin)).send({ userId: operator.id, role: 'operator' })).status).toBe(201);
  const created = await request(app).post('/api/workflows').set(as(admin)).send({ projectId: project.id, name: 'Score invoice' });
  workflowId = created.body.data.id;
  const draft = await request(app).post(`/api/workflows/${workflowId}/draft`).set(as(admin)).send({ definition: { schemaVersion: '1.0', retryPolicy: { maxAttempts: 1, backoffSeconds: 0 }, steps: [
    { id: 'start', type: 'start', name: 'Start', next: 'log' },
    { id: 'log', type: 'log_message', name: 'Log', config: { level: 'info', message: 'Scored {{input.invoiceId}}' }, next: 'end' },
    { id: 'end', type: 'end', name: 'End', config: { summaryFrom: ['log'] } },
  ] } });
  expect(draft.body.data.validation.errors).toEqual([]);
  expect((await request(app).post(`/api/workflows/${workflowId}/publish`).set(as(admin))).status).toBe(200);
});

afterAll(async () => {
  await sleep(300); // let background advances settle before closing the pool
  await pool.end();
});

describe('agent configuration', () => {
  it('validates configs and builds tool schemas', () => {
    const config = defaultAgentConfig('autonomous');
    expect(validateAgentConfig(config, null, 'autonomous').errors).toEqual([]);
    const tool = newTool('workflow', []);
    config.tools = [tool, { ...newTool('query', [tool]), name: tool.name }];
    config.maxSteps = 99;
    const messages = validateAgentConfig(config, null, 'autonomous').errors.map((item) => item.message);
    expect(messages).toContain('run_workflow: pick a workflow');
    expect(messages).toContain('Two tools are named run_workflow');
    expect(messages).toContain('Max steps must be a whole number from 1 to 25');
    const schemas = buildToolSchemas({ ...defaultAgentConfig('autonomous'), tools: [{ ...newTool('task', []) }] }, 'autonomous');
    expect(schemas.map((item) => item.name)).toEqual(['ask_a_person', 'submit_output']);
    expect(schemas[1].parameters.required).toEqual(['summary']);
    // The mock provider is deterministic.
    const reply = mockChat({ messages: [{ role: 'user', content: '#call ask_a_person {"title":"x"}' }], tools: schemas });
    expect(reply.toolCalls).toEqual([expect.objectContaining({ name: 'ask_a_person', arguments: { title: 'x' } })]);
  });
});

describe('agents API', () => {
  it('shows the setup state and refuses to run without an AI provider', async () => {
    const other = (await request(noKeyApp).post('/api/projects').set(as(admin)).send({ name: 'No AI project', description: '', category: 'general' })).body.data;
    const status = await request(noKeyApp).get(`/api/ai/status?projectId=${other.id}`).set(as(admin));
    expect(status.status).toBe(200);
    expect(status.body.data).toMatchObject({ configured: false, active: null, envDefault: false, connections: [] });
    expect(status.body.data.providers.map((item) => item.id)).not.toContain('mock');
    const created = await request(noKeyApp).post('/api/agents').set(as(admin)).send({ projectId: other.id, name: 'Helper', agentType: 'conversational' });
    const run = await request(noKeyApp).post(`/api/agents/${created.body.data.id}/runs`).set(as(admin)).send({ test: true, message: 'hello' });
    expect(run.status).toBe(409);
    expect(run.body.error.code).toBe('AI_NOT_CONFIGURED');
  });

  it('enforces roles, validates drafts, publishes versions, and audits', async () => {
    expect((await request(app).post('/api/agents').set(as(viewer)).send({ projectId: project.id, name: 'x' })).status).toBe(403);
    const agent = await createAgent('Ops helper', 'conversational', { tools: [newTool('workflow', [])] });
    expect(agent.validation.errors.map((item) => item.message)).toContain('run_workflow: pick a workflow');
    const refused = await request(app).post(`/api/agents/${agent.id}/publish`).set(as(admin));
    expect(refused.status).toBe(400);
    expect(refused.body.error.details[0]).toMatchObject({ field: `tools.${agent.config.tools[0].id}` });
    const fixed = await request(app).put(`/api/agents/${agent.id}/draft`).set(as(admin)).send({ config: { ...agent.config, tools: [{ ...agent.config.tools[0], workflowId }] } });
    expect(fixed.body.data.validation.errors).toEqual([]);
    const published = await request(app).post(`/api/agents/${agent.id}/publish`).set(as(admin));
    expect(published.status).toBe(200);
    expect(published.body.data).toMatchObject({ status: 'published', versionNumber: 1 });
    // Viewer is not a project member: no access. Operator may run the published agent but not test the draft.
    expect((await request(app).get(`/api/agents/${agent.id}`).set(as(viewer))).status).toBe(403);
    expect((await request(app).get('/api/agents').set(as(viewer))).body.data).toEqual([]);
    expect((await request(app).post(`/api/agents/${agent.id}/runs`).set(as(operator)).send({ test: true, message: 'hi' })).status).toBe(403);
    const run = await request(app).post(`/api/agents/${agent.id}/runs`).set(as(operator)).send({ message: '#text hello there', wait: true });
    expect(run.status, JSON.stringify(run.body)).toBe(200);
    expect(run.body.data).toMatchObject({ status: 'IDLE', mode: 'chat', source: 'chat', versionNumber: 1 });
    expect(run.body.data.output.reply).toBe('You said: hello there');
    // Only the starter continues a conversation.
    expect((await request(app).post(`/api/agent-runs/${run.body.data.id}/messages`).set(as(viewer)).send({ content: 'x' })).status).toBe(403);
    const [audit] = await pool.query(`SELECT action FROM audit_logs WHERE entity_id IN (?, ?) ORDER BY created_at`, [agent.id, run.body.data.id]);
    expect(audit.map((row) => row.action)).toEqual(expect.arrayContaining(['agent.create', 'agent.save_draft', 'agent.publish', 'agent.run']));
  });

  it('chats with tool calls, keeps the trace and token usage, and ends the conversation', async () => {
    const agent = await createAgent('Data helper', 'conversational', { tools: [newTool('query', [])] });
    const started = await request(app).post(`/api/agents/${agent.id}/runs`).set(as(admin)).send({ test: true, message: 'Please use look_up_project_data', wait: true });
    expect(started.status, JSON.stringify(started.body)).toBe(200);
    let detail = await runDetail(started.body.data.id);
    expect(detail.status).toBe('IDLE');
    expect(detail.messages.map((m) => m.role)).toEqual(['system', 'assistant', 'user', 'assistant', 'tool', 'assistant']);
    const tool = detail.messages[4];
    expect(tool).toMatchObject({ toolName: 'look_up_project_data', status: 'done' });
    expect(JSON.parse(tool.content)).toMatchObject({ resource: 'jobs' });
    expect(detail.totalTokens).toBeGreaterThan(0);
    expect(detail.steps).toBe(2);
    expect(detail.messages[5].content).toMatch(/^Done\. look_up_project_data returned/);
    const next = await request(app).post(`/api/agent-runs/${detail.id}/messages`).set(as(admin)).send({ content: 'thanks', wait: true });
    expect(next.body.data.output.reply).toBe('You said: thanks');
    expect((await request(app).post(`/api/agent-runs/${detail.id}/end`).set(as(admin))).body.data.status).toBe('SUCCEEDED');
    expect((await request(app).post(`/api/agent-runs/${detail.id}/messages`).set(as(admin)).send({ content: 'more' })).status).toBe(409);
    detail = await runDetail(detail.id);
    expect(detail.messages.filter((m) => m.role === 'user')).toHaveLength(2);
  });

  it('runs a workflow tool through the job system and submits structured output', async () => {
    const tool = { ...newTool('workflow', []), name: 'score_invoice', workflowId, inputs: [{ name: 'invoiceId', type: 'string', description: 'Invoice id', required: true }] };
    const agent = await createAgent('Invoice agent', 'autonomous', { tools: [tool] });
    const started = await request(app).post(`/api/agents/${agent.id}/runs`).set(as(admin))
      .send({ test: true, input: { request: '#call score_invoice {"invoiceId":"INV-7","ignored":1}' }, wait: true });
    expect(started.status, JSON.stringify(started.body)).toBe(200);
    expect(started.body.data.status).toBe('WAITING');
    let detail = await runDetail(started.body.data.id);
    const pending = detail.messages.find((m) => m.role === 'tool');
    expect(pending).toMatchObject({ status: 'pending', toolName: 'score_invoice' });
    const [jobs] = await pool.query(`SELECT trigger_source, agent_run_id, input_json FROM automation_jobs WHERE id = ?`, [pending.jobId]);
    expect(jobs[0]).toMatchObject({ trigger_source: 'agent', agent_run_id: detail.id });
    const input = typeof jobs[0].input_json === 'string' ? JSON.parse(jobs[0].input_json) : jobs[0].input_json;
    expect(input).toEqual({ invoiceId: 'INV-7' });
    expect((await processNextNativeJob(pool, cfg, 'agent-worker')).status).toBe('SUCCEEDED');
    detail = await waitFor(detail.id, ['SUCCEEDED', 'FAILED']);
    expect(detail.status).toBe('SUCCEEDED');
    expect(detail.output.summary).toContain('score_invoice returned');
    expect(detail.messages.find((m) => m.role === 'tool' && m.toolName === 'score_invoice').content).toContain('Scored INV-7');
    expect(detail.messages.at(-1)).toMatchObject({ role: 'tool', toolName: 'submit_output', status: 'done' });
  });

  it('escalates to a person in Action Center, waits for the decision, and can be cancelled', async () => {
    const tool = { ...newTool('task', []), name: 'ask_manager', assignedRole: 'operator' };
    const agent = await createAgent('Refund agent', 'autonomous', { tools: [tool] });
    const started = await request(app).post(`/api/agents/${agent.id}/runs`).set(as(admin))
      .send({ test: true, input: { request: '#call ask_manager {"title":"Approve refund R-1","data":{"amount":40}}' }, wait: true });
    expect(started.body.data.status).toBe('WAITING');
    let detail = await runDetail(started.body.data.id);
    const taskId = detail.messages.find((m) => m.role === 'tool').taskId;
    const task = (await request(app).get(`/api/tasks/${taskId}`).set(as(operator))).body.data;
    expect(task).toMatchObject({ title: 'Approve refund R-1', agentRunId: detail.id, assignedRole: 'operator' });
    expect((await request(app).post(`/api/tasks/${taskId}/complete`).set(as(operator)).send({ outcome: 'approve', comment: 'ok' })).status).toBe(200);
    detail = await waitFor(detail.id, ['SUCCEEDED', 'FAILED']);
    expect(detail.status).toBe('SUCCEEDED');
    expect(detail.output.summary).toContain('"outcome":"approve"');

    const second = await request(app).post(`/api/agents/${agent.id}/runs`).set(as(admin))
      .send({ test: true, input: { request: '#call ask_manager {"title":"Approve refund R-2"}' }, wait: true });
    expect(second.body.data.status).toBe('WAITING');
    const secondTask = (await runDetail(second.body.data.id)).messages.find((m) => m.role === 'tool').taskId;
    expect((await request(app).post(`/api/agent-runs/${second.body.data.id}/cancel`).set(as(viewer))).status).toBe(403);
    const cancelled = await request(app).post(`/api/agent-runs/${second.body.data.id}/cancel`).set(as(admin));
    expect(cancelled.body.data.status).toBe('CANCELLED');
    const [tasks] = await pool.query(`SELECT status FROM action_tasks WHERE id = ?`, [secondTask]);
    expect(tasks[0].status).toBe('cancelled');
    expect((await request(app).post(`/api/agent-runs/${second.body.data.id}/cancel`).set(as(admin))).status).toBe(409);
  });

  it('stops at max steps and reports provider errors', async () => {
    const agent = await createAgent('Looper', 'autonomous', { tools: [newTool('query', [])], maxSteps: 2 });
    const looped = await request(app).post(`/api/agents/${agent.id}/runs`).set(as(admin)).send({ test: true, input: { request: '#loop' }, wait: true });
    expect(looped.body.data.status).toBe('FAILED');
    expect(looped.body.data.error).toMatch(/^MAX_STEPS/);
    expect(looped.body.data.steps).toBe(2);
    const failed = await request(app).post(`/api/agents/${agent.id}/runs`).set(as(admin)).send({ test: true, input: { request: '#fail' }, wait: true });
    expect(failed.body.data.status).toBe('FAILED');
    expect(failed.body.data.error).toContain('AI_PROVIDER_ERROR');
    const missing = await request(app).post(`/api/agents/${agent.id}/runs`).set(as(admin)).send({ test: true, input: {} });
    expect(missing.status).toBe(400);
    expect(missing.body.error.message).toBe('Missing required input: request');
  });

  it('speaks the OpenAI-compatible protocol through an encrypted AI provider connection', async () => {
    const seen = [];
    const server = http.createServer((req, res) => {
      let body = '';
      req.on('data', (chunk) => { body += chunk; });
      req.on('end', () => {
        const parsed = JSON.parse(body);
        seen.push({ url: req.url, auth: req.headers.authorization, body: parsed });
        const hasToolResult = parsed.messages.some((m) => m.role === 'tool');
        const message = parsed.tools && !hasToolResult && parsed.messages.length > 1
          ? { role: 'assistant', content: null, tool_calls: [{ id: 'call_1', type: 'function', function: { name: 'look_up_project_data', arguments: '{"resource":"tasks","limit":2}' } }] }
          : { role: 'assistant', content: hasToolResult ? 'There are open tasks.' : 'OK' };
        res.setHeader('content-type', 'application/json');
        res.end(JSON.stringify({ model: parsed.model, choices: [{ message }], usage: { prompt_tokens: 11, completion_tokens: 7 } }));
      });
    });
    await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
    const { port } = server.address();
    try {
      const other = (await request(app).post('/api/projects').set(as(admin)).send({ name: 'Compat AI project', description: '', category: 'general' })).body.data;
      const bad = await request(app).post(`/api/projects/${other.id}/connections`).set(as(admin)).send({ connectorType: 'ai_provider', name: 'x', config: { provider: 'openai_compatible', baseUrl: `http://127.0.0.1:${port}/v1` } });
      expect(bad.status).toBe(400);
      const connection = await request(app).post(`/api/projects/${other.id}/connections`).set(as(admin))
        .send({ connectorType: 'ai_provider', name: 'Local model', config: { provider: 'openai_compatible', baseUrl: `http://127.0.0.1:${port}/v1`, model: 'local-model' }, secret: { apiKey: 'sk-test-secret' } });
      expect(connection.status).toBe(201);
      expect(JSON.stringify(connection.body)).not.toContain('sk-test-secret');
      const tested = await request(app).post(`/api/connections/${connection.body.data.id}/test`).set(as(admin));
      expect(tested.body.data.status).toBe('available');
      const status = (await request(app).get(`/api/ai/status?projectId=${other.id}`).set(as(admin))).body.data;
      expect(status.active).toMatchObject({ source: 'connection', provider: 'openai_compatible', model: 'local-model' });
      expect(JSON.stringify(status)).not.toContain('sk-test-secret');
      const created = await request(app).post('/api/agents').set(as(admin)).send({ projectId: other.id, name: 'Compat', agentType: 'conversational' });
      await request(app).put(`/api/agents/${created.body.data.id}/draft`).set(as(admin)).send({ config: { ...created.body.data.config, connectionId: connection.body.data.id, tools: [newTool('query', [])] } });
      const run = await request(app).post(`/api/agents/${created.body.data.id}/runs`).set(as(admin)).send({ test: true, message: 'How many tasks are open?', wait: true });
      expect(run.body.data, JSON.stringify(run.body)).toMatchObject({ status: 'IDLE', providerLabel: 'OpenAI-compatible · local-model', promptTokens: 22, completionTokens: 14 });
      expect(run.body.data.output.reply).toBe('There are open tasks.');
      const chatCalls = seen.filter((item) => item.body.messages.length > 1);
      expect(chatCalls[0]).toMatchObject({ url: '/v1/chat/completions', auth: 'Bearer sk-test-secret' });
      expect(chatCalls[0].body.tools[0].function.name).toBe('look_up_project_data');
      expect(chatCalls[1].body.messages.at(-1)).toMatchObject({ role: 'tool', tool_call_id: 'call_1' });
      expect(chatCalls[1].body.messages.at(-2).tool_calls[0].function.arguments).toBe('{"resource":"tasks","limit":2}');
    } finally {
      server.close();
    }
  });

  it('runs a published agent as a Flow step and stores its output', async () => {
    const agent = await createAgent('Classifier', 'autonomous', { inputSchema: [{ name: 'request', type: 'string', required: true }] });
    expect((await request(app).post(`/api/agents/${agent.id}/publish`).set(as(admin))).status).toBe(200);
    const created = await request(app).post('/api/flows').set(as(admin)).send({ projectId: project.id, name: 'Agent flow' });
    const definition = {
      variables: [{ name: 'ticket', defaultValue: 'Printer is broken' }],
      nodes: [
        { id: 'start', type: 'start', name: 'Start', x: 0, y: 0, config: { trigger: 'manual' } },
        { id: 'classify', type: 'agent', name: 'Classify ticket', x: 1, y: 0, config: { agentId: agent.id, input: { request: 'Classify: {{vars.ticket}}' }, outputVar: 'classification' } },
        { id: 'end', type: 'end', name: 'End', x: 2, y: 0, config: {} },
      ],
      edges: [{ id: 'e1', from: 'start', to: 'classify' }, { id: 'e2', from: 'classify', to: 'end' }],
    };
    const saved = await request(app).put(`/api/flows/${created.body.data.id}/draft`).set(as(admin)).send({ definition });
    expect(saved.body.data.validation.errors).toEqual([]);
    expect((await request(app).post(`/api/flows/${created.body.data.id}/publish`).set(as(admin))).status).toBe(200);
    const run = await request(app).post(`/api/flows/${created.body.data.id}/run`).set(as(admin)).send({});
    expect(run.status).toBe(202);
    let flowRun;
    for (let i = 0; i < 80; i += 1) {
      flowRun = (await request(app).get(`/api/flow-runs/${run.body.data.id}`).set(as(admin))).body.data;
      if (flowRun.status !== 'RUNNING') break;
      const agentRunId = flowRun.nodes.find((node) => node.nodeId === 'classify')?.agentRunId;
      if (agentRunId) await advanceAgentRun(pool, cfg, agentRunId);
      await sleep(100);
    }
    expect(flowRun.status).toBe('SUCCEEDED');
    expect(flowRun.variables.classification.summary).toBe('You said: Classify: Printer is broken');
    const agentRunId = flowRun.nodes.find((node) => node.nodeId === 'classify').agentRunId;
    const agentRun = await runDetail(agentRunId);
    expect(agentRun).toMatchObject({ source: 'flow', flowRunId: flowRun.id, mode: 'task', versionNumber: 1 });

    // An unpublished agent is rejected at publish time.
    const draftAgent = await createAgent('Draft only', 'autonomous');
    const bad = await request(app).put(`/api/flows/${created.body.data.id}/draft`).set(as(admin)).send({ definition: { ...definition, nodes: definition.nodes.map((node) => (node.id === 'classify' ? { ...node, config: { ...node.config, agentId: draftAgent.id } } : node)) } });
    expect(bad.body.data.validation.errors.map((item) => item.message)).toContain('Classify ticket: Draft only must be published before the flow can run it');
  });
});
