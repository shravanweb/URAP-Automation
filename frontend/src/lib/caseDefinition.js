// Copy of backend/src/case/definition.js (case type rules, conditions, SLA math).
// Keep the two files in sync.
// Case type definitions: fields, stages in order (entry and exit conditions, tasks, SLA, skip
// rule, escalations), a case-level SLA with escalations, and settings. Pure functions only (no
// database), shared with the frontend (frontend/src/lib/caseDefinition.js is a copy; keep in sync).
//
// { fields: [{ name, label, type, required, options }],
//   stages: [{ id, name, entryConditions: [cond], exitConditions: [cond], allowSkip,
//              sla: { hours, warnAt } | null, escalations: [rule],
//              tasks: [{ id, name, kind, required, auto, config }] }],
//   sla: { hours, warnAt } | null, escalations: [rule],
//   settings: { defaultPriority, defaultOwnerUserId, workerRoles } }
// cond = { path: 'fields.x' | 'tasks.<taskId>.outcome' | ..., op, value }
// rule = { id, when: 'at_risk' | 'breached', action: 'notify' | 'reassign' | 'raise_priority' | 'create_task', config }

export const NAME = /^[A-Za-z][A-Za-z0-9_]{0,62}$/;
export const ID = /^[A-Za-z][A-Za-z0-9_-]{0,79}$/;
export const FIELD_TYPES = ['text', 'textarea', 'number', 'date', 'select', 'checkbox', 'email'];
export const TASK_KINDS = ['human', 'workflow', 'flow', 'agent'];
export const PRIORITIES = ['low', 'medium', 'high', 'critical'];
export const CASE_STATUSES = ['open', 'on_hold', 'resolved', 'closed', 'cancelled'];
export const SLA_STATES = ['none', 'on_track', 'at_risk', 'breached', 'met'];
export const CONDITION_OPS = ['eq', 'neq', 'gt', 'lt', 'contains', 'empty', 'not_empty', 'truthy', 'falsy'];
export const ESCALATION_TRIGGERS = ['at_risk', 'breached'];
export const ESCALATION_ACTIONS = ['notify', 'reassign', 'raise_priority', 'create_task'];
export const WORKER_ROLES = ['administrator', 'project_manager', 'automation_developer', 'operator'];
export const TASK_TYPES = ['approval', 'form', 'validation'];
export const SOURCES = ['manual', 'api', 'webhook', 'flow', 'app', 'agent'];
export const LIMITS = { stages: 20, tasksPerStage: 15, fields: 60, escalations: 10, conditions: 10, slaHours: 8760 };
export const TASK_STATUSES = ['not_started', 'in_progress', 'completed', 'failed', 'skipped', 'cancelled'];
const VALUE_OPS = ['eq', 'neq', 'gt', 'lt', 'contains'];
const WHOLE = /^\s*\{\{\s*([^{}]+?)\s*\}\}\s*$/;
const ANY = /\{\{\s*([^{}]+?)\s*\}\}/g;

export const TASK_KIND_LABELS = { human: 'Human task', workflow: 'Robot (workflow)', flow: 'Flow', agent: 'Agent' };
export const ESCALATION_LABELS = { notify: 'Notify the project', reassign: 'Reassign the case', raise_priority: 'Raise the priority', create_task: 'Create an Action Center task' };

export function defaultSettings() {
  return { defaultPriority: 'medium', defaultOwnerUserId: '', workerRoles: [...WORKER_ROLES] };
}

export function emptyDefinition() {
  return {
    fields: [{ name: 'summary', label: 'Summary', type: 'textarea', required: false }],
    stages: [
      { ...newStage([]), id: 'intake', name: 'Intake' },
      { ...newStage([{ id: 'intake' }]), id: 'done', name: 'Done' },
    ],
    sla: null,
    escalations: [],
    settings: defaultSettings(),
  };
}

function uniqueId(base, taken) {
  const set = new Set(taken);
  let n = 1;
  while (set.has(`${base}${n}`)) n += 1;
  return `${base}${n}`;
}

export function newStage(existing = []) {
  const id = uniqueId('stage', existing.map((stage) => stage.id));
  return { id, name: `Stage ${existing.length + 1}`, entryConditions: [], exitConditions: [], allowSkip: false, sla: null, escalations: [], tasks: [] };
}

export function allTasks(definition) {
  return (definition?.stages || []).flatMap((stage) => (stage.tasks || []).map((task) => ({ stage, task })));
}

export function newTask(kind, definition) {
  const id = uniqueId('task', allTasks(definition).map((item) => item.task.id));
  const config = {
    human: { title: 'Review {{case.reference}}: {{case.title}}', description: '', taskType: 'approval', assignedRole: '', assigneeUserId: '', priority: 'medium', dueInHours: null, formFields: [] },
    workflow: { workflowId: '', inputs: [] },
    flow: { flowId: '', inputs: [] },
    agent: { agentId: '', inputs: [], message: '' },
  }[kind] || {};
  const name = { human: 'Review', workflow: 'Run robot', flow: 'Run flow', agent: 'Ask agent' }[kind] || 'Task';
  return { id, name, kind, required: true, auto: true, config };
}

export function newField(existing = []) {
  const name = uniqueId('field', existing.map((field) => field.name));
  return { name, label: `Field ${existing.length + 1}`, type: 'text', required: false };
}

export function newEscalation(existing = [], when = 'breached') {
  const id = uniqueId('esc', existing.map((rule) => rule.id));
  return { id, when, action: 'notify', config: { message: '' } };
}

export function findStage(definition, stageId) {
  return (definition?.stages || []).find((stage) => stage.id === stageId) || null;
}

export function stageIndex(definition, stageId) {
  return (definition?.stages || []).findIndex((stage) => stage.id === stageId);
}

// ---- Bindings and conditions ---------------------------------------------------------------

export function resolvePath(context, path) {
  const parts = String(path ?? '').replace(WHOLE, '$1').trim().replace(/\[(\d+)\]/g, '.$1').split('.').filter(Boolean);
  let value = context;
  for (const part of parts) {
    if (value === null || value === undefined) return undefined;
    if (part === '__proto__' || part === 'constructor' || part === 'prototype') return undefined;
    value = value[part];
  }
  return value;
}

/** "{{a.b}}" returns the raw value; mixed text interpolates strings. */
export function renderTemplate(template, context) {
  if (typeof template !== 'string') return template;
  const whole = template.match(WHOLE);
  if (whole) return resolvePath(context, whole[1]);
  if (!template.includes('{{')) return template;
  return template.replace(ANY, (_, path) => {
    const value = resolvePath(context, path);
    if (value === null || value === undefined) return '';
    return typeof value === 'object' ? JSON.stringify(value) : String(value);
  });
}

/** [{ key, value }] -> { key: rendered value } */
export function renderMapping(mapping, context) {
  const out = {};
  for (const row of Array.isArray(mapping) ? mapping : []) {
    if (!row || !NAME.test(String(row.key || ''))) continue;
    out[row.key] = renderTemplate(row.value ?? '', context);
  }
  return out;
}

const isEmpty = (value) => value === null || value === undefined || value === '' || (Array.isArray(value) && !value.length);

export function evaluateCondition(condition, context) {
  if (!condition || !String(condition.path || '').trim()) return true;
  const left = resolvePath(context, condition.path);
  const right = condition.value;
  const number = (value) => (value === '' || value === null || value === undefined ? NaN : Number(value));
  switch (condition.op || 'truthy') {
    case 'eq': return String(left ?? '') === String(right ?? '');
    case 'neq': return String(left ?? '') !== String(right ?? '');
    case 'gt': return number(left) > number(right);
    case 'lt': return number(left) < number(right);
    case 'contains': return Array.isArray(left) ? left.map(String).includes(String(right)) : String(left ?? '').toLowerCase().includes(String(right ?? '').toLowerCase());
    case 'empty': return isEmpty(left);
    case 'not_empty': return !isEmpty(left);
    case 'falsy': return !left || left === 'false';
    case 'truthy':
    default: return Boolean(left) && left !== 'false';
  }
}

export function conditionsMet(conditions, context) {
  return (conditions || []).every((condition) => evaluateCondition(condition, context));
}

export function describeCondition(condition, definition) {
  if (!condition?.path) return '';
  const path = String(condition.path);
  let subject = path;
  if (path.startsWith('fields.')) subject = (definition?.fields || []).find((field) => field.name === path.slice(7))?.label || path.slice(7);
  else if (path.startsWith('tasks.')) {
    const [, taskId, part] = path.split('.');
    const task = allTasks(definition).find((item) => item.task.id === taskId)?.task;
    subject = `${task?.name || taskId} ${part || 'status'}`;
  }
  const words = { eq: 'is', neq: 'is not', gt: 'is more than', lt: 'is less than', contains: 'contains', empty: 'is empty', not_empty: 'is filled in', truthy: 'is set', falsy: 'is not set' };
  return `${subject} ${words[condition.op || 'truthy'] || condition.op}${VALUE_OPS.includes(condition.op) ? ` ${condition.value ?? ''}` : ''}`.trim();
}

/** Checks case field values against the schema. Returns { values, errors: [{ path, message }] }. */
export function validateCaseFields(schema, input = {}, { partial = false } = {}) {
  const values = {};
  const errors = [];
  const source = input && typeof input === 'object' && !Array.isArray(input) ? input : {};
  for (const field of schema || []) {
    if (partial && !(field.name in source)) continue;
    let value = source[field.name];
    if (value === undefined || value === '' || value === null) value = field.type === 'checkbox' ? false : null;
    if (field.required && !partial && (value === null || (field.type === 'checkbox' && value !== true))) { errors.push({ path: field.name, message: `${field.label || field.name} is required` }); continue; }
    if (field.required && partial && value === null) { errors.push({ path: field.name, message: `${field.label || field.name} is required` }); continue; }
    if (value === null) { values[field.name] = null; continue; }
    switch (field.type) {
      case 'number': {
        const number = Number(value);
        if (!Number.isFinite(number)) errors.push({ path: field.name, message: `${field.label || field.name} must be a number` });
        else values[field.name] = number;
        break;
      }
      case 'checkbox': values[field.name] = value === true || value === 'true'; break;
      case 'date':
        if (!/^\d{4}-\d{2}-\d{2}$/.test(String(value))) errors.push({ path: field.name, message: `${field.label || field.name} must be a date (YYYY-MM-DD)` });
        else values[field.name] = String(value);
        break;
      case 'email':
        if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(value))) errors.push({ path: field.name, message: `${field.label || field.name} must be an email address` });
        else values[field.name] = String(value).slice(0, 320);
        break;
      case 'select':
        if (!(field.options || []).map(String).includes(String(value))) errors.push({ path: field.name, message: `${field.label || field.name} must be one of ${(field.options || []).join(', ')}` });
        else values[field.name] = String(value);
        break;
      default:
        values[field.name] = String(value).slice(0, field.type === 'textarea' ? 10000 : 1000);
    }
  }
  return { values, errors };
}

/** SLA state at `now` for a timer that started at `start` and is due at `due` (Dates or ms). */
export function slaState({ start, due, warnAt = 75, now = Date.now() }) {
  if (!due) return 'none';
  const startMs = new Date(start).getTime();
  const dueMs = new Date(due).getTime();
  const nowMs = new Date(now).getTime();
  if (nowMs >= dueMs) return 'breached';
  const total = dueMs - startMs;
  if (total > 0 && (nowMs - startMs) / total >= Math.min(99, Math.max(1, Number(warnAt) || 75)) / 100) return 'at_risk';
  return 'on_track';
}

/** Context used by conditions and task input templates. */
export function caseContext(caseRecord, tasks = []) {
  const taskMap = {};
  for (const task of tasks) {
    const current = taskMap[task.taskKey];
    if (!current || task.attempt >= current.attempt) taskMap[task.taskKey] = { status: task.status, outcome: task.outcome ?? null, output: task.output ?? null, attempt: task.attempt };
  }
  const fields = caseRecord?.fields || {};
  return {
    case: { id: caseRecord?.id, reference: caseRecord?.reference, title: caseRecord?.title, priority: caseRecord?.priority, status: caseRecord?.status, stage: caseRecord?.currentStageId, fields },
    fields,
    tasks: taskMap,
  };
}

/** Condition paths a stage may use: fields, and tasks of this stage or earlier ones. */
export function conditionPaths(definition, stageId, { includeCurrent = true } = {}) {
  const paths = (definition?.fields || []).map((field) => ({ path: `fields.${field.name}`, label: field.label || field.name, group: 'Fields' }));
  const index = stageIndex(definition, stageId);
  (definition?.stages || []).forEach((stage, position) => {
    if (position > index || (!includeCurrent && position === index)) return;
    for (const task of stage.tasks || []) {
      paths.push({ path: `tasks.${task.id}.status`, label: `${task.name}: status`, group: stage.name });
      if (task.kind === 'human') paths.push({ path: `tasks.${task.id}.outcome`, label: `${task.name}: decision`, group: stage.name });
      paths.push({ path: `tasks.${task.id}.output`, label: `${task.name}: output`, group: stage.name });
    }
  });
  return paths;
}

// ---- Validation ----------------------------------------------------------------------------

/**
 * Returns { errors, warnings }: [{ stageId?, taskId?, field?, escalationId?, scope?, message }].
 * `lookups` (optional) are Maps of project items by id: { workflows, flows, agents, users }.
 */
export function validateCaseTypeDefinition(definition, lookups = null) {
  const errors = [];
  const warnings = [];
  const add = (list, message, ref = {}) => list.push({ ...ref, message });
  if (!definition || !Array.isArray(definition.stages) || !Array.isArray(definition.fields)) {
    return { errors: [{ message: 'The case type needs fields and stages' }], warnings };
  }
  const fieldNames = new Set();
  if (definition.fields.length > LIMITS.fields) add(errors, `At most ${LIMITS.fields} fields`, { scope: 'fields' });
  definition.fields.forEach((field, index) => {
    const ref = { scope: 'fields', field: field?.name || `#${index + 1}` };
    if (!NAME.test(String(field?.name || ''))) { add(errors, `Field ${index + 1}: the name must start with a letter and use letters, digits, or _`, ref); return; }
    if (fieldNames.has(field.name)) add(errors, `Two fields are named ${field.name}`, ref);
    fieldNames.add(field.name);
    if (!String(field.label || '').trim()) add(errors, `${field.name}: add a label`, ref);
    if (!FIELD_TYPES.includes(field.type)) add(errors, `${field.name}: unknown type ${field.type}`, ref);
    if (field.type === 'select' && !(field.options || []).filter((option) => String(option).trim()).length) add(errors, `${field.label || field.name}: add the options to choose from`, ref);
  });

  const { stages } = definition;
  if (!stages.length) add(errors, 'Add at least one stage', { scope: 'stages' });
  if (stages.length > LIMITS.stages) add(errors, `At most ${LIMITS.stages} stages`, { scope: 'stages' });
  const stageIds = new Set();
  const taskIds = new Set();
  const seenTasks = new Map();
  const checkSla = (sla, ref, label) => {
    if (!sla) return;
    const hours = Number(sla.hours);
    if (!Number.isFinite(hours) || hours <= 0 || hours > LIMITS.slaHours) add(errors, `${label}: the SLA must be more than 0 and at most ${LIMITS.slaHours} hours`, { ...ref, field: 'sla' });
    const warnAt = Number(sla.warnAt ?? 75);
    if (!Number.isInteger(warnAt) || warnAt < 1 || warnAt > 99) add(errors, `${label}: warn at 1 to 99% of the SLA`, { ...ref, field: 'warnAt' });
  };
  const checkEscalations = (rules, ref, label, sla) => {
    if ((rules || []).length > LIMITS.escalations) add(errors, `${label}: at most ${LIMITS.escalations} escalation rules`, ref);
    const ids = new Set();
    for (const rule of rules || []) {
      const rref = { ...ref, escalationId: rule?.id };
      if (!ID.test(String(rule?.id || '')) || ids.has(rule.id)) add(errors, `${label}: escalation rules need unique ids`, rref);
      ids.add(rule?.id);
      if (!ESCALATION_TRIGGERS.includes(rule?.when)) add(errors, `${label}: escalate when the SLA is at risk or breached`, rref);
      if (!ESCALATION_ACTIONS.includes(rule?.action)) { add(errors, `${label}: unknown escalation action ${rule?.action}`, rref); continue; }
      const config = rule.config || {};
      if (rule.action === 'reassign') {
        if (!config.userId) add(errors, `${label}: choose who the case is reassigned to`, { ...rref, field: 'userId' });
        else if (lookups?.users && !lookups.users.has(config.userId)) add(errors, `${label}: the person to reassign to is not an active user`, { ...rref, field: 'userId' });
      }
      if (rule.action === 'raise_priority' && config.priority && !PRIORITIES.includes(config.priority)) add(errors, `${label}: unknown priority`, { ...rref, field: 'priority' });
      if (rule.action === 'create_task' && !String(config.title || '').trim()) add(errors, `${label}: give the escalation task a title`, { ...rref, field: 'title' });
      if (rule.action === 'create_task' && config.assignedRole && !WORKER_ROLES.includes(config.assignedRole)) add(errors, `${label}: unknown role`, { ...rref, field: 'assignedRole' });
    }
    if ((rules || []).length && !sla) add(warnings, `${label} has escalation rules but no SLA, so they never fire`, ref);
  };
  const checkConditions = (conditions, ref, label, allowedTaskIds, kind) => {
    if ((conditions || []).length > LIMITS.conditions) add(errors, `${label}: at most ${LIMITS.conditions} conditions`, ref);
    for (const condition of conditions || []) {
      const path = String(condition?.path || '').trim();
      if (!path) { add(errors, `${label}: a ${kind} condition has no field`, { ...ref, field: kind }); continue; }
      if (!CONDITION_OPS.includes(condition.op || 'truthy')) add(errors, `${label}: unknown condition operator ${condition.op}`, { ...ref, field: kind });
      const [root, name] = path.split('.');
      if (root === 'fields') { if (!fieldNames.has(name)) add(errors, `${label}: the ${kind} condition uses a field that does not exist (${name || path})`, { ...ref, field: kind }); }
      else if (root === 'tasks') { if (!allowedTaskIds.has(name)) add(errors, `${label}: the ${kind} condition uses a task that is not in this or an earlier stage (${name || path})`, { ...ref, field: kind }); }
      else if (root !== 'case') add(errors, `${label}: conditions read fields.<name>, tasks.<id>.status|outcome|output, or case.priority`, { ...ref, field: kind });
    }
  };
  const earlierTasks = new Set();
  stages.forEach((stage, index) => {
    const ref = { stageId: stage?.id };
    const label = stage?.name || stage?.id || `Stage ${index + 1}`;
    if (!ID.test(String(stage?.id || ''))) { add(errors, `Stage ${index + 1} needs an id that starts with a letter`, ref); return; }
    if (stageIds.has(stage.id)) add(errors, `Two stages have the id ${stage.id}`, ref);
    stageIds.add(stage.id);
    if (!String(stage.name || '').trim()) add(errors, `Stage ${index + 1} needs a name`, { ...ref, field: 'name' });
    const tasks = stage.tasks || [];
    if (tasks.length > LIMITS.tasksPerStage) add(errors, `${label}: at most ${LIMITS.tasksPerStage} tasks`, ref);
    if (index === 0 && (stage.entryConditions || []).length) add(errors, `${label} is the first stage: it cannot have entry conditions`, { ...ref, field: 'entry' });
    checkConditions(stage.entryConditions, ref, label, new Set(earlierTasks), 'entry');
    const stageTaskIds = new Set(tasks.map((task) => task?.id));
    checkConditions(stage.exitConditions, ref, label, new Set([...earlierTasks, ...stageTaskIds]), 'exit');
    checkSla(stage.sla, ref, label);
    checkEscalations(stage.escalations, ref, label, stage.sla);
    for (const task of tasks) {
      const tref = { stageId: stage.id, taskId: task?.id };
      const tlabel = `${label} → ${task?.name || task?.id || 'task'}`;
      if (!ID.test(String(task?.id || ''))) { add(errors, `${label}: a task needs an id that starts with a letter`, tref); continue; }
      if (taskIds.has(task.id)) add(errors, `Two tasks have the id ${task.id} (also in ${seenTasks.get(task.id)})`, tref);
      taskIds.add(task.id);
      seenTasks.set(task.id, label);
      if (!String(task.name || '').trim()) add(errors, `${label}: every task needs a name`, { ...tref, field: 'name' });
      if (!TASK_KINDS.includes(task.kind)) { add(errors, `${tlabel}: unknown task type ${task.kind}`, tref); continue; }
      const config = task.config || {};
      const published = (map, id, noun, field) => {
        if (!id) { add(errors, `${tlabel}: choose the ${noun}`, { ...tref, field }); return; }
        if (!map) return;
        const row = map.get(id);
        if (!row) add(errors, `${tlabel}: the ${noun} is not in this project`, { ...tref, field });
        else if (row.status !== 'published') add(errors, `${tlabel}: ${row.name} must be published before cases can run it`, { ...tref, field });
      };
      const mapping = (rows, field) => {
        const keys = new Set();
        for (const row of Array.isArray(rows) ? rows : []) {
          if (!NAME.test(String(row?.key || ''))) add(errors, `${tlabel}: "${row?.key || ''}" is not a valid input name`, { ...tref, field });
          else if (keys.has(row.key)) add(errors, `${tlabel}: ${row.key} is mapped twice`, { ...tref, field });
          keys.add(row?.key);
        }
      };
      if (task.kind === 'workflow') { published(lookups?.workflows, config.workflowId, 'workflow', 'workflowId'); mapping(config.inputs, 'inputs'); }
      if (task.kind === 'flow') { published(lookups?.flows, config.flowId, 'flow', 'flowId'); mapping(config.inputs, 'inputs'); }
      if (task.kind === 'agent') {
        published(lookups?.agents, config.agentId, 'agent', 'agentId');
        const agent = lookups?.agents?.get(config.agentId);
        if (agent?.agent_type === 'conversational' && !String(config.message || '').trim()) add(errors, `${tlabel}: write the message to send the agent`, { ...tref, field: 'message' });
        mapping(config.inputs, 'inputs');
      }
      if (task.kind === 'human') {
        if (!String(config.title || '').trim()) add(errors, `${tlabel}: give the Action Center task a title`, { ...tref, field: 'title' });
        if (config.taskType && !TASK_TYPES.includes(config.taskType)) add(errors, `${tlabel}: unknown task type`, { ...tref, field: 'taskType' });
        if (config.assignedRole && !WORKER_ROLES.includes(config.assignedRole)) add(errors, `${tlabel}: unknown role`, { ...tref, field: 'assignedRole' });
        if (config.assigneeUserId && lookups?.users && !lookups.users.has(config.assigneeUserId)) add(errors, `${tlabel}: the assignee is not an active user`, { ...tref, field: 'assigneeUserId' });
        const formNames = new Set();
        for (const [position, field] of (config.formFields || []).entries()) {
          if (!NAME.test(String(field?.name || ''))) add(errors, `${tlabel}: form field ${position + 1} needs a name of letters, digits, or _`, { ...tref, field: 'formFields' });
          else if (formNames.has(field.name)) add(errors, `${tlabel}: two form fields are named ${field.name}`, { ...tref, field: 'formFields' });
          formNames.add(field?.name);
          if (field?.type === 'select' && !(field.options || []).length) add(errors, `${tlabel}: ${field.name || `field ${position + 1}`} needs options`, { ...tref, field: 'formFields' });
        }
        const due = config.dueInHours;
        if (due !== null && due !== undefined && due !== '' && (!Number.isFinite(Number(due)) || Number(due) <= 0)) add(errors, `${tlabel}: due in must be a number of hours`, { ...tref, field: 'dueInHours' });
      }
    }
    for (const id of stageTaskIds) earlierTasks.add(id);
    if (index < stages.length - 1 && !tasks.length && !(stage.exitConditions || []).length) add(warnings, `${label} has no tasks or exit conditions, so cases pass straight through it`, ref);
  });
  checkSla(definition.sla, { scope: 'case' }, 'Case SLA');
  checkEscalations(definition.escalations, { scope: 'case' }, 'Case', definition.sla);
  const settings = definition.settings || {};
  if (settings.defaultPriority && !PRIORITIES.includes(settings.defaultPriority)) add(errors, 'Default priority must be low, medium, high, or critical', { scope: 'settings', field: 'defaultPriority' });
  if ((settings.workerRoles || []).some((role) => !WORKER_ROLES.includes(role))) add(errors, 'Unknown role in “who can work cases”', { scope: 'settings', field: 'workerRoles' });
  if (Array.isArray(settings.workerRoles) && !settings.workerRoles.length) add(errors, 'Pick at least one role that can work cases', { scope: 'settings', field: 'workerRoles' });
  if (settings.defaultOwnerUserId && lookups?.users && !lookups.users.has(settings.defaultOwnerUserId)) add(errors, 'The default owner is not an active user', { scope: 'settings', field: 'defaultOwnerUserId' });
  return { errors, warnings };
}

/** Who may work cases of a type (update fields, comment, act on tasks). Project membership is checked separately. */
export function canWorkCases(user, settings) {
  if (!user) return false;
  if (user.role === 'administrator') return true;
  const roles = settings?.workerRoles?.length ? settings.workerRoles : WORKER_ROLES;
  return roles.includes(user.role);
}

/** Managers move stages freely, cancel, and reassign. Owners manage their own cases. */
export function canManageCase(user, caseRecord) {
  if (!user) return false;
  if (['administrator', 'project_manager'].includes(user.role)) return true;
  return Boolean(caseRecord && (caseRecord.ownerUserId === user.id || caseRecord.owner_user_id === user.id));
}

export function formatDuration(ms) {
  const abs = Math.abs(ms);
  const minutes = Math.round(abs / 60000);
  if (minutes < 60) return `${minutes}m`;
  const hours = Math.floor(minutes / 60);
  if (hours < 48) return `${hours}h ${minutes % 60 ? `${minutes % 60}m` : ''}`.trim();
  const days = Math.floor(hours / 24);
  return `${days}d ${hours % 24 ? `${hours % 24}h` : ''}`.trim();
}
