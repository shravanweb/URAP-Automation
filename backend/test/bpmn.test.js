// BPMN processes: XML -> Flow definition compile (gateways, parallel split/join, timers, lanes,
// subprocesses, conditions, unsupported elements), run state per element, and the API (CRUD,
// permissions, project scope, publish, manual/webhook/schedule starts, run monitor end to end).
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
import { compileBpmn, elementStates, mapFlowIssues, parseConditionExpression, parseXml } from '../src/bpmn/compile.js';
import { blankProcessXml, purchaseRequestXml } from '../src/bpmn/templates.js';

const base = loadConfig();
const cfg = { ...base, ai: { provider: 'mock', model: 'mock-1', apiKey: '', baseUrl: '', apiVersion: '', allowMock: true, requestTimeoutMs: 5000 } };
const pool = createPool(base.databaseUrl);
const app = createApp({ pool, config: cfg });
const tenantId = '00000000-0000-4000-8000-000000000001';
const PASSWORD = 'Bpmn-pass-1234';
let admin; let manager; let developer; let operator; let viewer; let outsider;
let project; let workflowId;

async function createUser(email, role) {
  const id = crypto.randomUUID();
  await pool.query(
    `INSERT INTO users (id, tenant_id, email, display_name, password_hash, role, status, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, 'active', UTC_TIMESTAMP(3), UTC_TIMESTAMP(3))`,
    [id, tenantId, email, `${role} user`, await hashPassword(PASSWORD, 4), role],
  );
  const response = await request(app).post('/api/auth/login').send({ email, password: PASSWORD });
  expect(response.status).toBe(200);
  return { id, email, role, token: response.body.data.accessToken };
}
const as = (user) => ({ Authorization: `Bearer ${user.token}` });

/** A BPMN document around process content (no diagram; the compiler does not need one). */
const doc = (body, { pools = '' } = {}) => `<?xml version="1.0" encoding="UTF-8"?>
<bpmn:definitions xmlns:bpmn="http://www.omg.org/spec/BPMN/20100524/MODEL" xmlns:urap="http://urap.dev/schema/bpmn/1.0" id="Defs" targetNamespace="http://urap.dev/bpmn">
  ${pools}
  <bpmn:process id="Process_1" isExecutable="true">${body}</bpmn:process>
</bpmn:definitions>`;
const flow = (id, from, to, extra = '', inner = '') => `<bpmn:sequenceFlow id="${id}" sourceRef="${from}" targetRef="${to}" ${extra}>${inner}</bpmn:sequenceFlow>`;
const byId = (definition, id) => definition.nodes.find((node) => node.id === id);

beforeAll(async () => {
  const stamp = Date.now();
  admin = await createUser(`bpmn-admin-${stamp}@urap.test`, 'administrator');
  manager = await createUser(`bpmn-pm-${stamp}@urap.test`, 'project_manager');
  developer = await createUser(`bpmn-dev-${stamp}@urap.test`, 'automation_developer');
  operator = await createUser(`bpmn-op-${stamp}@urap.test`, 'operator');
  viewer = await createUser(`bpmn-viewer-${stamp}@urap.test`, 'viewer');
  outsider = await createUser(`bpmn-outsider-${stamp}@urap.test`, 'operator');
  project = (await request(app).post('/api/projects').set(as(admin)).send({ name: 'BPMN project', description: 'bpmn', category: 'general' })).body.data;
  for (const [user, role] of [[manager, 'project_manager'], [developer, 'automation_developer'], [operator, 'operator'], [viewer, 'viewer']]) {
    expect((await request(app).post(`/api/projects/${project.id}/members`).set(as(admin)).send({ userId: user.id, role })).status).toBe(201);
  }
  const created = await request(app).post('/api/workflows').set(as(admin)).send({ projectId: project.id, name: 'Create PO' });
  workflowId = created.body.data.id;
  await request(app).post(`/api/workflows/${workflowId}/draft`).set(as(admin)).send({ definition: { schemaVersion: '1.0', retryPolicy: { maxAttempts: 1, backoffSeconds: 0 }, steps: [
    { id: 'start', type: 'start', name: 'Start', next: 'log' },
    { id: 'log', type: 'log_message', name: 'Log', config: { level: 'info', message: 'PO for {{input.item}}' }, next: 'end' },
    { id: 'end', type: 'end', name: 'End', config: { summaryFrom: ['log'] } },
  ] } });
  expect((await request(app).post(`/api/workflows/${workflowId}/publish`).set(as(admin))).status).toBe(200);
});

afterAll(async () => {
  await new Promise((resolve) => setTimeout(resolve, 300));
  // Test files share one database and run one after another: leave no queued jobs for the next file's worker.
  if (project) {
    await pool.query(`UPDATE automation_jobs SET status = 'CANCELLED', updated_at = UTC_TIMESTAMP(3) WHERE project_id = ? AND status IN ('QUEUED', 'RETRY_WAIT')`, [project.id]);
    await pool.query(`UPDATE flows SET status = 'disabled' WHERE project_id = ?`, [project.id]);
  }
  await pool.end();
});

describe('BPMN compile', () => {
  it('compiles the purchase request: lanes to roles, user task, exclusive gateway with conditions, service task', () => {
    const { definition, errors, warnings, trigger } = compileBpmn(purchaseRequestXml({ workflowId: 'wf-1' }));
    expect(errors).toEqual([]);
    expect(warnings).toEqual([]);
    expect(trigger).toEqual({ type: 'manual' });
    expect(definition.nodes.map((node) => [node.id, node.type])).toEqual(expect.arrayContaining([
      ['Start_Request', 'start'], ['Task_Approve', 'human'], ['Gateway_Approved', 'decision'], ['Task_CreatePO', 'robot'], ['End_Ordered', 'end'], ['End_Rejected', 'end'],
    ]));
    expect(definition.nodes).toHaveLength(6);
    expect(byId(definition, 'Task_Approve').config).toMatchObject({ assignedRole: 'project_manager', outputVar: 'approval', lane: 'Manager', taskType: 'approval' });
    expect(byId(definition, 'Task_CreatePO').config).toMatchObject({ workflowId: 'wf-1', outputVar: 'order', input: { item: '{{vars.item}}', amount: '{{vars.amount}}' } });
    expect(definition.edges.find((edge) => edge.id === 'Flow_Approved').condition).toEqual({ left: 'vars.approval.outcome', op: 'eq', right: 'approve' });
    expect(definition.edges.find((edge) => edge.id === 'Flow_Rejected').isDefault).toBe(true);
    expect(definition.bpmn.lanes.map((lane) => lane.role)).toEqual(['', 'project_manager', '']);
    expect(validateDefinition(definition).errors).toEqual([]);
    expect(compileBpmn(blankProcessXml('Blank')).errors).toEqual([]);
  });

  it('compiles parallel split/join, a combined join+split gateway, timer start cycles, and intermediate timers', () => {
    const xml = doc(`
      <bpmn:startEvent id="S"><bpmn:timerEventDefinition><bpmn:timeCycle>R/PT1H</bpmn:timeCycle></bpmn:timerEventDefinition></bpmn:startEvent>
      <bpmn:parallelGateway id="Split" />
      <bpmn:serviceTask id="A" name="Fetch orders" urap:serviceType="workflow" urap:workflowId="w" />
      <bpmn:intermediateCatchEvent id="Wait" name="Cool down"><bpmn:timerEventDefinition><bpmn:timeDuration>PT10M</bpmn:timeDuration></bpmn:timerEventDefinition></bpmn:intermediateCatchEvent>
      <bpmn:parallelGateway id="Both" />
      <bpmn:userTask id="C" name="Check" />
      <bpmn:userTask id="D" name="Check" />
      <bpmn:parallelGateway id="Join" />
      <bpmn:endEvent id="E" />
      ${flow('f1', 'S', 'Split')}${flow('f2', 'Split', 'A')}${flow('f3', 'Split', 'Wait')}${flow('f4', 'A', 'Both')}${flow('f5', 'Wait', 'Both')}
      ${flow('f6', 'Both', 'C')}${flow('f7', 'Both', 'D')}${flow('f8', 'C', 'Join')}${flow('f9', 'D', 'Join')}${flow('f10', 'Join', 'E')}`);
    const { definition, errors, trigger } = compileBpmn(xml);
    expect(errors).toEqual([]);
    expect(trigger).toEqual({ type: 'schedule', cron: '0 * * * *', timezone: 'UTC' });
    expect(byId(definition, 'S').config).toMatchObject({ trigger: 'schedule', cron: '0 * * * *' });
    expect(byId(definition, 'Split').type).toBe('parallel');
    expect(byId(definition, 'Both').type).toBe('join');
    expect(byId(definition, 'Both__split')).toMatchObject({ type: 'parallel', config: { bpmnId: 'Both' } });
    expect(byId(definition, 'Join').type).toBe('join');
    expect(byId(definition, 'Wait')).toMatchObject({ type: 'timer', config: { seconds: 600 } });
    // Same names get distinct result variables.
    expect([byId(definition, 'C').config.outputVar, byId(definition, 'D').config.outputVar]).toEqual(['check', 'check2']);
    expect(validateDefinition(definition).errors).toEqual([]);

    const daily = compileBpmn(doc(`<bpmn:startEvent id="S" urap:timezone="Asia/Kolkata"><bpmn:timerEventDefinition><bpmn:timeCycle>0 9 * * 1-5</bpmn:timeCycle></bpmn:timerEventDefinition></bpmn:startEvent><bpmn:endEvent id="E" />${flow('f', 'S', 'E')}`));
    expect(daily.trigger).toEqual({ type: 'schedule', cron: '0 9 * * 1-5', timezone: 'Asia/Kolkata' });
    const webhook = compileBpmn(doc(`<bpmn:startEvent id="S"><bpmn:messageEventDefinition /></bpmn:startEvent><bpmn:endEvent id="E" />${flow('f', 'S', 'E')}`));
    expect(webhook.trigger).toEqual({ type: 'webhook' });
    expect(byId(webhook.definition, 'S').config.trigger).toBe('webhook');
  });

  it('inlines an embedded subprocess and drops merge-only exclusive gateways, remembering them for highlighting', () => {
    const xml = doc(`
      <bpmn:startEvent id="S" />
      <bpmn:subProcess id="Sub" name="Prepare">
        <bpmn:startEvent id="SubS" /><bpmn:userTask id="Fill" name="Fill form" /><bpmn:endEvent id="SubE" />
        ${flow('s1', 'SubS', 'Fill')}${flow('s2', 'Fill', 'SubE')}
      </bpmn:subProcess>
      <bpmn:exclusiveGateway id="Pick" />
      <bpmn:userTask id="Big" name="Big" /><bpmn:userTask id="Small" name="Small" />
      <bpmn:exclusiveGateway id="Merge" />
      <bpmn:endEvent id="E" />
      ${flow('f1', 'S', 'Sub')}${flow('f2', 'Sub', 'Pick')}
      ${flow('f3', 'Pick', 'Big', '', '<bpmn:conditionExpression>${vars.amount &gt;= 1000}</bpmn:conditionExpression>')}
      ${flow('f4', 'Pick', 'Small')}${flow('f5', 'Big', 'Merge')}${flow('f6', 'Small', 'Merge')}${flow('f7', 'Merge', 'E')}`.replace('<bpmn:exclusiveGateway id="Pick" />', '<bpmn:exclusiveGateway id="Pick" default="f4" />'));
    const { definition, errors } = compileBpmn(xml);
    expect(errors).toEqual([]);
    expect(definition.nodes.map((node) => node.id).sort()).toEqual(['Big', 'E', 'Fill', 'Pick', 'S', 'Small']);
    expect(byId(definition, 'Fill').config.bpmnParent).toBe('Sub');
    const intoFill = definition.edges.find((edge) => edge.to === 'Fill');
    expect(intoFill.from).toBe('S');
    expect(intoFill.via).toEqual(expect.arrayContaining(['Sub', 's1']));
    expect(definition.edges.find((edge) => edge.id === 'f3').condition).toEqual({ left: 'vars.amount', op: 'gte', right: '1000' });
    expect(definition.edges.find((edge) => edge.id === 'f4').isDefault).toBe(true);
    expect(definition.edges.find((edge) => edge.id === 'f5')).toMatchObject({ to: 'E', via: expect.arrayContaining(['Merge', 'f7']) });
    expect(validateDefinition(definition).errors).toEqual([]);

    const states = elementStates(definition, [
      { nodeId: 'S', status: 'SUCCEEDED' }, { nodeId: 'Fill', status: 'SUCCEEDED' }, { nodeId: 'Pick', status: 'SUCCEEDED' }, { nodeId: 'Big', status: 'WAITING' },
    ]).elements;
    expect(states).toMatchObject({ S: 'done', Sub: 'done', Fill: 'done', s1: 'done', f2: 'done', Pick: 'done', f3: 'done', Big: 'active' });
    expect(states.Small).toBeUndefined();
    expect(states.f4).toBeUndefined();
    expect(elementStates(definition, [{ nodeId: 'S', status: 'SUCCEEDED' }, { nodeId: 'Fill', status: 'FAILED' }]).elements).toMatchObject({ Fill: 'failed', Sub: 'failed' });
  });

  it('reports unsupported elements with the element to mark on the canvas', () => {
    const xml = doc(`
      <bpmn:startEvent id="S" />
      <bpmn:task id="Plain" name="Do it" />
      <bpmn:scriptTask id="Script" name="Script" />
      <bpmn:inclusiveGateway id="Incl" />
      <bpmn:userTask id="U" name="Approve" />
      <bpmn:boundaryEvent id="Bound" attachedToRef="U"><bpmn:timerEventDefinition /></bpmn:boundaryEvent>
      <bpmn:intermediateThrowEvent id="Throw" />
      <bpmn:serviceTask id="Svc" name="Call" urap:serviceType="teleport" />
      <bpmn:endEvent id="E"><bpmn:errorEventDefinition /></bpmn:endEvent>
      <bpmn:textAnnotation id="Note"><bpmn:text>hi</bpmn:text></bpmn:textAnnotation>
      ${flow('f1', 'S', 'Plain')}${flow('f2', 'Plain', 'E', '', '<bpmn:conditionExpression>${weird stuff}</bpmn:conditionExpression>')}`,
    { pools: '<bpmn:collaboration id="C"><bpmn:participant id="P1" processRef="Process_1" /><bpmn:participant id="P2" name="Supplier" processRef="Process_2" /></bpmn:collaboration>' })
      .replace('</bpmn:definitions>', '<bpmn:process id="Process_2"><bpmn:startEvent id="S2" /></bpmn:process></bpmn:definitions>');
    const { errors } = compileBpmn(xml);
    const at = (id) => errors.filter((item) => item.elementId === id).map((item) => item.message).join(' | ');
    expect(at('Plain')).toContain('change it to a User task');
    expect(at('Script')).toContain('Script tasks are not supported');
    expect(at('Incl')).toContain('inclusive gateways are not supported');
    expect(at('Bound')).toContain('boundary events are not supported');
    expect(at('Throw')).toContain('intermediate throw events are not supported');
    expect(at('Svc')).toContain('unknown service type teleport');
    expect(at('E')).toContain('error end events are not supported');
    expect(at('f2')).toContain('is not understood');
    expect(at('P2')).toContain('Only one pool can contain the process');
    expect(errors.some((item) => item.elementId === 'Note')).toBe(false);

    expect(compileBpmn('<nope').errors[0].message).toContain('not valid BPMN XML');
    expect(compileBpmn('<?xml version="1.0"?><!DOCTYPE x [<!ENTITY a "b">]><x/>').errors[0].message).toContain('not valid BPMN XML');
    expect(() => parseXml('<a><b></a>')).toThrow();
    expect(compileBpmn('<root/>').errors[0].message).toContain('not a BPMN 2.0 document');
    const branching = compileBpmn(doc(`<bpmn:startEvent id="S" /><bpmn:userTask id="U" /><bpmn:endEvent id="E1" /><bpmn:endEvent id="E2" />${flow('a', 'S', 'U')}${flow('b', 'U', 'E1')}${flow('c', 'U', 'E2')}`));
    expect(branching.errors).toEqual([expect.objectContaining({ elementId: 'U', message: expect.stringContaining('Add a gateway') })]);
    expect(parseConditionExpression("${vars.status != 'open'}")).toEqual({ left: 'vars.status', op: 'neq', right: 'open' });
    expect(mapFlowIssues([{ nodeId: 'Both__split', message: 'x' }, { edgeId: 'a', message: 'y' }, { message: 'z' }], { nodes: [{ id: 'Both__split', config: { bpmnId: 'Both' } }], edges: [{ id: 'a', bpmnId: 'Flow_a' }] }))
      .toEqual([{ elementId: 'Both', message: 'x' }, { elementId: 'Flow_a', message: 'y' }, { message: 'z' }]);
  });
});

describe('BPMN API', () => {
  const create = async (body, user = admin) => request(app).post('/api/bpmn').set(as(user)).send({ projectId: project.id, ...body });
  const runDetail = async (runId, user = admin) => (await request(app).get(`/api/bpmn-runs/${runId}`).set(as(user))).body.data;

  it('creates, lists, edits, and saves processes with role checks and project scope', async () => {
    expect((await create({ name: 'Nope' }, operator)).status).toBe(403);
    expect((await create({ name: 'Nope' }, viewer)).status).toBe(403);
    const created = await create({ name: 'Onboarding', description: 'New hire' }, developer);
    expect(created.status).toBe(201);
    const id = created.body.data.id;
    expect(created.body.data).toMatchObject({ status: 'draft', flowId: null, runCount: 0, lastRun: null });

    const detail = await request(app).get(`/api/bpmn/${id}`).set(as(viewer));
    expect(detail.status).toBe(200);
    expect(detail.body.data.xml).toContain('StartEvent_1');
    expect(detail.body.data.validation.errors).toEqual([]);
    expect((await request(app).get(`/api/bpmn/${id}`).set(as(outsider))).status).toBe(403);
    expect((await request(app).get('/api/bpmn').set(as(outsider))).body.data.some((item) => item.id === id)).toBe(false);
    const list = await request(app).get(`/api/bpmn?projectId=${project.id}&search=Onboard`).set(as(operator));
    expect(list.body.data.map((item) => item.id)).toContain(id);

    expect((await request(app).patch(`/api/bpmn/${id}`).set(as(operator)).send({ name: 'x' })).status).toBe(403);
    expect((await request(app).patch(`/api/bpmn/${id}`).set(as(developer)).send({ name: 'Onboarding v2' })).body.data.name).toBe('Onboarding v2');

    expect((await request(app).put(`/api/bpmn/${id}/draft`).set(as(developer)).send({ xml: '<broken' })).status).toBe(400);
    const withTask = blankProcessXml('x').replace('<bpmn:endEvent', '<bpmn:task id="T1" name="Mystery" /><bpmn:endEvent');
    const saved = await request(app).put(`/api/bpmn/${id}/draft`).set(as(developer)).send({ xml: withTask });
    expect(saved.status).toBe(200);
    expect(saved.body.data.validation.errors.map((item) => item.elementId)).toContain('T1');
    expect((await request(app).post(`/api/bpmn/${id}/publish`).set(as(developer))).status).toBe(400);
    expect((await request(app).post(`/api/bpmn/${id}/publish`).set(as(operator))).status).toBe(403);
    expect((await request(app).post(`/api/bpmn/${id}/run`).set(as(admin)).send({})).status).toBe(409);

    const imported = await create({ name: 'Imported', xml: purchaseRequestXml({ workflowId }) });
    expect(imported.status).toBe(201);
    expect((await create({ name: 'Bad import', xml: '<x' })).status).toBe(400);
    const [audit] = await pool.query(`SELECT action FROM audit_logs WHERE entity_id = ?`, [id]);
    expect(audit.map((row) => row.action)).toEqual(expect.arrayContaining(['bpmn.create', 'bpmn.update', 'bpmn.save_draft']));
  });

  it('blocks publishing with element-level errors from flow validation (missing workflow)', async () => {
    const created = await create({ name: 'No robot', template: 'purchase' });
    const detail = await request(app).get(`/api/bpmn/${created.body.data.id}`).set(as(admin));
    expect(detail.body.data.validation.errors.map((item) => item.elementId)).toContain('Task_CreatePO');
    const published = await request(app).post(`/api/bpmn/${created.body.data.id}/publish`).set(as(admin));
    expect(published.status).toBe(400);
    expect(published.body.error.details.map((item) => item.elementId)).toContain('Task_CreatePO');
  });

  it('runs the purchase request end to end: manager approval in Action Center, robot job, element states', async () => {
    const created = await create({ name: 'Purchase request', template: 'purchase', workflowId });
    const id = created.body.data.id;
    const published = await request(app).post(`/api/bpmn/${id}/publish`).set(as(manager));
    expect(published.status, JSON.stringify(published.body)).toBe(200);
    expect(published.body.data).toMatchObject({ status: 'published', versionNumber: 1, triggerType: 'manual' });
    const flowId = published.body.data.flowId;
    expect((await request(app).get(`/api/flows?projectId=${project.id}`).set(as(admin))).body.data.some((item) => item.id === flowId)).toBe(false);
    expect((await request(app).get(`/api/flows?projectId=${project.id}&includeProcesses=1`).set(as(admin))).body.data.some((item) => item.id === flowId)).toBe(true);

    expect((await request(app).post(`/api/bpmn/${id}/run`).set(as(viewer)).send({})).status).toBe(403);
    const started = await request(app).post(`/api/bpmn/${id}/run`).set(as(operator)).send({ input: { item: 'Laptop', amount: 1200 } });
    expect(started.status).toBe(202);
    const runId = started.body.data.id;
    let detail = await runDetail(runId, viewer);
    expect(detail).toMatchObject({ status: 'RUNNING', processId: id, versionNumber: 1 });
    expect(detail.xml).toContain('Lane_Manager');
    expect(detail.states).toMatchObject({ Start_Request: 'done', Flow_ToApprove: 'done', Task_Approve: 'active' });

    const tasks = await request(app).get(`/api/tasks?status=pending&projectId=${project.id}`).set(as(manager));
    const task = tasks.body.data.find((item) => item.flowRunId === runId);
    expect(task.title).toBe('Approve purchase: Laptop (1200)');
    expect(task.assignedRole).toBe('project_manager');
    expect((await request(app).post(`/api/tasks/${task.id}/complete`).set(as(manager)).send({ outcome: 'approve', comment: 'ok' })).status).toBe(200);

    detail = await runDetail(runId);
    const robot = detail.nodes.find((node) => node.nodeId === 'Task_CreatePO');
    expect(robot.status).toBe('WAITING');
    expect(detail.states).toMatchObject({ Task_Approve: 'done', Gateway_Approved: 'done', Flow_Approved: 'done', Task_CreatePO: 'active' });
    const [[job]] = await pool.query(`SELECT input_json FROM automation_jobs WHERE id = ?`, [robot.jobId]);
    expect((typeof job.input_json === 'string' ? JSON.parse(job.input_json) : job.input_json)).toMatchObject({ item: 'Laptop' });
    expect((await processNextNativeJob(pool, cfg, 'bpmn-worker')).status).toBe('SUCCEEDED');
    await advanceFlows(pool, cfg);

    detail = await runDetail(runId);
    expect(detail.status).toBe('SUCCEEDED');
    expect(detail.states).toMatchObject({ Task_CreatePO: 'done', End_Ordered: 'done' });
    expect(detail.states.End_Rejected).toBeUndefined();
    expect(detail.states.Flow_Rejected).toBeUndefined();
    expect(detail.variables.approval.outcome).toBe('approve');
    expect(detail.events.find((item) => item.nodeId === 'Task_Approve').elementId).toBe('Task_Approve');

    const runs = await request(app).get(`/api/bpmn/${id}/runs`).set(as(admin));
    expect(runs.body.meta.total).toBe(1);
    expect(runs.body.data[0]).toMatchObject({ id: runId, status: 'SUCCEEDED', versionNumber: 1 });
    const listed = (await request(app).get(`/api/bpmn?projectId=${project.id}`).set(as(admin))).body.data.find((item) => item.id === id);
    expect(listed).toMatchObject({ runCount: 1, lastRun: { status: 'SUCCEEDED' } });
    expect((await request(app).get(`/api/bpmn-runs/${runId}`).set(as(outsider))).status).toBe(403);
    const [audit] = await pool.query(`SELECT action FROM audit_logs WHERE entity_id = ?`, [id]);
    expect(audit.map((row) => row.action)).toEqual(expect.arrayContaining(['bpmn.create', 'bpmn.publish', 'bpmn.run']));

    // Reject takes the default flow; a second publish makes version 2 and keeps old runs on version 1.
    const second = await request(app).post(`/api/bpmn/${id}/run`).set(as(admin)).send({ input: { item: 'Car', amount: 90000 } });
    const taskId = (await runDetail(second.body.data.id)).nodes.find((node) => node.nodeId === 'Task_Approve').taskId;
    await request(app).post(`/api/tasks/${taskId}/complete`).set(as(manager)).send({ outcome: 'reject' });
    const rejected = await runDetail(second.body.data.id);
    expect(rejected.status).toBe('SUCCEEDED');
    expect(rejected.states).toMatchObject({ Flow_Rejected: 'done', End_Rejected: 'done' });
    expect(rejected.states.Task_CreatePO).toBeUndefined();
    expect((await request(app).post(`/api/bpmn/${id}/publish`).set(as(admin))).body.data.versionNumber).toBe(2);
    expect((await runDetail(runId)).versionNumber).toBe(1);

    expect((await request(app).post(`/api/bpmn/${id}/disable`).set(as(operator))).status).toBe(403);
    expect((await request(app).post(`/api/bpmn/${id}/disable`).set(as(admin))).body.data.status).toBe('disabled');
    expect((await request(app).post(`/api/bpmn/${id}/run`).set(as(admin)).send({})).status).toBe(409);
    expect((await request(app).post(`/api/bpmn/${id}/enable`).set(as(admin))).body.data.status).toBe('published');
  });

  it('starts from a message start event (webhook) and a timer start event (schedule)', async () => {
    const hookXml = blankProcessXml('Hook').replace('<bpmn:startEvent id="StartEvent_1" name="Start">', '<bpmn:startEvent id="StartEvent_1" name="Start"><bpmn:messageEventDefinition id="Msg_1" />');
    expect(hookXml).toContain('Msg_1');
    const hook = (await create({ name: 'Order received', xml: hookXml })).body.data;
    const published = (await request(app).post(`/api/bpmn/${hook.id}/publish`).set(as(admin))).body.data;
    expect(published.triggerType).toBe('webhook');
    expect(published.webhookToken).toMatch(/^[0-9a-f]{48}$/);
    expect(published.webhookUrl).toBe(`/api/hooks/flows/${published.flowId}`);
    expect((await request(app).post(published.webhookUrl).set('X-URAP-Flow-Token', 'nope').send({})).status).toBe(401);
    const hooked = await request(app).post(published.webhookUrl).set('X-URAP-Flow-Token', published.webhookToken).send({ orderId: 'A-1' });
    expect(hooked.status).toBe(202);
    const detail = await runDetail(hooked.body.data.id);
    expect(detail).toMatchObject({ status: 'SUCCEEDED', triggerSource: 'webhook' });
    expect(detail.states).toMatchObject({ StartEvent_1: 'done', Flow_1: 'done', EndEvent_1: 'done' });
    const rotated = await request(app).post(`/api/bpmn/${hook.id}/webhook-token`).set(as(admin));
    expect(rotated.body.data.webhookToken).not.toBe(published.webhookToken);
    expect((await request(app).post(published.webhookUrl).set('X-URAP-Flow-Token', published.webhookToken).send({})).status).toBe(401);

    const timerXml = blankProcessXml('Nightly').replace('<bpmn:startEvent id="StartEvent_1" name="Start">', '<bpmn:startEvent id="StartEvent_1" name="Start"><bpmn:timerEventDefinition id="Timer_1"><bpmn:timeCycle>R/P1D</bpmn:timeCycle></bpmn:timerEventDefinition>');
    const timer = (await create({ name: 'Nightly', xml: timerXml })).body.data;
    const scheduled = (await request(app).post(`/api/bpmn/${timer.id}/publish`).set(as(admin))).body.data;
    expect(scheduled).toMatchObject({ triggerType: 'schedule', scheduleCron: '0 0 * * *' });
    expect(scheduled.nextRunAt).toBeTruthy();
    await pool.query(`UPDATE flows SET next_run_at = DATE_SUB(UTC_TIMESTAMP(3), INTERVAL 1 MINUTE) WHERE id = ?`, [scheduled.flowId]);
    await advanceFlows(pool, cfg);
    const runs = (await request(app).get(`/api/bpmn/${timer.id}/runs`).set(as(admin))).body.data;
    expect(runs).toHaveLength(1);
    expect(runs[0].triggerSource).toBe('schedule');
  });
});
