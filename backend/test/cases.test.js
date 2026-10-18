// Cases: definition rules, case type CRUD + publish + permissions, case creation (UI/API, webhook,
// Flow step, App action), stage progression with auto human + robot tasks, exit conditions,
// manual moves and skip rules, SLA at-risk/breach + escalations with a fake clock, holds pausing
// SLAs, comments, attachments, list filters, board, and summary.
import crypto from 'node:crypto';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { loadConfig } from '../src/config.js';
import { createPool } from '../src/db/pool.js';
import { createApp } from '../src/http/createApp.js';
import { hashPassword } from '../src/lib/passwords.js';
import { processNextNativeJob } from '../src/services/jobService.js';
import { advanceRun } from '../src/flow/engine.js';
import { advanceCase, checkCaseSlas, fromSql, holdCase, loadCase, resumeCase } from '../src/case/engine.js';
import {
  caseContext, conditionsMet, emptyDefinition, newStage, newTask, slaState, validateCaseFields, validateCaseTypeDefinition,
} from '../src/case/definition.js';
import { buildToolSchemas, newTool, validateAgentConfig } from '../src/agent/config.js';
import { emptyDefinition as emptyAppDefinition, newComponent } from '../src/app/definition.js';

const base = loadConfig();
const cfg = { ...base, ai: { provider: 'mock', model: 'mock-1', apiKey: '', baseUrl: '', apiVersion: '', allowMock: true, requestTimeoutMs: 5000 } };
const pool = createPool(base.databaseUrl);
const app = createApp({ pool, config: cfg });
const tenantId = '00000000-0000-4000-8000-000000000001';
const PASSWORD = 'Cases-pass-1234';
const HOUR = 3600000;
let admin; let manager; let developer; let operator; let viewer; let outsider;
let project; let workflowId; let caseTypeId;

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
const json = (value) => (typeof value === 'string' ? JSON.parse(value) : value);
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function workflow(name) {
  const created = await request(app).post('/api/workflows').set(as(admin)).send({ projectId: project.id, name });
  const id = created.body.data.id;
  await request(app).post(`/api/workflows/${id}/draft`).set(as(admin)).send({ definition: { schemaVersion: '1.0', retryPolicy: { maxAttempts: 1, backoffSeconds: 0 }, steps: [
    { id: 'start', type: 'start', name: 'Start', next: 'log' },
    { id: 'log', type: 'log_message', name: 'Log', config: { level: 'info', message: 'Checked {{input.vendor}}' }, next: 'end' },
    { id: 'end', type: 'end', name: 'End', config: { summaryFrom: ['log'] } },
  ] } });
  expect((await request(app).post(`/api/workflows/${id}/publish`).set(as(admin))).status).toBe(200);
  return id;
}

/** Vendor onboarding: Intake -> Verification (robot + human) -> Approval -> Done. */
function vendorDefinition() {
  return {
    fields: [
      { name: 'vendorName', label: 'Vendor name', type: 'text', required: true },
      { name: 'taxId', label: 'Tax ID', type: 'text', required: false },
      { name: 'tier', label: 'Tier', type: 'select', options: ['standard', 'strategic'], required: false },
    ],
    stages: [
      { id: 'intake', name: 'Intake', entryConditions: [], exitConditions: [{ path: 'fields.taxId', op: 'not_empty' }], allowSkip: false, sla: null, escalations: [],
        tasks: [{ id: 'collect', name: 'Collect tax details', kind: 'human', required: false, auto: true, config: { title: 'Tax details for {{case.fields.vendorName}}', taskType: 'form', formFields: [{ name: 'taxId', label: 'Tax ID', type: 'text', required: true }] } }] },
      { id: 'verification', name: 'Verification', entryConditions: [], exitConditions: [], allowSkip: false, sla: { hours: 4, warnAt: 75 },
        escalations: [
          { id: 'esc1', when: 'breached', action: 'raise_priority', config: { priority: 'critical' } },
          { id: 'esc2', when: 'breached', action: 'reassign', config: { userId: '' } },
          { id: 'esc3', when: 'breached', action: 'create_task', config: { title: 'Verification overdue: {{case.reference}}', assignedRole: 'project_manager' } },
        ],
        tasks: [
          { id: 'check', name: 'Sanctions check', kind: 'workflow', required: true, auto: true, config: { workflowId: '', inputs: [{ key: 'vendor', value: '{{fields.vendorName}}' }] } },
          { id: 'review', name: 'Review documents', kind: 'human', required: true, auto: true, config: { title: 'Review {{case.reference}}', taskType: 'approval' } },
          { id: 'extra', name: 'Optional site visit', kind: 'human', required: false, auto: false, config: { title: 'Site visit {{case.reference}}' } },
        ] },
      { id: 'approval', name: 'Approval', entryConditions: [], exitConditions: [{ path: 'tasks.approve.outcome', op: 'eq', value: 'approve' }], allowSkip: true, sla: { hours: 24, warnAt: 75 }, escalations: [],
        tasks: [{ id: 'approve', name: 'Approve vendor', kind: 'human', required: true, auto: true, config: { title: 'Approve {{case.title}}', taskType: 'approval' } }] },
      { id: 'done', name: 'Done', entryConditions: [], exitConditions: [], allowSkip: false, sla: null, escalations: [], tasks: [] },
    ],
    sla: { hours: 48, warnAt: 50 },
    escalations: [{ id: 'notify1', when: 'at_risk', action: 'notify', config: { message: '{{case.reference}} is halfway through its SLA' } }],
    settings: { defaultPriority: 'medium', defaultOwnerUserId: '', workerRoles: ['administrator', 'project_manager', 'automation_developer', 'operator'] },
  };
}

async function openCase(user, fields = { vendorName: 'Acme Corp' }, extra = {}) {
  const response = await request(app).post('/api/cases').set(as(user)).send({ caseTypeId, title: `Onboard ${fields.vendorName || 'vendor'}`, fields, source: 'manual', ...extra });
  expect(response.status, JSON.stringify(response.body)).toBe(201);
  return response.body.data;
}
const detail = async (id, user = admin) => (await request(app).get(`/api/cases/${id}`).set(as(user))).body.data;
const currentTask = (data, key) => [...data.tasks].reverse().find((task) => task.taskKey === key && task.visit === data.stageVisit);
async function completeAction(taskId, user, body) {
  const response = await request(app).post(`/api/tasks/${taskId}/complete`).set(as(user)).send(body);
  expect(response.status, JSON.stringify(response.body)).toBe(200);
}
async function runJob(jobId) {
  for (let i = 0; i < 30; i += 1) {
    const [rows] = await pool.query(`SELECT status FROM automation_jobs WHERE id = ?`, [jobId]);
    if (['SUCCEEDED', 'FAILED'].includes(rows[0].status)) return rows[0].status;
    await processNextNativeJob(pool, cfg, 'cases-test');
  }
  throw new Error('job did not finish');
}

beforeAll(async () => {
  const stamp = Date.now();
  admin = await createUser(`cases-admin-${stamp}@urap.test`, 'administrator');
  manager = await createUser(`cases-pm-${stamp}@urap.test`, 'project_manager');
  developer = await createUser(`cases-dev-${stamp}@urap.test`, 'automation_developer');
  operator = await createUser(`cases-op-${stamp}@urap.test`, 'operator');
  viewer = await createUser(`cases-viewer-${stamp}@urap.test`, 'viewer');
  outsider = await createUser(`cases-outsider-${stamp}@urap.test`, 'operator');
  project = (await request(app).post('/api/projects').set(as(admin)).send({ name: 'Case project', description: 'cases', category: 'general' })).body.data;
  for (const [user, role] of [[manager, 'project_manager'], [developer, 'automation_developer'], [operator, 'operator'], [viewer, 'viewer']]) {
    expect((await request(app).post(`/api/projects/${project.id}/members`).set(as(admin)).send({ userId: user.id, role })).status).toBe(201);
  }
  workflowId = await workflow('Sanctions check');
});

afterAll(async () => {
  await new Promise((resolve) => setTimeout(resolve, 300));
  // Test files share one database and run one after another: leave no queued jobs for the next file's worker.
  if (project) await pool.query(`UPDATE automation_jobs SET status = 'CANCELLED', updated_at = UTC_TIMESTAMP(3) WHERE project_id = ? AND status IN ('QUEUED', 'RETRY_WAIT')`, [project.id]);
  await pool.end();
});

describe('case definitions', () => {
  it('validates stages, tasks, conditions, SLAs, and escalations', () => {
    expect(validateCaseTypeDefinition(emptyDefinition()).errors).toEqual([]);
    const definition = vendorDefinition();
    const lookups = { workflows: new Map([['w-draft', { name: 'Draft wf', status: 'draft' }]]), flows: new Map(), agents: new Map(), users: new Set() };
    definition.stages[1].tasks[0].config.workflowId = 'w-draft';
    definition.stages[0].exitConditions.push({ path: 'tasks.approve.outcome', op: 'eq', value: 'approve' });
    definition.stages[1].sla = { hours: 0, warnAt: 120 };
    definition.fields[2].options = [];
    definition.stages[1].escalations[1].config.userId = 'missing-user';
    const { errors } = validateCaseTypeDefinition(definition, lookups);
    const messages = errors.map((item) => item.message).join('\n');
    expect(messages).toContain('Draft wf must be published');
    expect(messages).toContain('not in this or an earlier stage (approve)');
    expect(messages).toContain('the SLA must be more than 0');
    expect(messages).toContain('warn at 1 to 99%');
    expect(messages).toContain('add the options to choose from');
    expect(messages).toContain('the person to reassign to is not an active user');
    const draft = emptyDefinition();
    draft.stages.splice(1, 0, newStage(draft.stages));
    draft.stages[1].tasks.push(newTask('workflow', draft));
    expect(validateCaseTypeDefinition(draft).errors.map((item) => item.message)).toEqual([expect.stringContaining('choose the workflow')]);
  });

  it('evaluates conditions, field values, and SLA states', () => {
    const ctx = caseContext({ fields: { taxId: 'TX', amount: 5 } }, [{ taskKey: 'approve', status: 'completed', outcome: 'approve', attempt: 1 }]);
    expect(conditionsMet([{ path: 'fields.taxId', op: 'not_empty' }, { path: 'tasks.approve.outcome', op: 'eq', value: 'approve' }], ctx)).toBe(true);
    expect(conditionsMet([{ path: 'fields.amount', op: 'gt', value: '10' }], ctx)).toBe(false);
    const schema = vendorDefinition().fields;
    expect(validateCaseFields(schema, {}).errors[0].message).toBe('Vendor name is required');
    expect(validateCaseFields(schema, { vendorName: 'A', tier: 'gold' }).errors[0].message).toContain('must be one of');
    expect(validateCaseFields(schema, { tier: 'strategic' }, { partial: true })).toEqual({ values: { tier: 'strategic' }, errors: [] });
    const start = Date.UTC(2026, 0, 1);
    expect(slaState({ start, due: start + 10 * HOUR, warnAt: 75, now: start + HOUR })).toBe('on_track');
    expect(slaState({ start, due: start + 10 * HOUR, warnAt: 75, now: start + 8 * HOUR })).toBe('at_risk');
    expect(slaState({ start, due: start + 10 * HOUR, warnAt: 75, now: start + 10 * HOUR })).toBe('breached');
  });

  it('offers an open_case agent tool', () => {
    const tool = { ...newTool('case', []), caseTypeId: 'ct1' };
    expect(tool.name).toBe('open_case');
    expect(buildToolSchemas({ tools: [tool] })[0].parameters.required).toEqual(['title']);
    const lookups = { workflows: new Map(), connections: new Map(), users: new Set(), caseTypes: new Map([['ct1', { name: 'Draft type', status: 'draft' }]]) };
    expect(validateAgentConfig({ ...{ instructions: 'x', temperature: 0.2, maxSteps: 4, maxTokens: 256, maxTotalTokens: 5000, toolTimeoutMinutes: 10 }, tools: [tool] }, lookups).errors.map((item) => item.message)).toEqual(['open_case: Draft type is not published']);
  });
});

describe('case types API', () => {
  it('creates, saves, validates, and publishes with role checks', async () => {
    expect((await request(app).post('/api/case-types').set(as(operator)).send({ projectId: project.id, name: 'Nope' })).status).toBe(403);
    const created = await request(app).post('/api/case-types').set(as(developer)).send({ projectId: project.id, name: 'Vendor onboarding' });
    expect(created.status, JSON.stringify(created.body)).toBe(201);
    expect(created.body.data.prefix).toBe('VO');
    caseTypeId = created.body.data.id;
    expect((await request(app).get(`/api/case-types/${caseTypeId}`).set(as(outsider))).status).toBe(403);
    const definition = vendorDefinition();
    let saved = await request(app).put(`/api/case-types/${caseTypeId}/draft`).set(as(developer)).send({ definition });
    expect(saved.status).toBe(200);
    expect(saved.body.data.validation.errors.map((item) => item.message).join(' ')).toContain('choose the workflow');
    expect((await request(app).post(`/api/case-types/${caseTypeId}/publish`).set(as(developer))).status).toBe(400);
    definition.stages[1].tasks[0].config.workflowId = workflowId;
    definition.stages[1].escalations[1].config.userId = manager.id;
    saved = await request(app).put(`/api/case-types/${caseTypeId}/draft`).set(as(developer)).send({ definition });
    expect(saved.body.data.validation.errors).toEqual([]);
    const published = await request(app).post(`/api/case-types/${caseTypeId}/publish`).set(as(developer));
    expect(published.status, JSON.stringify(published.body)).toBe(200);
    expect(published.body.data).toMatchObject({ status: 'published', versionNumber: 1 });
    const list = await request(app).get(`/api/case-types?projectId=${project.id}&published=1`).set(as(operator));
    expect(list.body.data[0]).toMatchObject({ name: 'Vendor onboarding', canOpen: true });
    expect(list.body.data[0].published.stages.map((stage) => stage.name)).toEqual(['Intake', 'Verification', 'Approval', 'Done']);
    const [audit] = await pool.query(`SELECT action FROM audit_logs WHERE entity_id = ? ORDER BY created_at`, [caseTypeId]);
    expect(audit.map((row) => row.action)).toEqual(expect.arrayContaining(['case_type.create', 'case_type.save_draft', 'case_type.publish']));
  });
});

describe('cases', () => {
  it('runs stages with auto human and robot tasks through to resolution', async () => {
    expect((await request(app).post('/api/cases').set(as(viewer)).send({ caseTypeId, fields: { vendorName: 'X' } })).status).toBe(403);
    expect((await request(app).post('/api/cases').set(as(operator)).send({ caseTypeId, fields: {} })).status).toBe(400);
    const opened = await openCase(operator);
    expect(opened).toMatchObject({ reference: 'VO-0001', status: 'open', currentStageId: 'intake', ownerUserId: operator.id, slaState: 'on_track', source: 'manual' });
    let data = await detail(opened.id, operator);
    const collect = currentTask(data, 'collect');
    expect(collect).toMatchObject({ status: 'in_progress', kind: 'human' });
    const [actions] = await pool.query(`SELECT case_id, title FROM action_tasks WHERE id = ?`, [collect.actionTaskId]);
    expect(actions[0]).toEqual({ case_id: opened.id, title: 'Tax details for Acme Corp' });
    await completeAction(collect.actionTaskId, operator, { outcome: 'submit', data: { taxId: 'TX-42' } });
    data = await detail(opened.id, operator);
    expect(data.fields.taxId).toBe('TX-42');
    expect(data.currentStageId).toBe('verification');
    expect(data.stageSlaState).toBe('on_track');
    const check = currentTask(data, 'check');
    const review = currentTask(data, 'review');
    expect(check).toMatchObject({ kind: 'workflow', status: 'in_progress' });
    expect(currentTask(data, 'extra')).toMatchObject({ status: 'not_started', required: false });
    const [jobs] = await pool.query(`SELECT case_id, trigger_source, input_json FROM automation_jobs WHERE id = ?`, [check.jobId]);
    expect(jobs[0]).toMatchObject({ case_id: opened.id, trigger_source: 'case' });
    expect(json(jobs[0].input_json)).toEqual({ vendor: 'Acme Corp' });
    expect(await runJob(check.jobId)).toBe('SUCCEEDED');
    data = await detail(opened.id, operator);
    expect(currentTask(data, 'check').status).toBe('completed');
    expect(data.currentStageId).toBe('verification');
    await completeAction(review.actionTaskId, operator, { outcome: 'approve' });
    data = await detail(opened.id, operator);
    expect(data.currentStageId).toBe('approval');
    expect(currentTask(data, 'extra')).toBeUndefined();
    const approve = currentTask(data, 'approve');
    await completeAction(approve.actionTaskId, manager, { outcome: 'reject', comment: 'Missing bank letter' });
    data = await detail(opened.id, operator);
    expect(data.currentStageId).toBe('approval');
    expect(currentTask(data, 'approve')).toMatchObject({ status: 'completed', outcome: 'reject' });
    // Exit condition not met: retry the approval task (new attempt) and approve this time.
    const retried = await request(app).post(`/api/cases/${opened.id}/tasks/${currentTask(data, 'approve').id}/retry`).set(as(operator));
    expect(retried.status).toBe(409);
    const moved = await request(app).post(`/api/cases/${opened.id}/move`).set(as(manager)).send({ stageId: 'verification', reason: 'Re-check' });
    expect(moved.status, JSON.stringify(moved.body)).toBe(200);
    expect(moved.body.data.currentStageId).toBe('verification');
    data = moved.body.data;
    expect(await runJob(currentTask(data, 'check').jobId)).toBe('SUCCEEDED');
    await completeAction(currentTask(await detail(opened.id), 'review').actionTaskId, operator, { outcome: 'approve' });
    data = await detail(opened.id);
    expect(data.currentStageId).toBe('approval');
    expect(currentTask(data, 'approve').attempt).toBe(2);
    await completeAction(currentTask(data, 'approve').actionTaskId, manager, { outcome: 'approve' });
    data = await detail(opened.id);
    expect(data).toMatchObject({ status: 'resolved', currentStageId: 'done', slaState: 'met' });
    const events = data.events.map((event) => event.event);
    expect(events).toEqual(expect.arrayContaining(['case.created', 'stage.entered', 'task.started', 'task.completed', 'fields.updated', 'stage.completed', 'stage.moved', 'case.resolved']));
    expect((await request(app).post(`/api/cases/${opened.id}/close`).set(as(operator))).status).toBe(200);
    expect((await request(app).patch(`/api/cases/${opened.id}`).set(as(operator)).send({ title: 'x' })).status).toBe(409);
  });

  it('enforces move, skip, and manage permissions', async () => {
    const opened = await openCase(developer, { vendorName: 'Beta Ltd', taxId: 'TX-B' });
    expect(opened.currentStageId).toBe('verification');
    expect((await request(app).post(`/api/cases/${opened.id}/move`).set(as(operator)).send({ stageId: 'approval' })).status).toBe(403);
    const skip = await request(app).post(`/api/cases/${opened.id}/move`).set(as(developer)).send({ stageId: 'approval' });
    expect(skip.status).toBe(409);
    expect(skip.body.error.code).toBe('SKIP_NOT_ALLOWED');
    let data = await detail(opened.id);
    expect((await request(app).post(`/api/cases/${opened.id}/tasks/${currentTask(data, 'review').id}/skip`).set(as(operator))).status).toBe(403);
    const optional = await request(app).post(`/api/cases/${opened.id}/tasks/${currentTask(data, 'extra').id}/skip`).set(as(operator));
    expect(optional.status).toBe(200);
    expect(currentTask(optional.body.data, 'extra').status).toBe('skipped');
    const forced = await request(app).post(`/api/cases/${opened.id}/move`).set(as(admin)).send({ stageId: 'approval' });
    expect(forced.status).toBe(200);
    data = forced.body.data;
    expect(data.currentStageId).toBe('approval');
    const [cancelled] = await pool.query(`SELECT status FROM action_tasks WHERE id = ?`, [data.tasks.find((task) => task.taskKey === 'review').actionTaskId]);
    expect(cancelled[0].status).toBe('cancelled');
    // Approval allows skipping: an operator may skip its required task, and the case resolves.
    const skipped = await request(app).post(`/api/cases/${opened.id}/tasks/${currentTask(data, 'approve').id}/skip`).set(as(operator)).send({ reason: 'Pre-approved vendor' });
    expect(skipped.status).toBe(200);
    expect(skipped.body.data.currentStageId).toBe('approval');
    const resolved = await request(app).post(`/api/cases/${opened.id}/resolve`).set(as(manager)).send({ comment: 'Pre-approved' });
    expect(resolved.body.data.status).toBe('resolved');
    const reopened = await request(app).post(`/api/cases/${opened.id}/reopen`).set(as(manager)).send({ stageId: 'verification' });
    expect(reopened.body.data).toMatchObject({ status: 'open', currentStageId: 'verification' });
    const cancelledCase = await request(app).post(`/api/cases/${opened.id}/cancel`).set(as(manager)).send({ comment: 'Duplicate' });
    expect(cancelledCase.body.data.status).toBe('cancelled');
    const open = cancelledCase.body.data.tasks.filter((task) => ['in_progress', 'not_started'].includes(task.status));
    expect(open).toEqual([]);
  });

  it('marks SLAs at risk and breached with a fake clock and escalates once', async () => {
    const opened = await openCase(operator, { vendorName: 'Gamma', taxId: 'TX-9' });
    let row = await loadCase(pool, opened.id);
    expect(row.current_stage_id).toBe('verification');
    const created = fromSql(row.due_at).getTime() - 48 * HOUR;
    expect(await checkCaseSlas(pool, cfg, { now: new Date(created + HOUR) })).toBeGreaterThanOrEqual(0);
    expect((await loadCase(pool, opened.id)).sla_state).toBe('on_track');
    await checkCaseSlas(pool, cfg, { now: new Date(created + 25 * HOUR) });
    row = await loadCase(pool, opened.id);
    expect(row.sla_state).toBe('at_risk');
    expect(row.stage_sla_state).toBe('breached');
    expect(row.priority).toBe('critical');
    expect(row.assignee_user_id).toBe(manager.id);
    const [escalationTasks] = await pool.query(`SELECT title, assigned_role FROM action_tasks WHERE case_id = ? AND step_key LIKE 'case:escalation:%'`, [opened.id]);
    expect(escalationTasks).toEqual([{ title: 'Verification overdue: VO-0004'.replace('VO-0004', row.reference), assigned_role: 'project_manager' }]);
    const [notes] = await pool.query(`SELECT subject, body FROM notifications WHERE project_id = ? AND subject LIKE ?`, [project.id, `${row.reference}%`]);
    expect(notes.map((note) => note.subject)).toEqual(expect.arrayContaining([`${row.reference}: Case SLA at risk`, `${row.reference}: Verification SLA breached`, `${row.reference}: escalation (Case SLA at risk)`]));
    expect(notes.find((note) => note.subject.includes('escalation')).body).toBe(`${row.reference} is halfway through its SLA`);
    await checkCaseSlas(pool, cfg, { now: new Date(created + 47 * HOUR) });
    await checkCaseSlas(pool, cfg, { now: new Date(created + 49 * HOUR) });
    row = await loadCase(pool, opened.id);
    expect(row.sla_state).toBe('breached');
    const [again] = await pool.query(`SELECT COUNT(*) AS n FROM action_tasks WHERE case_id = ? AND step_key LIKE 'case:escalation:%'`, [opened.id]);
    expect(Number(again[0].n)).toBe(1);
    const filtered = await request(app).get(`/api/cases?projectId=${project.id}&sla=breached`).set(as(operator));
    expect(filtered.body.data.map((item) => item.id)).toContain(opened.id);
    const summary = await request(app).get(`/api/cases/summary?projectId=${project.id}`).set(as(operator));
    expect(summary.body.data.breached).toBeGreaterThanOrEqual(1);
  });

  it('pauses SLA timers while a case is on hold', async () => {
    const opened = await openCase(operator, { vendorName: 'Delta' });
    const before = await loadCase(pool, opened.id);
    const t0 = new Date();
    await holdCase(pool, before, operator, { reason: 'Waiting for vendor', now: t0 });
    const held = await loadCase(pool, opened.id);
    expect(held.status).toBe('on_hold');
    await checkCaseSlas(pool, cfg, { now: new Date(t0.getTime() + 47 * HOUR) });
    expect((await loadCase(pool, opened.id)).sla_state).toBe('on_track');
    await resumeCase(pool, cfg, held, operator, { now: new Date(t0.getTime() + 3 * HOUR) });
    const resumed = await loadCase(pool, opened.id);
    expect(resumed.status).toBe('open');
    expect(fromSql(resumed.due_at).getTime() - fromSql(before.due_at).getTime()).toBe(3 * HOUR);
    const api = await request(app).post(`/api/cases/${opened.id}/hold`).set(as(operator)).send({ reason: 'Again' });
    expect(api.body.data.status).toBe('on_hold');
    expect((await request(app).post(`/api/cases/${opened.id}/resume`).set(as(operator))).body.data.status).toBe('open');
    expect((await request(app).post(`/api/cases/${opened.id}/hold`).set(as(viewer))).status).toBe(403);
  });

  it('updates fields, comments, attachments, list, and board', async () => {
    const opened = await openCase(operator, { vendorName: 'Echo' });
    const bad = await request(app).patch(`/api/cases/${opened.id}`).set(as(operator)).send({ fields: { tier: 'gold' } });
    expect(bad.status).toBe(400);
    expect((await request(app).patch(`/api/cases/${opened.id}`).set(as(developer)).send({ priority: 'high' })).status).toBe(403);
    const updated = await request(app).patch(`/api/cases/${opened.id}`).set(as(operator)).send({ fields: { taxId: 'TX-77', tier: 'strategic' }, assigneeUserId: developer.id });
    expect(updated.status, JSON.stringify(updated.body)).toBe(200);
    expect(updated.body.data).toMatchObject({ currentStageId: 'verification', assigneeUserId: developer.id });
    const commented = await request(app).post(`/api/cases/${opened.id}/comments`).set(as(operator)).send({ body: 'Called the vendor' });
    expect(commented.body.data.comments.map((item) => item.body)).toEqual(['Called the vendor']);
    const attached = await request(app).post(`/api/cases/${opened.id}/attachments`).set(as(operator)).attach('file', Buffer.from('a,b\n1,2\n'), 'vendor.csv');
    expect(attached.status, JSON.stringify(attached.body)).toBe(201);
    const attachment = attached.body.data.attachments[0];
    expect(attachment.fileName).toBe('vendor.csv');
    expect((await request(app).get(`/api/artifacts/${attachment.artifactId}/download`).set(as(operator))).status).toBe(200);
    expect((await request(app).post(`/api/cases/${opened.id}/attachments`).set(as(operator)).attach('file', Buffer.from('nope'), 'fake.pdf')).status).toBe(400);
    expect((await request(app).get(`/api/cases/${opened.id}`).set(as(outsider))).status).toBe(403);
    const mine = await request(app).get(`/api/cases?projectId=${project.id}&owner=${developer.id}&stageId=verification&status=active`).set(as(operator));
    expect(mine.body.data.map((item) => item.id)).toEqual([opened.id]);
    const board = await request(app).get(`/api/cases/board?caseTypeId=${caseTypeId}`).set(as(operator));
    expect(board.status).toBe(200);
    expect(board.body.data.columns.map((column) => column.name)).toEqual(['Intake', 'Verification', 'Approval', 'Done', 'Resolved']);
    expect(board.body.data.columns[1].cases.map((item) => item.id)).toContain(opened.id);
  });

  it('opens cases from the webhook, a Flow step, and an App action', async () => {
    expect((await request(app).post(`/api/hooks/cases/${caseTypeId}`).set('X-URAP-Case-Token', 'wrong').send({ fields: { vendorName: 'W' } })).status).toBe(401);
    const token = (await request(app).post(`/api/case-types/${caseTypeId}/webhook-token`).set(as(admin))).body.data.webhookToken;
    const hooked = await request(app).post(`/api/hooks/cases/${caseTypeId}`).set('X-URAP-Case-Token', token).send({ title: 'From ERP', reference: 'ERP-1', fields: { vendorName: 'Webhook Inc' } });
    expect(hooked.status, JSON.stringify(hooked.body)).toBe(201);
    expect((await loadCase(pool, hooked.body.data.id))).toMatchObject({ source: 'webhook', source_ref: 'ERP-1', title: 'From ERP' });

    const flow = await request(app).post('/api/flows').set(as(admin)).send({ projectId: project.id, name: 'Onboard from flow' });
    const flowId = flow.body.data.id;
    const saved = await request(app).put(`/api/flows/${flowId}/draft`).set(as(admin)).send({ definition: {
      variables: [{ name: 'vendor', defaultValue: '' }],
      nodes: [
        { id: 'start', type: 'start', name: 'Start', x: 0, y: 0, config: { trigger: 'manual' } },
        { id: 'open', type: 'case', name: 'Create case', x: 1, y: 0, config: { caseTypeId, title: 'Flow: {{vars.vendor}}', fields: { vendorName: '{{vars.vendor}}', taxId: 'TX-F' }, priority: 'high', waitForResolution: true, outputVar: 'vendorCase' } },
        { id: 'end', type: 'end', name: 'End', x: 2, y: 0, config: {} },
      ],
      edges: [{ id: 'e1', from: 'start', to: 'open' }, { id: 'e2', from: 'open', to: 'end' }],
    } });
    expect(saved.body.data.validation.errors).toEqual([]);
    expect((await request(app).post(`/api/flows/${flowId}/publish`).set(as(admin))).status).toBe(200);
    const run = await request(app).post(`/api/flows/${flowId}/run`).set(as(operator)).send({ input: { vendor: 'Flowy' } });
    expect(run.status).toBe(202);
    expect(run.body.data.status).toBe('RUNNING');
    const [flowCases] = await pool.query(`SELECT * FROM cases WHERE source = 'flow' AND source_ref = ?`, [run.body.data.id]);
    expect(flowCases[0]).toMatchObject({ title: 'Flow: Flowy', priority: 'high', current_stage_id: 'verification' });
    expect((await request(app).post(`/api/cases/${flowCases[0].id}/resolve`).set(as(admin)).send({})).status).toBe(200);
    let finished = await advanceRun(pool, cfg, run.body.data.id);
    for (let i = 0; i < 40 && finished.status === 'RUNNING'; i += 1) { await sleep(50); finished = await advanceRun(pool, cfg, run.body.data.id); }
    expect(finished.status).toBe('SUCCEEDED');
    expect(json(finished.variables_json).vendorCase).toMatchObject({ caseId: flowCases[0].id, status: 'resolved', fields: { vendorName: 'Flowy' } });

    const definition = emptyAppDefinition('Vendor portal');
    const button = { ...newComponent('button', []), id: 'openCase', props: { label: 'Open case', variant: 'primary' }, events: { onClick: [
      { id: 'c', type: 'create_case', config: { caseTypeId, title: '{{app.user.name}} request', fields: [{ key: 'vendorName', value: '' }], priority: 'low' }, resultVar: 'created' },
    ] } };
    definition.pages[0].components.push(button);
    const created = await request(app).post('/api/apps').set(as(admin)).send({ projectId: project.id, name: 'Vendor portal' });
    const appId = created.body.data.id;
    const draft = await request(app).put(`/api/apps/${appId}/draft`).set(as(admin)).send({ definition });
    expect(draft.body.data.validation.errors).toEqual([]);
    expect((await request(app).post(`/api/apps/${appId}/publish`).set(as(admin))).status).toBe(200);
    const result = await request(app).post(`/api/apps/${appId}/runtime/actions`).set(as(operator)).send({ componentId: 'openCase', event: 'onClick', actionId: 'c', values: { title: 'Portal request', fields: { vendorName: 'App Vendor', ignored: 'x' } } });
    expect(result.status, JSON.stringify(result.body)).toBe(200);
    expect(result.body.data).toMatchObject({ kind: 'case', done: true });
    const appCase = await loadCase(pool, result.body.data.id);
    expect(appCase).toMatchObject({ source: 'app', source_ref: appId, priority: 'low', title: 'Portal request' });
    expect(json(appCase.fields_json).vendorName).toBe('App Vendor');
    expect(json(appCase.fields_json).ignored).toBeUndefined();
    expect(await advanceCase(pool, cfg, appCase.id)).toMatchObject({ current_stage_id: 'intake' });
  });
});
