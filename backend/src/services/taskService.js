// Action Center: human-in-the-loop tasks. A Create Task step inserts a task and, by default,
// suspends the job. Completing the task stores the result in the job's resume state and queues
// the job again; the worker resumes after the suspended step with the task result as its output.
import crypto from 'node:crypto';
import { writeAudit } from '../db/audit.js';
import { withTransaction } from '../db/pool.js';
import { AppError } from '../lib/errors.js';

export const TASK_TYPES = ['approval', 'form', 'validation'];
export const TASK_PRIORITIES = ['low', 'medium', 'high', 'critical'];
export const FIELD_TYPES = ['text', 'textarea', 'number', 'date', 'select', 'checkbox', 'email'];
const COMPLETER_ROLES = ['administrator', 'project_manager', 'operator', 'automation_developer'];

function sqlDate(value) {
  return new Date(value).toISOString().slice(0, 23).replace('T', ' ');
}

/** Validates and normalizes a form schema: [{ name, label, type, required, options, default }]. */
export function normalizeFormSchema(fields) {
  if (fields == null) return [];
  if (!Array.isArray(fields) || fields.length > 50) throw new AppError(400, 'VALIDATION', 'formFields must be an array of at most 50 fields');
  const names = new Set();
  return fields.map((field, index) => {
    const name = String(field?.name || '');
    if (!/^[A-Za-z][A-Za-z0-9_]{0,62}$/.test(name)) throw new AppError(400, 'VALIDATION', `formFields[${index}].name must be letters, digits, or _`);
    if (names.has(name)) throw new AppError(400, 'VALIDATION', `Duplicate form field ${name}`);
    names.add(name);
    const type = field.type || 'text';
    if (!FIELD_TYPES.includes(type)) throw new AppError(400, 'VALIDATION', `formFields[${index}].type must be one of ${FIELD_TYPES.join(', ')}`);
    const options = type === 'select' ? (Array.isArray(field.options) ? field.options.map(String).slice(0, 100) : []) : undefined;
    if (type === 'select' && !options.length) throw new AppError(400, 'VALIDATION', `formFields[${index}] needs options`);
    return { name, label: String(field.label || name).slice(0, 120), type, required: field.required === true, ...(options ? { options } : {}), ...(field.default !== undefined ? { default: field.default } : {}) };
  });
}

/** Checks submitted form data against the schema and returns cleaned values. */
export function validateFormData(schema, data = {}) {
  const errors = [];
  const values = {};
  for (const field of schema) {
    let value = data[field.name];
    if (value === undefined || value === '' || value === null) {
      if (field.type === 'checkbox') value = false;
      else if (field.default !== undefined && data[field.name] === undefined) value = field.default;
      else value = null;
    }
    if (field.required && (value === null || (field.type === 'checkbox' && value !== true))) {
      errors.push({ path: field.name, message: `${field.label} is required` });
      continue;
    }
    if (value === null) { values[field.name] = null; continue; }
    if (field.type === 'number') {
      const number = Number(value);
      if (!Number.isFinite(number)) errors.push({ path: field.name, message: `${field.label} must be a number` });
      value = number;
    } else if (field.type === 'checkbox') {
      value = value === true || value === 'true';
    } else if (field.type === 'date') {
      if (!/^\d{4}-\d{2}-\d{2}$/.test(String(value))) errors.push({ path: field.name, message: `${field.label} must be a date (YYYY-MM-DD)` });
    } else if (field.type === 'email') {
      if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(value))) errors.push({ path: field.name, message: `${field.label} must be an email address` });
    } else if (field.type === 'select') {
      if (!field.options.includes(String(value))) errors.push({ path: field.name, message: `${field.label} must be one of ${field.options.join(', ')}` });
    } else {
      value = String(value).slice(0, field.type === 'textarea' ? 10000 : 1000);
    }
    values[field.name] = value;
  }
  if (errors.length) {
    const error = new AppError(400, 'VALIDATION', 'Task form is incomplete');
    error.details = errors;
    throw error;
  }
  return values;
}

export function presentTask(row) {
  if (!row) return null;
  const parse = (value) => (typeof value === 'string' ? JSON.parse(value) : value);
  return {
    id: row.id,
    projectId: row.project_id,
    projectName: row.project_name || undefined,
    jobId: row.job_id,
    flowRunId: row.flow_run_id || null,
    agentRunId: row.agent_run_id || null,
    appId: row.app_id || null,
    caseId: row.case_id || null,
    workflowId: row.workflow_id,
    workflowName: row.workflow_name || undefined,
    stepKey: row.step_key,
    type: row.task_type,
    title: row.title,
    description: row.description,
    priority: row.priority,
    status: row.status,
    formFields: schemaOf(row).fields,
    outcomes: schemaOf(row).outcomes,
    requireCommentOnReject: schemaOf(row).requireCommentOnReject,
    data: parse(row.data_json) || {},
    result: parse(row.result_json),
    outcome: row.outcome,
    comment: row.comment,
    assignedRole: row.assigned_role,
    assignedUserId: row.assigned_user_id,
    assignedUserEmail: row.assigned_user_email || undefined,
    completedBy: row.completed_by,
    completedByEmail: row.completed_by_email || undefined,
    completedAt: row.completed_at,
    dueAt: row.due_at,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

/** Called by the workflow runtime. Returns the task row. */
export async function createTask(pool, job, stepKey, config) {
  const type = config.taskType || (config.formFields?.length ? 'form' : 'approval');
  if (!TASK_TYPES.includes(type)) throw new AppError(400, 'VALIDATION', `taskType must be one of ${TASK_TYPES.join(', ')}`);
  const priority = TASK_PRIORITIES.includes(config.priority) ? config.priority : 'medium';
  const title = String(config.title || 'Review required').slice(0, 200);
  const formFields = normalizeFormSchema(config.formFields);
  const data = config.data === undefined ? {} : config.data;
  const outcomes = Array.isArray(config.outcomes) && config.outcomes.length ? config.outcomes.map(String).slice(0, 6) : (type === 'approval' ? ['approve', 'reject'] : ['submit']);
  let assignedUserId = null;
  if (config.assignee) {
    const [users] = await pool.query(`SELECT id FROM users WHERE tenant_id = ? AND (email = ? OR id = ?) AND status = 'active'`, [job.tenant_id, String(config.assignee).toLowerCase(), String(config.assignee)]);
    if (!users[0]) throw new AppError(400, 'VALIDATION', `Assignee ${config.assignee} was not found`);
    assignedUserId = users[0].id;
  }
  const dueHours = Number(config.dueInHours);
  const dueAt = Number.isFinite(dueHours) && dueHours > 0 ? sqlDate(Date.now() + Math.min(dueHours, 24 * 365) * 3600 * 1000) : null;
  const id = crypto.randomUUID();
  await pool.query(
    `INSERT INTO action_tasks (
      id, tenant_id, project_id, job_id, workflow_id, step_key, task_type, title, description, priority, status,
      form_schema_json, data_json, assigned_role, assigned_user_id, due_at, created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'pending', ?, ?, ?, ?, ?, UTC_TIMESTAMP(3), UTC_TIMESTAMP(3))`,
    [
      id, job.tenant_id, job.project_id, job.id, job.workflow_id, stepKey, type, title,
      config.description ? String(config.description).slice(0, 10000) : null, priority,
      JSON.stringify({ fields: formFields, outcomes, requireCommentOnReject: config.requireCommentOnReject === true }), JSON.stringify(data),
      ['administrator', 'project_manager', 'operator', 'automation_developer'].includes(config.assignedRole) ? config.assignedRole : null,
      assignedUserId, dueAt,
    ],
  );
  await pool.query(
    `INSERT INTO notifications (id, tenant_id, project_id, job_id, channel, subject, body, created_at)
     VALUES (?, ?, ?, ?, 'in_app', ?, ?, UTC_TIMESTAMP(3))`,
    [crypto.randomUUID(), job.tenant_id, job.project_id, job.id, `Action Center: ${title}`.slice(0, 200), `A ${type} task is waiting in Action Center.`],
  );
  await writeAudit(pool, { tenantId: job.tenant_id, action: 'task.create', entityType: 'task', entityId: id, projectId: job.project_id, metadata: { jobId: job.id, type } });
  const [rows] = await pool.query(`SELECT * FROM action_tasks WHERE id = ?`, [id]);
  return rows[0];
}

export async function getTaskForJob(pool, job, taskId) {
  const [rows] = await pool.query(`SELECT * FROM action_tasks WHERE id = ? AND tenant_id = ? AND project_id = ?`, [taskId, job.tenant_id, job.project_id]);
  if (!rows[0]) throw new AppError(404, 'TASK_NOT_FOUND', 'Action Center task was not found in this project');
  return rows[0];
}

export function taskResult(row) {
  const task = presentTask(row);
  return { taskId: task.id, status: task.status, outcome: task.outcome, data: task.result?.data ?? null, comment: task.comment, completedBy: task.completedByEmail || task.completedBy, completedAt: task.completedAt };
}

function schemaOf(row) {
  const parsed = typeof row.form_schema_json === 'string' ? JSON.parse(row.form_schema_json) : row.form_schema_json;
  if (Array.isArray(parsed)) return { fields: parsed, outcomes: [] };
  return { fields: parsed?.fields || [], outcomes: parsed?.outcomes || [], requireCommentOnReject: parsed?.requireCommentOnReject === true };
}

export function canCompleteTask(user, row) {
  if (!COMPLETER_ROLES.includes(user.role)) return false;
  if (row.assigned_user_id && row.assigned_user_id !== user.id && !['administrator', 'project_manager'].includes(user.role)) return false;
  if (row.assigned_role && row.assigned_role !== user.role && !['administrator', 'project_manager'].includes(user.role)) return false;
  return true;
}

/** Completes a task and resumes its suspended job. Returns { task, resumedJobId }. */
export async function completeTask(pool, user, taskId, body = {}) {
  return withTransaction(pool, async (connection) => {
    const [rows] = await connection.query(`SELECT * FROM action_tasks WHERE id = ? AND tenant_id = ? FOR UPDATE`, [taskId, user.tenant_id]);
    const row = rows[0];
    if (!row) throw new AppError(404, 'NOT_FOUND', 'Task not found');
    if (row.status !== 'pending') throw new AppError(409, 'TASK_CLOSED', `Task is already ${row.status}`);
    if (!canCompleteTask(user, row)) throw new AppError(403, 'FORBIDDEN', 'You cannot complete this task');
    const { fields, outcomes } = schemaOf(row);
    const outcome = String(body.outcome || (outcomes.length === 1 ? outcomes[0] : '')).slice(0, 40);
    if (outcomes.length && !outcomes.includes(outcome)) throw new AppError(400, 'VALIDATION', `outcome must be one of ${outcomes.join(', ')}`);
    const data = validateFormData(fields, body.data || {});
    const comment = body.comment ? String(body.comment).slice(0, 2000) : null;
    if (outcome === 'reject' && schemaOf(row).requireCommentOnReject && !comment) throw new AppError(400, 'VALIDATION', 'A comment is required to reject');
    await connection.query(
      `UPDATE action_tasks SET status = 'completed', outcome = ?, result_json = ?, comment = ?, completed_by = ?, completed_at = UTC_TIMESTAMP(3), updated_at = UTC_TIMESTAMP(3) WHERE id = ?`,
      [outcome || null, JSON.stringify({ data }), comment, user.id, row.id],
    );
    let resumedJobId = null;
    if (row.job_id) {
      const [jobs] = await connection.query(`SELECT * FROM automation_jobs WHERE id = ? FOR UPDATE`, [row.job_id]);
      const job = jobs[0];
      const state = typeof job?.resume_state_json === 'string' ? JSON.parse(job.resume_state_json) : job?.resume_state_json;
      if (job && job.status === 'SUSPENDED' && state?.taskId === row.id) {
        const output = { taskId: row.id, status: 'completed', outcome: outcome || null, data, comment, completedBy: user.email, completedAt: new Date().toISOString() };
        await connection.query(
          `UPDATE automation_jobs SET status = 'QUEUED', resume_state_json = ?, available_at = UTC_TIMESTAMP(3), updated_at = UTC_TIMESTAMP(3) WHERE id = ? AND status = 'SUSPENDED'`,
          [JSON.stringify({ ...state, output }), job.id],
        );
        resumedJobId = job.id;
      }
    }
    await writeAudit(connection, { tenantId: user.tenant_id, userId: user.id, action: 'task.complete', entityType: 'task', entityId: row.id, projectId: row.project_id, metadata: { outcome, resumedJobId } });
    const [fresh] = await connection.query(`SELECT * FROM action_tasks WHERE id = ?`, [row.id]);
    return { task: fresh[0], resumedJobId };
  });
}

export async function cancelTasksForJob(connection, jobId, reason = 'The job was cancelled') {
  await connection.query(
    `UPDATE action_tasks SET status = 'cancelled', comment = COALESCE(comment, ?), updated_at = UTC_TIMESTAMP(3) WHERE job_id = ? AND status = 'pending'`,
    [reason, jobId],
  );
}
