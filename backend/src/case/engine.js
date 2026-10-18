// Case engine. A case moves through the stages of its case type version:
//   entering a stage creates a case_tasks row per stage task (auto tasks start right away: an
//   Action Center task, a workflow job, a flow run, or an agent run, linked by case_id)
//   a stage completes when its required tasks are completed or skipped and its exit conditions
//   hold, then the case enters the next stage whose entry conditions hold (others are skipped)
//   after the last stage the case is resolved.
// advanceCase() is idempotent and safe to call from the API and the worker at the same time: a
// short lease on cases.lock_until makes one caller do the work. Everything lives in the database,
// so a restarted worker continues where it stopped. checkCaseSlas() marks at-risk and breached
// SLAs (case and stage), notifies the project, and runs escalation rules once each. Time comes in
// through `now` so tests can use a fake clock. Holding a case pauses its SLA timers.
import crypto from 'node:crypto';
import { writeAudit } from '../db/audit.js';
import { AppError } from '../lib/errors.js';
import { clampJson, redact } from '../lib/redact.js';
import { enqueueJob, cancelJob } from '../services/jobService.js';
import { createTask, presentTask } from '../services/taskService.js';
import { cancelAgentRun, startAgentRun } from '../agent/runtime.js';
import { cancelRun, startRun } from '../flow/engine.js';
import {
  PRIORITIES, caseContext, conditionsMet, findStage, renderMapping, renderTemplate, slaState, stageIndex, validateCaseFields,
} from './definition.js';

const parse = (value) => (typeof value === 'string' ? JSON.parse(value) : value);
export const sqlDate = (date) => new Date(date).toISOString().slice(0, 23).replace('T', ' ');
export const fromSql = (value) => (value ? new Date(`${String(value).replace(' ', 'T')}Z`) : null);
const LEASE_SECONDS = 60;
const MAX_PASSES = 30;
const OPEN_TASK = ['not_started', 'in_progress'];
const DONE_TASK = ['completed', 'skipped'];
const JOB_FAILED = ['FAILED', 'CANCELLED', 'SKIPPED'];
const SEVERITY = { none: 0, met: 0, on_track: 1, at_risk: 2, breached: 3 };
const HOUR = 3600000;

const definitionCache = new Map();

export async function addCaseEvent(pool, caseId, event, message, { actor = null, data = null } = {}) {
  await pool.query(
    `INSERT INTO case_events (id, case_id, event, message, actor_user_id, data_json, created_at) VALUES (?, ?, ?, ?, ?, ?, UTC_TIMESTAMP(3))`,
    [crypto.randomUUID(), caseId, event, String(message).slice(0, 1000), actor?.id || null, data == null ? null : JSON.stringify(clampJson(redact(data)))],
  );
}

export async function loadCase(pool, caseId) {
  const [rows] = await pool.query(`SELECT * FROM cases WHERE id = ?`, [caseId]);
  return rows[0] || null;
}

/** Published versions never change, so their definitions are cached. */
export async function loadCaseDefinition(pool, versionId) {
  if (definitionCache.has(versionId)) return definitionCache.get(versionId);
  const [rows] = await pool.query(`SELECT definition_json FROM case_type_versions WHERE id = ?`, [versionId]);
  if (!rows[0]) throw new AppError(404, 'NOT_FOUND', 'Case type version not found');
  const definition = parse(rows[0].definition_json);
  if (definitionCache.size > 200) definitionCache.clear();
  definitionCache.set(versionId, definition);
  return definition;
}

async function loadTasks(pool, caseId) {
  const [rows] = await pool.query(`SELECT * FROM case_tasks WHERE case_id = ? ORDER BY created_at, attempt`, [caseId]);
  return rows;
}

export function presentCaseTask(row) {
  return {
    id: row.id, caseId: row.case_id, stageId: row.stage_id, taskKey: row.task_key, name: row.name, kind: row.kind,
    required: Boolean(row.required), status: row.status, attempt: row.attempt, visit: row.visit,
    jobId: row.job_id, actionTaskId: row.action_task_id, flowRunId: row.flow_run_id, agentRunId: row.agent_run_id,
    outcome: row.outcome, output: parse(row.output_json), error: row.error_message, completedBy: row.completed_by,
    startedAt: row.started_at, completedAt: row.completed_at, createdAt: row.created_at, updatedAt: row.updated_at,
  };
}

export function presentCase(row, definition = null) {
  const stage = definition ? findStage(definition, row.current_stage_id) : null;
  return {
    id: row.id, projectId: row.project_id, caseTypeId: row.case_type_id, caseTypeVersionId: row.case_type_version_id,
    caseTypeName: row.case_type_name, number: row.case_number, reference: row.reference, title: row.title,
    status: row.status, priority: row.priority, fields: parse(row.fields_json) || {},
    currentStageId: row.current_stage_id, currentStageName: stage?.name || row.current_stage_id || null,
    stageIndex: definition ? stageIndex(definition, row.current_stage_id) : null, stageCount: definition ? definition.stages.length : null,
    stageVisit: row.stage_visit, stageEnteredAt: row.stage_entered_at,
    ownerUserId: row.owner_user_id, ownerEmail: row.owner_email, ownerName: row.owner_name,
    assigneeUserId: row.assignee_user_id, assigneeEmail: row.assignee_email, assigneeName: row.assignee_name,
    dueAt: row.due_at, stageDueAt: row.stage_due_at, slaState: row.sla_state, stageSlaState: row.stage_sla_state,
    holdStartedAt: row.hold_started_at, holdReason: row.hold_reason,
    source: row.source, sourceRef: row.source_ref, createdBy: row.created_by,
    resolvedAt: row.resolved_at, closedAt: row.closed_at, createdAt: row.created_at, updatedAt: row.updated_at,
  };
}

function context(row, tasks) {
  return caseContext(
    { id: row.id, reference: row.reference, title: row.title, priority: row.priority, status: row.status, currentStageId: row.current_stage_id, fields: parse(row.fields_json) || {} },
    tasks.map((task) => ({ taskKey: task.task_key, status: task.status, outcome: task.outcome, output: parse(task.output_json), attempt: task.attempt })),
  );
}

async function notify(pool, row, subject, body) {
  await pool.query(
    `INSERT INTO notifications (id, tenant_id, project_id, job_id, channel, subject, body, created_at) VALUES (?, ?, ?, NULL, 'in_app', ?, ?, UTC_TIMESTAMP(3))`,
    [crypto.randomUUID(), row.tenant_id, row.project_id, String(subject).slice(0, 300), String(body).slice(0, 4000)],
  );
}

export async function activeUser(pool, tenantId, userId) {
  if (!userId) return null;
  const [rows] = await pool.query(`SELECT id, email, display_name, role FROM users WHERE id = ? AND tenant_id = ? AND status = 'active'`, [userId, tenantId]);
  return rows[0] || null;
}

async function nextNumber(pool, caseTypeId) {
  for (let attempt = 0; attempt < 20; attempt += 1) {
    const [rows] = await pool.query(`SELECT next_number FROM case_types WHERE id = ?`, [caseTypeId]);
    const current = rows[0].next_number;
    const [result] = await pool.query(`UPDATE case_types SET next_number = ? WHERE id = ? AND next_number = ?`, [current + 1, caseTypeId, current]);
    if (result.affectedRows === 1) return current + 1;
  }
  throw new AppError(503, 'BUSY', 'Too many cases are being created at once; try again');
}

/** Creates a case of the type's published version and enters its first stage. */
export async function createCase(pool, cfg, { caseType, user = null, title, fields = {}, priority, ownerUserId, assigneeUserId, source = 'manual', sourceRef = null, now = new Date() }) {
  if (caseType.status !== 'published' || !caseType.current_version_id) throw new AppError(409, 'CASE_TYPE_NOT_PUBLISHED', `${caseType.name} is not published`);
  const [projects] = await pool.query(`SELECT status FROM projects WHERE id = ?`, [caseType.project_id]);
  if (projects[0]?.status !== 'active') throw new AppError(409, 'PROJECT_INACTIVE', 'Archived projects cannot open cases');
  const definition = await loadCaseDefinition(pool, caseType.current_version_id);
  const checked = validateCaseFields(definition.fields, redact(fields && typeof fields === 'object' && !Array.isArray(fields) ? fields : {}));
  if (checked.errors.length) throw new AppError(400, 'VALIDATION', checked.errors.map((error) => error.message).join('; '), checked.errors);
  const settings = definition.settings || {};
  const chosenPriority = priority || settings.defaultPriority || 'medium';
  if (!PRIORITIES.includes(chosenPriority)) throw new AppError(400, 'VALIDATION', 'Priority must be low, medium, high, or critical');
  const owner = await activeUser(pool, caseType.tenant_id, ownerUserId || settings.defaultOwnerUserId || user?.id);
  if (ownerUserId && !owner) throw new AppError(400, 'VALIDATION', 'The owner must be an active user');
  const assignee = assigneeUserId ? await activeUser(pool, caseType.tenant_id, assigneeUserId) : null;
  if (assigneeUserId && !assignee) throw new AppError(400, 'VALIDATION', 'The assignee must be an active user');
  const number = await nextNumber(pool, caseType.id);
  const reference = `${caseType.prefix}-${String(number).padStart(4, '0')}`;
  const id = crypto.randomUUID();
  const sla = definition.sla;
  const dueAt = sla ? sqlDate(new Date(now).getTime() + Number(sla.hours) * HOUR) : null;
  const caseTitle = String(title || '').trim().slice(0, 300) || `${caseType.name} ${reference}`;
  await pool.query(
    `INSERT INTO cases (id, tenant_id, project_id, case_type_id, case_type_version_id, case_number, reference, title, status, priority, fields_json,
       owner_user_id, assignee_user_id, due_at, sla_state, stage_sla_state, escalations_json, source, source_ref, created_by, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'open', ?, ?, ?, ?, ?, ?, 'none', '[]', ?, ?, ?, UTC_TIMESTAMP(3), UTC_TIMESTAMP(3))`,
    [id, caseType.tenant_id, caseType.project_id, caseType.id, caseType.current_version_id, number, reference, caseTitle, chosenPriority,
      JSON.stringify(checked.values), owner?.id || null, assignee?.id || null, dueAt, sla ? 'on_track' : 'none', source, sourceRef ? String(sourceRef).slice(0, 80) : null, user?.id || null],
  );
  await addCaseEvent(pool, id, 'case.created', `Case ${reference} opened (${source})`, { actor: user, data: { fields: checked.values, priority: chosenPriority } });
  await writeAudit(pool, { tenantId: caseType.tenant_id, userId: user?.id, action: 'case.create', entityType: 'case', entityId: id, projectId: caseType.project_id, metadata: { caseTypeId: caseType.id, reference, source } });
  return advanceCase(pool, cfg, id, { now, actor: user });
}

async function acquire(pool, caseId) {
  const [result] = await pool.query(
    `UPDATE cases SET lock_until = DATE_ADD(UTC_TIMESTAMP(3), INTERVAL ${LEASE_SECONDS} SECOND)
     WHERE id = ? AND status = 'open' AND (lock_until IS NULL OR lock_until < UTC_TIMESTAMP(3))`,
    [caseId],
  );
  return result.affectedRows === 1;
}

async function updateTask(pool, rowId, fields) {
  const keys = Object.keys(fields);
  await pool.query(`UPDATE case_tasks SET ${keys.map((key) => `${key} = ?`).join(', ')}, updated_at = UTC_TIMESTAMP(3) WHERE id = ?`, [...keys.map((key) => fields[key]), rowId]);
}

function latestByKey(tasks) {
  const map = new Map();
  for (const task of tasks) {
    const current = map.get(task.task_key);
    if (!current || task.attempt >= current.attempt) map.set(task.task_key, task);
  }
  return map;
}

/** The task rows of the stage visit the case is in now (latest attempt per task). */
export function currentStageTasks(row, tasks) {
  return latestByKey(tasks.filter((task) => task.stage_id === row.current_stage_id && task.visit === row.stage_visit));
}

export function stageComplete(row, stage, tasks) {
  const current = currentStageTasks(row, tasks);
  for (const task of stage.tasks || []) {
    if (!task.required) continue;
    const found = current.get(task.id);
    if (!found || !DONE_TASK.includes(found.status)) return false;
  }
  return conditionsMet(stage.exitConditions, context(row, tasks));
}

/** Moves a case forward as far as it can go right now. Returns the fresh case row. */
export async function advanceCase(pool, cfg, caseId, { now = new Date(), actor = null } = {}) {
  if (!(await acquire(pool, caseId))) return loadCase(pool, caseId);
  try {
    for (let pass = 0; pass < MAX_PASSES; pass += 1) {
      let row = await loadCase(pool, caseId);
      if (!row || row.status !== 'open') break;
      const definition = await loadCaseDefinition(pool, row.case_type_version_id);
      if (!row.current_stage_id) {
        await enterStage(pool, cfg, row, definition, definition.stages[0], { now, actor });
        continue;
      }
      const stage = findStage(definition, row.current_stage_id);
      if (!stage) break;
      let tasks = await loadTasks(pool, caseId);
      let changed = false;
      for (const task of currentStageTasks(row, tasks).values()) {
        if (task.status === 'in_progress' && (await syncTask(pool, row, definition, task))) changed = true;
      }
      if (changed) { tasks = await loadTasks(pool, caseId); row = await loadCase(pool, caseId); }
      if (!stageComplete(row, stage, tasks)) break;
      await leaveStage(pool, row, tasks, { actor, message: `${stage.name} completed`, event: 'stage.completed' });
      const next = await nextStage(pool, row, definition, stageIndex(definition, stage.id) + 1, tasks);
      if (next) await enterStage(pool, cfg, row, definition, next, { now, actor });
      else await finishCase(pool, row, 'resolved', { actor, now, cfg, message: 'All stages done: case resolved' });
    }
  } finally {
    await pool.query(`UPDATE cases SET lock_until = NULL WHERE id = ?`, [caseId]);
  }
  return loadCase(pool, caseId);
}

/** First stage from `fromIndex` whose entry conditions hold; stages in between are recorded as skipped. */
async function nextStage(pool, row, definition, fromIndex, tasks) {
  const ctx = context(row, tasks);
  for (let index = fromIndex; index < definition.stages.length; index += 1) {
    const stage = definition.stages[index];
    if (conditionsMet(stage.entryConditions, ctx)) return stage;
    await addCaseEvent(pool, row.id, 'stage.skipped', `${stage.name} skipped: its entry conditions are not met`, { data: { stageId: stage.id } });
  }
  return null;
}

/** Leaves the current stage visit: cancels its open tasks and settles the stage SLA. */
async function leaveStage(pool, row, tasks, { actor = null, message = null, event = null } = {}) {
  for (const task of currentStageTasks(row, tasks).values()) {
    if (!OPEN_TASK.includes(task.status)) continue;
    await cancelLinked(pool, task, actor);
    await updateTask(pool, task.id, { status: 'cancelled', completed_at: sqlDate(new Date()) });
  }
  await pool.query(
    `UPDATE cases SET stage_sla_state = CASE WHEN stage_sla_state IN ('on_track', 'at_risk') THEN 'met' ELSE stage_sla_state END, updated_at = UTC_TIMESTAMP(3) WHERE id = ?`,
    [row.id],
  );
  if (event) await addCaseEvent(pool, row.id, event, message, { actor, data: { stageId: row.current_stage_id } });
}

export async function enterStage(pool, cfg, row, definition, stage, { now = new Date(), actor = null, message = null } = {}) {
  const visit = Number(row.stage_visit || 0) + 1;
  const stageDue = stage.sla ? sqlDate(new Date(now).getTime() + Number(stage.sla.hours) * HOUR) : null;
  await pool.query(
    `UPDATE cases SET current_stage_id = ?, stage_visit = ?, stage_entered_at = ?, stage_due_at = ?, stage_sla_state = ?, updated_at = UTC_TIMESTAMP(3) WHERE id = ?`,
    [stage.id, visit, sqlDate(now), stageDue, stage.sla ? 'on_track' : 'none', row.id],
  );
  await addCaseEvent(pool, row.id, 'stage.entered', message || `Entered ${stage.name}`, { actor, data: { stageId: stage.id, visit } });
  const fresh = await loadCase(pool, row.id);
  const existing = await loadTasks(pool, row.id);
  for (const task of stage.tasks || []) {
    const attempt = Math.max(0, ...existing.filter((item) => item.task_key === task.id).map((item) => item.attempt)) + 1;
    const taskRow = await insertTaskRow(pool, fresh, stage, task, { attempt, visit });
    if (task.auto !== false) await startTaskRow(pool, cfg, fresh, task, taskRow, { actor });
  }
}

async function insertTaskRow(pool, row, stage, task, { attempt, visit }) {
  const id = crypto.randomUUID();
  await pool.query(
    `INSERT INTO case_tasks (id, case_id, stage_id, task_key, name, kind, required, status, attempt, visit, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, 'not_started', ?, ?, UTC_TIMESTAMP(3), UTC_TIMESTAMP(3))`,
    [id, row.id, stage.id, task.id, String(task.name || task.id).slice(0, 200), task.kind, task.required ? 1 : 0, attempt, visit],
  );
  const [rows] = await pool.query(`SELECT * FROM case_tasks WHERE id = ?`, [id]);
  return rows[0];
}

function pseudoJob(row) {
  return { id: null, tenant_id: row.tenant_id, project_id: row.project_id, workflow_id: null };
}

/** Starts the work behind one case task row: an Action Center task, a job, a flow run, or an agent run. */
export async function startTaskRow(pool, cfg, row, task, taskRow, { actor = null } = {}) {
  const config = task.config || {};
  const ctx = context(row, await loadTasks(pool, row.id));
  const user = actor?.id ? { id: actor.id } : (row.created_by ? { id: row.created_by } : null);
  try {
    if (task.kind === 'workflow') {
      const [workflows] = await pool.query(`SELECT * FROM workflows WHERE id = ? AND project_id = ?`, [config.workflowId, row.project_id]);
      const workflow = workflows[0];
      if (!workflow) throw new AppError(404, 'WORKFLOW_NOT_FOUND', 'The workflow is not in this project');
      const [versions] = await pool.query(`SELECT * FROM workflow_versions WHERE id = ?`, [workflow.current_version_id]);
      if (!versions[0]) throw new AppError(409, 'VERSION_NOT_PUBLISHED', `${workflow.name} has no published version`);
      const [projects] = await pool.query(`SELECT * FROM projects WHERE id = ?`, [row.project_id]);
      const input = renderMapping(config.inputs, ctx);
      const job = await enqueueJob(pool, cfg, { project: projects[0], workflow, version: versions[0], user, input, triggerSource: 'case' });
      await pool.query(`UPDATE automation_jobs SET case_id = ? WHERE id = ?`, [row.id, job.id]);
      await updateTask(pool, taskRow.id, { status: 'in_progress', job_id: job.id, started_at: sqlDate(new Date()) });
      await addCaseEvent(pool, row.id, 'task.started', `${task.name}: queued a job for ${workflow.name}`, { actor, data: { taskId: taskRow.id, jobId: job.id } });
    } else if (task.kind === 'flow') {
      const [flows] = await pool.query(`SELECT * FROM flows WHERE id = ? AND project_id = ?`, [config.flowId, row.project_id]);
      const flow = flows[0];
      if (!flow) throw new AppError(404, 'FLOW_NOT_FOUND', 'The flow is not in this project');
      const input = renderMapping(config.inputs, ctx);
      const run = await startRun(pool, cfg, { flow, user, input, triggerSource: 'case' });
      await pool.query(`UPDATE flow_runs SET case_id = ? WHERE id = ?`, [row.id, run.id]);
      await updateTask(pool, taskRow.id, { status: 'in_progress', flow_run_id: run.id, started_at: sqlDate(new Date()) });
      await addCaseEvent(pool, row.id, 'task.started', `${task.name}: started a run of ${flow.name}`, { actor, data: { taskId: taskRow.id, flowRunId: run.id } });
    } else if (task.kind === 'agent') {
      const [agents] = await pool.query(`SELECT * FROM agents WHERE id = ? AND project_id = ?`, [config.agentId, row.project_id]);
      const agent = agents[0];
      if (!agent) throw new AppError(404, 'AGENT_NOT_FOUND', 'The agent is not in this project');
      if (agent.status !== 'published' || !agent.current_version_id) throw new AppError(409, 'AGENT_NOT_PUBLISHED', `${agent.name} is not published`);
      const [versions] = await pool.query(`SELECT config_json FROM agent_versions WHERE id = ?`, [agent.current_version_id]);
      const input = renderMapping(config.inputs, ctx);
      const message = String(renderTemplate(config.message || '', ctx) ?? '').trim();
      if (message) input.message = message;
      const run = await startAgentRun(pool, cfg, { agent, config: parse(versions[0].config_json), versionId: agent.current_version_id, user, input, mode: 'task', source: 'case' });
      await pool.query(`UPDATE agent_runs SET case_id = ? WHERE id = ?`, [row.id, run.id]);
      await updateTask(pool, taskRow.id, { status: 'in_progress', agent_run_id: run.id, started_at: sqlDate(new Date()) });
      await addCaseEvent(pool, row.id, 'task.started', `${task.name}: started ${agent.name}`, { actor, data: { taskId: taskRow.id, agentRunId: run.id } });
    } else if (task.kind === 'human') {
      const title = String(renderTemplate(config.title || task.name, ctx) ?? task.name).slice(0, 200) || task.name;
      const action = await createTask(pool, pseudoJob(row), `case:${task.id}`.slice(0, 80), {
        taskType: config.taskType || 'approval',
        title,
        description: config.description ? String(renderTemplate(config.description, ctx) ?? '') : undefined,
        priority: config.priority || row.priority,
        formFields: config.formFields || [],
        data: { case: row.reference, caseTitle: row.title, ...(parse(row.fields_json) || {}) },
        assignee: config.assigneeUserId || (!config.assignedRole && row.assignee_user_id) || undefined,
        assignedRole: config.assignedRole || undefined,
        dueInHours: config.dueInHours || undefined,
      });
      await pool.query(`UPDATE action_tasks SET case_id = ? WHERE id = ?`, [row.id, action.id]);
      await updateTask(pool, taskRow.id, { status: 'in_progress', action_task_id: action.id, started_at: sqlDate(new Date()) });
      await addCaseEvent(pool, row.id, 'task.started', `${task.name}: created Action Center task “${title}”`, { actor, data: { taskId: taskRow.id, actionTaskId: action.id } });
    } else {
      throw new AppError(400, 'UNKNOWN_TASK', `Unknown task type ${task.kind}`);
    }
  } catch (error) {
    await failTaskRow(pool, row, taskRow, error.message || String(error));
  }
}

async function completeTaskRow(pool, row, taskRow, { outcome = null, output = null, completedBy = null } = {}) {
  await updateTask(pool, taskRow.id, {
    status: 'completed', outcome: outcome ? String(outcome).slice(0, 40) : null, output_json: output == null ? null : JSON.stringify(clampJson(redact(output))),
    completed_by: completedBy, completed_at: sqlDate(new Date()), error_message: null,
  });
  await addCaseEvent(pool, row.id, 'task.completed', `${taskRow.name} completed${outcome ? ` (${outcome})` : ''}`, { actor: completedBy ? { id: completedBy } : null, data: { taskId: taskRow.id } });
}

async function failTaskRow(pool, row, taskRow, message) {
  await updateTask(pool, taskRow.id, { status: 'failed', error_message: String(message).slice(0, 1000), completed_at: sqlDate(new Date()) });
  await addCaseEvent(pool, row.id, 'task.failed', `${taskRow.name} failed: ${message}`, { data: { taskId: taskRow.id } });
  await notify(pool, row, `${row.reference}: ${taskRow.name} failed`, `${row.title}: ${message}. Retry or skip the task on the case.`);
}

/** Checks the record behind an in-progress task. Returns true when the task finished. */
async function syncTask(pool, row, definition, taskRow) {
  if (taskRow.job_id) {
    const [jobs] = await pool.query(`SELECT id, status, error_summary FROM automation_jobs WHERE id = ?`, [taskRow.job_id]);
    const job = jobs[0];
    if (!job) { await failTaskRow(pool, row, taskRow, 'The job disappeared'); return true; }
    if (job.status === 'SUCCEEDED') {
      const [attempts] = await pool.query(`SELECT output_json FROM job_attempts WHERE job_id = ? ORDER BY attempt_number DESC LIMIT 1`, [job.id]);
      await completeTaskRow(pool, row, taskRow, { output: parse(attempts[0]?.output_json) || {} });
      return true;
    }
    if (JOB_FAILED.includes(job.status)) { await failTaskRow(pool, row, taskRow, `Job ${job.status.toLowerCase()}${job.error_summary ? `: ${job.error_summary}` : ''}`); return true; }
    return false;
  }
  if (taskRow.flow_run_id) {
    const [runs] = await pool.query(`SELECT id, status, variables_json, error_summary FROM flow_runs WHERE id = ?`, [taskRow.flow_run_id]);
    const run = runs[0];
    if (!run) { await failTaskRow(pool, row, taskRow, 'The flow run disappeared'); return true; }
    if (run.status === 'SUCCEEDED') { await completeTaskRow(pool, row, taskRow, { output: parse(run.variables_json) || {} }); return true; }
    if (['FAILED', 'CANCELLED'].includes(run.status)) { await failTaskRow(pool, row, taskRow, `Flow run ${run.status.toLowerCase()}${run.error_summary ? `: ${run.error_summary}` : ''}`); return true; }
    return false;
  }
  if (taskRow.agent_run_id) {
    const [runs] = await pool.query(`SELECT id, status, output_json, error_message FROM agent_runs WHERE id = ?`, [taskRow.agent_run_id]);
    const run = runs[0];
    if (!run) { await failTaskRow(pool, row, taskRow, 'The agent run disappeared'); return true; }
    if (run.status === 'SUCCEEDED') { await completeTaskRow(pool, row, taskRow, { output: parse(run.output_json) ?? {} }); return true; }
    if (['FAILED', 'CANCELLED'].includes(run.status)) { await failTaskRow(pool, row, taskRow, `Agent run ${run.status.toLowerCase()}${run.error_message ? `: ${run.error_message}` : ''}`); return true; }
    return false;
  }
  if (taskRow.action_task_id) {
    const [actions] = await pool.query(`SELECT * FROM action_tasks WHERE id = ?`, [taskRow.action_task_id]);
    const action = actions[0];
    if (!action) { await failTaskRow(pool, row, taskRow, 'The Action Center task disappeared'); return true; }
    if (action.status === 'completed') {
      const presented = presentTask(action);
      const data = presented.result?.data && typeof presented.result.data === 'object' ? presented.result.data : {};
      // Form answers whose names match case fields update the case.
      const matching = Object.fromEntries(Object.entries(data).filter(([key]) => (definition.fields || []).some((field) => field.name === key)));
      if (Object.keys(matching).length) {
        const checked = validateCaseFields(definition.fields, matching, { partial: true });
        if (Object.keys(checked.values).length) {
          const fields = { ...(parse(row.fields_json) || {}), ...checked.values };
          await pool.query(`UPDATE cases SET fields_json = ?, updated_at = UTC_TIMESTAMP(3) WHERE id = ?`, [JSON.stringify(fields), row.id]);
          await addCaseEvent(pool, row.id, 'fields.updated', `${taskRow.name} updated ${Object.keys(checked.values).join(', ')}`, { actor: action.completed_by ? { id: action.completed_by } : null, data: { fields: checked.values } });
        }
      }
      await completeTaskRow(pool, row, taskRow, { outcome: presented.outcome, output: { outcome: presented.outcome, data, comment: presented.comment }, completedBy: action.completed_by || null });
      return true;
    }
    if (action.status === 'cancelled') { await failTaskRow(pool, row, taskRow, 'The Action Center task was cancelled'); return true; }
    return false;
  }
  return false;
}

/** Stops whatever is running behind a task (best effort). */
async function cancelLinked(pool, taskRow, user) {
  try {
    if (taskRow.job_id) {
      const [jobs] = await pool.query(`SELECT * FROM automation_jobs WHERE id = ?`, [taskRow.job_id]);
      if (jobs[0] && !['SUCCEEDED', ...JOB_FAILED].includes(jobs[0].status)) await cancelJob(pool, jobs[0]);
    }
    if (taskRow.flow_run_id) {
      const [runs] = await pool.query(`SELECT * FROM flow_runs WHERE id = ?`, [taskRow.flow_run_id]);
      if (runs[0] && ['RUNNING', 'FAILED'].includes(runs[0].status)) await cancelRun(pool, runs[0], user);
    }
    if (taskRow.agent_run_id) {
      const [runs] = await pool.query(`SELECT * FROM agent_runs WHERE id = ?`, [taskRow.agent_run_id]);
      if (runs[0] && ['RUNNING', 'WAITING', 'IDLE'].includes(runs[0].status)) await cancelAgentRun(pool, {}, runs[0], user);
    }
    if (taskRow.action_task_id) {
      await pool.query(`UPDATE action_tasks SET status = 'cancelled', comment = COALESCE(comment, 'The case task was cancelled'), updated_at = UTC_TIMESTAMP(3) WHERE id = ? AND status = 'pending'`, [taskRow.action_task_id]);
    }
  } catch { /* best effort */ }
}

const TERMINAL_EVENT = { resolved: 'case.resolved', closed: 'case.closed', cancelled: 'case.cancelled' };

/** Ends a case (resolved, closed, or cancelled): stops open tasks and settles the SLAs. */
async function finishCase(pool, row, status, { actor = null, now = new Date(), message, cfg = null } = {}) {
  if (status !== 'closed') await leaveStage(pool, row, await loadTasks(pool, row.id), { actor });
  const at = sqlDate(now);
  const settle = (column) => `${column} = CASE WHEN ${column} IN ('on_track', 'at_risk') THEN '${status === 'cancelled' ? 'none' : 'met'}' ELSE ${column} END`;
  await pool.query(
    `UPDATE cases SET status = ?, ${settle('sla_state')}, ${settle('stage_sla_state')}, hold_started_at = NULL, hold_reason = NULL,
       resolved_at = ${status === 'resolved' ? '?' : 'resolved_at'}, closed_at = ${status === 'resolved' ? 'closed_at' : '?'}, updated_at = UTC_TIMESTAMP(3)
     WHERE id = ?`,
    [status, at, row.id],
  );
  await addCaseEvent(pool, row.id, TERMINAL_EVENT[status], message, { actor });
  // A flow waiting for this case (Create case step): move it on.
  if (cfg && row.source === 'flow' && row.source_ref) {
    const { advanceRun } = await import('../flow/engine.js');
    setImmediate(() => advanceRun(pool, cfg, row.source_ref).catch(() => {}));
  }
  if (actor?.id) await writeAudit(pool, { tenantId: row.tenant_id, userId: actor.id, action: `case.${status === 'resolved' ? 'resolve' : status === 'closed' ? 'close' : 'cancel'}`, entityType: 'case', entityId: row.id, projectId: row.project_id });
}

function expect(row, statuses, verb) {
  if (!statuses.includes(row.status)) throw new AppError(409, 'INVALID_STATE', `A ${row.status.replace('_', ' ')} case cannot be ${verb}`);
}

async function withLease(pool, row, work) {
  if (!(await acquire(pool, row.id))) throw new AppError(409, 'BUSY', 'The case is being updated; try again in a moment');
  try {
    return await work(await loadCase(pool, row.id));
  } finally {
    await pool.query(`UPDATE cases SET lock_until = NULL WHERE id = ?`, [row.id]);
  }
}

export async function holdCase(pool, row, user, { reason = '', now = new Date() } = {}) {
  expect(row, ['open'], 'put on hold');
  const [result] = await pool.query(
    `UPDATE cases SET status = 'on_hold', hold_started_at = ?, hold_reason = ?, updated_at = UTC_TIMESTAMP(3) WHERE id = ? AND status = 'open'`,
    [sqlDate(now), String(reason || '').slice(0, 500) || null, row.id],
  );
  if (result.affectedRows !== 1) throw new AppError(409, 'INVALID_STATE', 'The case changed; reload and try again');
  await addCaseEvent(pool, row.id, 'case.held', `Put on hold${reason ? `: ${reason}` : ''}; SLA timers paused`, { actor: user });
  await writeAudit(pool, { tenantId: row.tenant_id, userId: user?.id, action: 'case.hold', entityType: 'case', entityId: row.id, projectId: row.project_id });
  return loadCase(pool, row.id);
}

/** Resumes a held case; due dates move out by the time spent on hold. */
export async function resumeCase(pool, cfg, row, user, { now = new Date() } = {}) {
  expect(row, ['on_hold'], 'resumed');
  const paused = Math.max(0, new Date(now).getTime() - (fromSql(row.hold_started_at)?.getTime() || new Date(now).getTime()));
  const shift = (value) => (value ? sqlDate(fromSql(value).getTime() + paused) : null);
  const [result] = await pool.query(
    `UPDATE cases SET status = 'open', due_at = ?, stage_due_at = ?, hold_started_at = NULL, hold_reason = NULL, updated_at = UTC_TIMESTAMP(3) WHERE id = ? AND status = 'on_hold'`,
    [shift(row.due_at), shift(row.stage_due_at), row.id],
  );
  if (result.affectedRows !== 1) throw new AppError(409, 'INVALID_STATE', 'The case changed; reload and try again');
  await addCaseEvent(pool, row.id, 'case.resumed', `Resumed after ${Math.round(paused / 60000)} min on hold; due dates moved out accordingly`, { actor: user, data: { pausedMs: paused } });
  await writeAudit(pool, { tenantId: row.tenant_id, userId: user?.id, action: 'case.resume', entityType: 'case', entityId: row.id, projectId: row.project_id });
  return advanceCase(pool, cfg, row.id, { now, actor: user });
}

export async function resolveCase(pool, row, user, { comment = '', now = new Date(), cfg = null } = {}) {
  expect(row, ['open', 'on_hold'], 'resolved');
  if (row.status === 'on_hold') await pool.query(`UPDATE cases SET status = 'open' WHERE id = ?`, [row.id]);
  return withLease(pool, { ...row, status: 'open' }, async (fresh) => {
    await finishCase(pool, fresh, 'resolved', { actor: user, now, cfg, message: `Resolved by hand${comment ? `: ${comment}` : ''}` });
    return loadCase(pool, row.id);
  });
}

export async function cancelCase(pool, row, user, { comment = '', now = new Date(), cfg = null } = {}) {
  expect(row, ['open', 'on_hold'], 'cancelled');
  if (row.status === 'on_hold') await pool.query(`UPDATE cases SET status = 'open' WHERE id = ?`, [row.id]);
  return withLease(pool, { ...row, status: 'open' }, async (fresh) => {
    await finishCase(pool, fresh, 'cancelled', { actor: user, now, cfg, message: `Cancelled${comment ? `: ${comment}` : ''}` });
    return loadCase(pool, row.id);
  });
}

export async function closeCase(pool, row, user, { now = new Date() } = {}) {
  expect(row, ['resolved'], 'closed');
  await finishCase(pool, row, 'closed', { actor: user, now, message: 'Closed' });
  return loadCase(pool, row.id);
}

/** Reopens a finished case at a stage (default: the stage it ended in). */
export async function reopenCase(pool, cfg, row, user, { stageId = null, now = new Date() } = {}) {
  expect(row, ['resolved', 'closed', 'cancelled'], 'reopened');
  const definition = await loadCaseDefinition(pool, row.case_type_version_id);
  const stage = findStage(definition, stageId || row.current_stage_id) || definition.stages[0];
  const sla = definition.sla;
  const state = sla && row.due_at ? slaState({ start: fromSql(row.due_at).getTime() - Number(sla.hours) * HOUR, due: fromSql(row.due_at), warnAt: sla.warnAt, now }) : 'none';
  await pool.query(
    `UPDATE cases SET status = 'open', resolved_at = NULL, closed_at = NULL, sla_state = ?, updated_at = UTC_TIMESTAMP(3) WHERE id = ?`,
    [state === 'breached' && row.sla_state !== 'breached' ? 'at_risk' : state, row.id],
  );
  await addCaseEvent(pool, row.id, 'case.reopened', `Reopened at ${stage.name}`, { actor: user });
  await writeAudit(pool, { tenantId: row.tenant_id, userId: user?.id, action: 'case.reopen', entityType: 'case', entityId: row.id, projectId: row.project_id, metadata: { stageId: stage.id } });
  await withLease(pool, { ...row, status: 'open' }, (fresh) => enterStage(pool, cfg, fresh, definition, stage, { now, actor: user, message: `Re-entered ${stage.name}` }));
  return advanceCase(pool, cfg, row.id, { now, actor: user });
}

/**
 * Moves a case to another stage by hand. Going back is always allowed. Going forward past a stage
 * that is not complete needs that stage's allowSkip (administrators may always skip).
 */
export async function moveCase(pool, cfg, row, user, { stageId, reason = '', now = new Date() }) {
  expect(row, ['open'], 'moved');
  const definition = await loadCaseDefinition(pool, row.case_type_version_id);
  const target = findStage(definition, stageId);
  if (!target) throw new AppError(400, 'VALIDATION', 'Unknown stage');
  if (target.id === row.current_stage_id) throw new AppError(409, 'INVALID_STATE', `The case is already in ${target.name}`);
  await withLease(pool, row, async (fresh) => {
    const from = stageIndex(definition, fresh.current_stage_id);
    const to = stageIndex(definition, target.id);
    const tasks = await loadTasks(pool, fresh.id);
    if (to > from) {
      for (let index = Math.max(0, from); index < to; index += 1) {
        const stage = definition.stages[index];
        const done = index === from && stageComplete(fresh, stage, tasks);
        if (!done && !stage.allowSkip && user?.role !== 'administrator') {
          throw new AppError(409, 'SKIP_NOT_ALLOWED', `${stage.name} cannot be skipped: finish its required tasks first`);
        }
      }
    }
    const label = `${to > from ? 'Moved forward' : 'Moved back'} to ${target.name}${user?.email ? ` by ${user.email}` : ''}${reason ? `: ${reason}` : ''}`;
    await leaveStage(pool, fresh, tasks, { actor: user, event: 'stage.moved', message: label });
    await enterStage(pool, cfg, fresh, definition, target, { now, actor: user });
  });
  await writeAudit(pool, { tenantId: row.tenant_id, userId: user?.id, action: 'case.move', entityType: 'case', entityId: row.id, projectId: row.project_id, metadata: { from: row.current_stage_id, to: target.id } });
  return advanceCase(pool, cfg, row.id, { now, actor: user });
}

async function loadTaskRow(pool, row, taskRowId) {
  const [rows] = await pool.query(`SELECT * FROM case_tasks WHERE id = ? AND case_id = ?`, [taskRowId, row.id]);
  if (!rows[0]) throw new AppError(404, 'NOT_FOUND', 'Case task not found');
  if (rows[0].stage_id !== row.current_stage_id || rows[0].visit !== row.stage_visit) throw new AppError(409, 'INVALID_STATE', 'That task belongs to an earlier stage visit');
  return rows[0];
}

function taskDefinition(definition, taskRow) {
  const stage = findStage(definition, taskRow.stage_id);
  const task = (stage?.tasks || []).find((item) => item.id === taskRow.task_key);
  if (!task) throw new AppError(409, 'INVALID_STATE', 'The task is no longer in this case type version');
  return { stage, task };
}

/** Starts a manual (non-auto) task. */
export async function startCaseTask(pool, cfg, row, taskRowId, user) {
  expect(row, ['open'], 'worked on');
  const definition = await loadCaseDefinition(pool, row.case_type_version_id);
  const taskRow = await loadTaskRow(pool, row, taskRowId);
  if (taskRow.status !== 'not_started') throw new AppError(409, 'INVALID_STATE', `The task is already ${taskRow.status.replace('_', ' ')}`);
  const { task } = taskDefinition(definition, taskRow);
  await startTaskRow(pool, cfg, row, task, taskRow, { actor: user });
  return advanceCase(pool, cfg, row.id, { actor: user });
}

/** Runs a failed or cancelled task again (new attempt). */
export async function retryCaseTask(pool, cfg, row, taskRowId, user) {
  expect(row, ['open'], 'worked on');
  const definition = await loadCaseDefinition(pool, row.case_type_version_id);
  const taskRow = await loadTaskRow(pool, row, taskRowId);
  if (!['failed', 'cancelled'].includes(taskRow.status)) throw new AppError(409, 'INVALID_STATE', 'Only a failed or cancelled task can be retried');
  const { stage, task } = taskDefinition(definition, taskRow);
  const [maxRows] = await pool.query(`SELECT MAX(attempt) AS attempt FROM case_tasks WHERE case_id = ? AND task_key = ?`, [row.id, taskRow.task_key]);
  const next = await insertTaskRow(pool, row, stage, task, { attempt: Number(maxRows[0].attempt || 0) + 1, visit: row.stage_visit });
  await addCaseEvent(pool, row.id, 'task.retried', `${task.name}: retrying (attempt ${next.attempt})`, { actor: user });
  await startTaskRow(pool, cfg, row, task, next, { actor: user });
  return advanceCase(pool, cfg, row.id, { actor: user });
}

/** Skips a task. A required task can be skipped when its stage allows skipping, or by a case manager. */
export async function skipCaseTask(pool, cfg, row, taskRowId, user, { manager = false, reason = '' } = {}) {
  expect(row, ['open'], 'worked on');
  const definition = await loadCaseDefinition(pool, row.case_type_version_id);
  const taskRow = await loadTaskRow(pool, row, taskRowId);
  if (DONE_TASK.includes(taskRow.status)) throw new AppError(409, 'INVALID_STATE', `The task is already ${taskRow.status}`);
  const { stage, task } = taskDefinition(definition, taskRow);
  if (task.required && !stage.allowSkip && !manager) throw new AppError(403, 'SKIP_NOT_ALLOWED', `${task.name} is required and ${stage.name} does not allow skipping`);
  await cancelLinked(pool, taskRow, user);
  await updateTask(pool, taskRow.id, { status: 'skipped', completed_by: user?.id || null, completed_at: sqlDate(new Date()) });
  await addCaseEvent(pool, row.id, 'task.skipped', `${task.name} skipped${reason ? `: ${reason}` : ''}`, { actor: user });
  return advanceCase(pool, cfg, row.id, { actor: user });
}

// ---- SLAs and escalation -------------------------------------------------------------------

const NEXT_PRIORITY = { low: 'medium', medium: 'high', high: 'critical', critical: 'critical' };

async function runEscalation(pool, rule, row, { label, state }) {
  const config = rule.config || {};
  const fresh = await loadCase(pool, row.id);
  const ctx = context(fresh, await loadTasks(pool, row.id));
  let detail = '';
  if (rule.action === 'notify') {
    const body = String(renderTemplate(config.message || '', ctx) || '').trim() || `${fresh.title} needs attention: the ${label.toLowerCase()} SLA is ${state.replace('_', ' ')}.`;
    await notify(pool, fresh, `${fresh.reference}: escalation (${label} SLA ${state.replace('_', ' ')})`, body);
    detail = 'notified the project';
  } else if (rule.action === 'reassign') {
    const user = await activeUser(pool, fresh.tenant_id, config.userId);
    if (!user) { detail = 'could not reassign: the user is not active'; } else {
      await pool.query(`UPDATE cases SET assignee_user_id = ?, updated_at = UTC_TIMESTAMP(3) WHERE id = ?`, [user.id, fresh.id]);
      detail = `reassigned to ${user.email}`;
    }
  } else if (rule.action === 'raise_priority') {
    const target = config.priority || NEXT_PRIORITY[fresh.priority] || 'high';
    if (PRIORITIES.indexOf(target) > PRIORITIES.indexOf(fresh.priority)) {
      await pool.query(`UPDATE cases SET priority = ?, updated_at = UTC_TIMESTAMP(3) WHERE id = ?`, [target, fresh.id]);
      detail = `priority raised from ${fresh.priority} to ${target}`;
    } else detail = `priority already ${fresh.priority}`;
  } else if (rule.action === 'create_task') {
    const title = String(renderTemplate(config.title || 'Escalation: {{case.reference}}', ctx) || 'Escalation').slice(0, 200);
    const action = await createTask(pool, pseudoJob(fresh), `case:escalation:${rule.id}`.slice(0, 80), {
      taskType: 'approval', title,
      description: config.description ? String(renderTemplate(config.description, ctx) || '') : `The ${label.toLowerCase()} SLA of ${fresh.reference} is ${state.replace('_', ' ')}.`,
      priority: 'high', data: { case: fresh.reference, caseTitle: fresh.title },
      assignee: config.userId || undefined, assignedRole: config.assignedRole || undefined,
    });
    await pool.query(`UPDATE action_tasks SET case_id = ? WHERE id = ?`, [fresh.id, action.id]);
    detail = `created Action Center task “${title}”`;
  }
  await addCaseEvent(pool, row.id, 'escalation.fired', `${label} escalation: ${detail}`, { data: { ruleId: rule.id, action: rule.action, when: rule.when } });
}

async function onSlaChange(pool, row, { label, state, due, rules, keyPrefix }) {
  const words = state === 'breached' ? 'breached' : 'at risk';
  await addCaseEvent(pool, row.id, `sla.${state}`, `${label} SLA ${words}`, { data: { scope: keyPrefix.split(':')[0], due: due.toISOString() } });
  await notify(pool, row, `${row.reference}: ${label} SLA ${words}`, `${row.title} — the ${label.toLowerCase()} SLA ${state === 'breached' ? 'was breached' : 'is at risk'}.`);
  const whens = state === 'breached' ? ['at_risk', 'breached'] : ['at_risk'];
  for (const rule of rules || []) {
    if (!whens.includes(rule.when)) continue;
    const key = `${keyPrefix}:${rule.id}`;
    const [rows] = await pool.query(`SELECT escalations_json FROM cases WHERE id = ?`, [row.id]);
    const fired = parse(rows[0]?.escalations_json) || [];
    if (fired.includes(key)) continue;
    fired.push(key);
    await pool.query(`UPDATE cases SET escalations_json = ? WHERE id = ?`, [JSON.stringify(fired.slice(-200)), row.id]);
    try { await runEscalation(pool, rule, row, { label, state }); } catch (error) {
      await addCaseEvent(pool, row.id, 'escalation.failed', `${label} escalation ${rule.id} failed: ${error.message}`);
    }
  }
}

/** Marks at-risk and breached SLAs of open cases and runs their escalations. Returns how many changed. */
export async function checkCaseSlas(pool, cfg, { now = new Date(), limit = 200 } = {}) {
  const [rows] = await pool.query(
    `SELECT * FROM cases WHERE status = 'open' AND (sla_state IN ('on_track', 'at_risk') OR stage_sla_state IN ('on_track', 'at_risk')) ORDER BY updated_at ASC LIMIT ${Number(limit)}`,
  );
  let changed = 0;
  for (const row of rows) {
    let definition;
    try { definition = await loadCaseDefinition(pool, row.case_type_version_id); } catch { continue; }
    const checks = [];
    if (definition.sla && row.due_at && ['on_track', 'at_risk'].includes(row.sla_state)) {
      checks.push({ column: 'sla_state', current: row.sla_state, due: fromSql(row.due_at), sla: definition.sla, label: 'Case', rules: definition.escalations, keyPrefix: 'case' });
    }
    const stage = findStage(definition, row.current_stage_id);
    if (stage?.sla && row.stage_due_at && ['on_track', 'at_risk'].includes(row.stage_sla_state)) {
      checks.push({ column: 'stage_sla_state', current: row.stage_sla_state, due: fromSql(row.stage_due_at), sla: stage.sla, label: stage.name, rules: stage.escalations, keyPrefix: `stage:${stage.id}:${row.stage_visit}` });
    }
    for (const check of checks) {
      const state = slaState({ start: check.due.getTime() - Number(check.sla.hours) * HOUR, due: check.due, warnAt: check.sla.warnAt, now });
      if (SEVERITY[state] <= SEVERITY[check.current]) continue;
      const [claimed] = await pool.query(`UPDATE cases SET ${check.column} = ?, updated_at = UTC_TIMESTAMP(3) WHERE id = ? AND ${check.column} = ? AND status = 'open'`, [state, row.id, check.current]);
      if (claimed.affectedRows !== 1) continue;
      changed += 1;
      await onSlaChange(pool, row, { ...check, state });
    }
  }
  return changed;
}

/** Worker tick: SLA checks, then advance open cases that have work in flight. */
export async function advanceCases(pool, cfg, { limit = 50, now = new Date() } = {}) {
  await checkCaseSlas(pool, cfg, { now });
  const [rows] = await pool.query(
    `SELECT c.id FROM cases c
     WHERE c.status = 'open' AND (c.lock_until IS NULL OR c.lock_until < UTC_TIMESTAMP(3))
       AND (c.current_stage_id IS NULL OR EXISTS (SELECT 1 FROM case_tasks t WHERE t.case_id = c.id AND t.status = 'in_progress'))
     ORDER BY RAND() LIMIT ${Number(limit)}`,
  );
  for (const { id } of rows) await advanceCase(pool, cfg, id).catch((error) => console.error(JSON.stringify({ event: 'case.advance.failed', caseId: id, message: error.message })));
  return rows.length;
}

/** Completion hook for jobs, tasks, flow runs, and agent runs that belong to a case. */
export async function notifyCase(pool, cfg, caseId) {
  if (!caseId) return;
  await advanceCase(pool, cfg, caseId).catch(() => {});
}
