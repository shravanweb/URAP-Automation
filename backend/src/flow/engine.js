// Flow engine. A run is a set of node activations kept in flow_run_nodes:
//   READY     -> the engine executes it on the next pass
//   WAITING   -> waiting for a job, an Action Center task, a timer, or (joins) more branches
//   SUCCEEDED / FAILED / CANCELLED
// advanceRun() is idempotent and safe to call from the API and the worker at the same time: a
// short lease on flow_runs.lock_until makes one caller do the work. Everything lives in the
// database, so a restarted worker simply continues. A failed step pauses the run (FAILED); retry
// re-activates the failed steps, cancel stops outstanding jobs and tasks.
import crypto from 'node:crypto';
import { writeAudit } from '../db/audit.js';
import { AppError } from '../lib/errors.js';
import { clampJson, redact } from '../lib/redact.js';
import { nextRun } from '../scheduler/cron.js';
import { compareValues, getPath, resolveTemplates } from '../workflow/expressions.js';
import { enqueueJob, cancelJob } from '../services/jobService.js';
import { createTask, presentTask } from '../services/taskService.js';
import { createRuntime } from '../services/runtime.js';
import { cancelAgentRun, startAgentRun } from '../agent/runtime.js';
import { incomingCount, outgoingEdges, outputVarOf } from './definition.js';

const parse = (value) => (typeof value === 'string' ? JSON.parse(value) : value);
const sqlDate = (date) => new Date(date).toISOString().slice(0, 23).replace('T', ' ');
const LEASE_SECONDS = 60;
const MAX_PASSES = 400;

export async function addEvent(pool, runId, nodeId, event, message, data = null) {
  await pool.query(
    `INSERT INTO flow_run_events (id, run_id, node_id, event, message, data_json, created_at) VALUES (?, ?, ?, ?, ?, ?, UTC_TIMESTAMP(3))`,
    [crypto.randomUUID(), runId, nodeId, event, String(message).slice(0, 1000), data == null ? null : JSON.stringify(clampJson(redact(data)))],
  );
}

async function loadRun(pool, runId) {
  const [rows] = await pool.query(`SELECT * FROM flow_runs WHERE id = ?`, [runId]);
  return rows[0] || null;
}

async function loadDefinition(pool, versionId) {
  const [rows] = await pool.query(`SELECT definition_json FROM flow_versions WHERE id = ?`, [versionId]);
  if (!rows[0]) throw new AppError(404, 'NOT_FOUND', 'Flow version not found');
  return parse(rows[0].definition_json);
}

async function insertNode(pool, run, node, fields = {}) {
  const id = crypto.randomUUID();
  await pool.query(
    `INSERT INTO flow_run_nodes (id, run_id, node_id, node_type, status, attempt, arrivals, started_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, UTC_TIMESTAMP(3), UTC_TIMESTAMP(3))`,
    [id, run.id, node.id, node.type, fields.status || 'READY', fields.attempt || 1, fields.arrivals || 0],
  );
  return id;
}

async function updateNode(pool, rowId, fields) {
  const keys = Object.keys(fields);
  await pool.query(
    `UPDATE flow_run_nodes SET ${keys.map((key) => `${key} = ?`).join(', ')}, updated_at = UTC_TIMESTAMP(3) WHERE id = ?`,
    [...keys.map((key) => fields[key]), rowId],
  );
}

/** Starts a run of the flow's current published version and advances it once. */
export async function startRun(pool, cfg, { flow, user, input = {}, triggerSource = 'manual' }) {
  if (flow.status !== 'published' || !flow.current_version_id) throw new AppError(409, 'FLOW_NOT_PUBLISHED', 'Publish the flow before running it');
  const [projects] = await pool.query(`SELECT status FROM projects WHERE id = ?`, [flow.project_id]);
  if (projects[0]?.status !== 'active') throw new AppError(409, 'PROJECT_INACTIVE', 'Archived projects cannot run flows');
  const definition = await loadDefinition(pool, flow.current_version_id);
  const safeInput = redact(input && typeof input === 'object' && !Array.isArray(input) ? input : {});
  const variables = {};
  for (const item of definition.variables || []) variables[item.name] = item.defaultValue ?? null;
  Object.assign(variables, safeInput);
  const id = crypto.randomUUID();
  await pool.query(
    `INSERT INTO flow_runs (id, tenant_id, project_id, flow_id, flow_version_id, status, trigger_source, input_json, variables_json, started_by, started_at, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, 'RUNNING', ?, ?, ?, ?, UTC_TIMESTAMP(3), UTC_TIMESTAMP(3), UTC_TIMESTAMP(3))`,
    [id, flow.tenant_id, flow.project_id, flow.id, flow.current_version_id, triggerSource, JSON.stringify(safeInput), JSON.stringify(variables), user?.id || null],
  );
  const run = await loadRun(pool, id);
  const start = definition.nodes.find((node) => node.type === 'start');
  await insertNode(pool, run, start);
  await addEvent(pool, id, null, 'run.started', `Run started (${triggerSource})`, Object.keys(safeInput).length ? { input: safeInput } : null);
  await writeAudit(pool, { tenantId: flow.tenant_id, userId: user?.id, action: 'flow.run', entityType: 'flow_run', entityId: id, projectId: flow.project_id, metadata: { flowId: flow.id, triggerSource } });
  return advanceRun(pool, cfg, id);
}

async function acquire(pool, runId) {
  const [result] = await pool.query(
    `UPDATE flow_runs SET lock_until = DATE_ADD(UTC_TIMESTAMP(3), INTERVAL ${LEASE_SECONDS} SECOND)
     WHERE id = ? AND status = 'RUNNING' AND (lock_until IS NULL OR lock_until < UTC_TIMESTAMP(3))`,
    [runId],
  );
  return result.affectedRows === 1;
}

function context(run, variables) {
  return { vars: variables, input: parse(run.input_json) || {} };
}

/** Moves a run forward as far as it can go right now. Returns the fresh run row. */
export async function advanceRun(pool, cfg, runId) {
  if (!(await acquire(pool, runId))) return loadRun(pool, runId);
  try {
    for (let pass = 0; pass < MAX_PASSES; pass += 1) {
      const run = await loadRun(pool, runId);
      if (!run || run.status !== 'RUNNING') break;
      const definition = await loadDefinition(pool, run.flow_version_id);
      const nodesById = new Map(definition.nodes.map((node) => [node.id, node]));
      const state = { run, definition, nodesById, variables: parse(run.variables_json) || {}, dirty: false, failed: null };
      const [rows] = await pool.query(`SELECT * FROM flow_run_nodes WHERE run_id = ? AND status IN ('READY', 'WAITING') ORDER BY started_at, id`, [runId]);
      if (!rows.length) {
        await pool.query(`UPDATE flow_runs SET status = 'SUCCEEDED', finished_at = UTC_TIMESTAMP(3), updated_at = UTC_TIMESTAMP(3) WHERE id = ? AND status = 'RUNNING'`, [runId]);
        await addEvent(pool, runId, null, 'run.succeeded', 'Run completed');
        break;
      }
      let progress = false;
      for (const row of rows) {
        const node = nodesById.get(row.node_id);
        if (!node) continue;
        try {
          if (await step(pool, cfg, state, row, node)) progress = true;
        } catch (error) {
          await fail(pool, state, row, node, error.message || String(error));
          progress = true;
        }
        if (state.failed) break;
      }
      if (state.dirty) {
        await pool.query(`UPDATE flow_runs SET variables_json = ?, updated_at = UTC_TIMESTAMP(3) WHERE id = ?`, [JSON.stringify(clampJson(state.variables)), runId]);
      }
      if (state.failed) {
        await pool.query(
          `UPDATE flow_runs SET status = 'FAILED', error_summary = ?, finished_at = UTC_TIMESTAMP(3), updated_at = UTC_TIMESTAMP(3) WHERE id = ? AND status = 'RUNNING'`,
          [state.failed.slice(0, 1000), runId],
        );
        await addEvent(pool, runId, null, 'run.failed', `Run failed: ${state.failed}`);
        break;
      }
      if (!progress) break;
    }
  } finally {
    await pool.query(`UPDATE flow_runs SET lock_until = NULL WHERE id = ?`, [runId]);
  }
  const final = await loadRun(pool, runId);
  // A run started by a case task: let the case move on once the run has finished.
  if (final?.case_id && final.status !== 'RUNNING') {
    const { notifyCase } = await import('../case/engine.js');
    await notifyCase(pool, cfg, final.case_id);
  }
  return final;
}

async function succeed(pool, state, row, node, output, { follow } = {}) {
  const outputVar = outputVarOf(node);
  if (outputVar && output !== undefined) { state.variables[outputVar] = output; state.dirty = true; }
  await updateNode(pool, row.id, { status: 'SUCCEEDED', finished_at: sqlDate(new Date()), output_json: output === undefined ? null : JSON.stringify(clampJson(output)) });
  await addEvent(pool, state.run.id, node.id, 'node.succeeded', `${node.name || node.id} completed`, output === undefined || node.type === 'start' ? null : { output });
  const edges = follow || continueEdges(state, node);
  for (const edge of edges) await activate(pool, state, edge.to);
}

function continueEdges(state, node) {
  const edges = outgoingEdges(state.definition, node.id);
  const boundaryTo = node.config?.boundary?.to;
  return boundaryTo ? edges.filter((edge) => edge.to !== boundaryTo) : edges;
}

function conditionHolds(condition, values) {
  if (!condition?.left) return true;
  const left = getPath(values, String(condition.left).replace(/^\{\{\s*|\s*\}\}$/g, ''));
  const right = resolveTemplates(condition.right ?? '', values);
  return compareValues(left, condition.op || 'eq', right);
}

function withBoundary(node, fields) {
  const seconds = Number(node.config?.boundary?.seconds);
  if (Number.isFinite(seconds) && seconds >= 1) fields.wake_at = sqlDate(new Date(Date.now() + seconds * 1000));
  return fields;
}

async function activate(pool, state, nodeId) {
  const node = state.nodesById.get(nodeId);
  if (!node) return;
  if (node.type === 'join') {
    const recorded = node.config?.takenFrom ? Number(state.variables[`__taken_${node.config.takenFrom}`]) : NaN;
    const needed = Number.isInteger(recorded) ? recorded : incomingCount(state.definition, node.id);
    const [rows] = await pool.query(`SELECT * FROM flow_run_nodes WHERE run_id = ? AND node_id = ? AND status = 'WAITING' LIMIT 1`, [state.run.id, node.id]);
    if (rows[0]) {
      const arrivals = rows[0].arrivals + 1;
      await updateNode(pool, rows[0].id, { arrivals, status: arrivals >= needed ? 'READY' : 'WAITING' });
      await addEvent(pool, state.run.id, node.id, 'join.arrived', `${node.name || node.id}: ${arrivals} of ${needed} branches arrived`);
    } else {
      await insertNode(pool, state.run, node, { status: needed <= 1 ? 'READY' : 'WAITING', arrivals: 1 });
      await addEvent(pool, state.run.id, node.id, 'join.arrived', `${node.name || node.id}: 1 of ${needed} branches arrived`);
    }
    return;
  }
  await insertNode(pool, state.run, node);
}

async function fail(pool, state, row, node, message) {
  const retries = Number(node.config?.retries || 0);
  if (['robot', 'http', 'agent'].includes(node.type) && row.attempt <= retries) {
    await updateNode(pool, row.id, { status: 'READY', attempt: row.attempt + 1, job_id: null, agent_run_id: null, error_message: String(message).slice(0, 1000) });
    await addEvent(pool, state.run.id, node.id, 'node.retry', `${node.name || node.id} failed (${message}); retrying, attempt ${row.attempt + 1} of ${retries + 1}`);
    return;
  }
  await updateNode(pool, row.id, { status: 'FAILED', finished_at: sqlDate(new Date()), error_message: String(message).slice(0, 1000) });
  await addEvent(pool, state.run.id, node.id, 'node.failed', `${node.name || node.id} failed: ${message}`);
  state.failed = `${node.name || node.id}: ${message}`;
}

async function takeBoundary(pool, state, row, node) {
  if (row.job_id) {
    const [jobs] = await pool.query(`SELECT * FROM automation_jobs WHERE id = ?`, [row.job_id]);
    if (jobs[0] && !['SUCCEEDED', 'FAILED', 'CANCELLED', 'SKIPPED'].includes(jobs[0].status)) await cancelJob(pool, jobs[0]).catch(() => {});
  }
  if (row.agent_run_id) {
    const [agentRuns] = await pool.query(`SELECT * FROM agent_runs WHERE id = ?`, [row.agent_run_id]);
    if (agentRuns[0] && ['RUNNING', 'WAITING', 'IDLE'].includes(agentRuns[0].status)) await cancelAgentRun(pool, {}, agentRuns[0], null).catch(() => {});
  }
  if (row.task_id) {
    await pool.query(`UPDATE action_tasks SET status = 'cancelled', comment = COALESCE(comment, 'A timer boundary interrupted this task'), updated_at = UTC_TIMESTAMP(3) WHERE id = ? AND status = 'pending'`, [row.task_id]);
  }
  const edge = outgoingEdges(state.definition, node.id).find((item) => item.to === node.config.boundary.to);
  await succeed(pool, state, row, node, { timedOut: true, waitedSeconds: Number(node.config.boundary.seconds) }, { follow: edge ? [edge] : [] });
}

function pseudoJob(run) {
  return { id: null, tenant_id: run.tenant_id, project_id: run.project_id, workflow_id: null };
}

/** Executes or checks one node activation. Returns true when something changed. */
async function step(pool, cfg, state, row, node) {
  const { run } = state;
  const config = node.config || {};
  const ctx = () => context(run, state.variables);
  if (row.status === 'READY') {
    await addEvent(pool, run.id, node.id, 'node.started', `${node.name || node.id} started`);
    switch (node.type) {
      case 'start':
        await succeed(pool, state, row, node, parse(run.input_json) || {});
        return true;
      case 'end':
      case 'parallel':
      case 'join':
        await succeed(pool, state, row, node, undefined);
        return true;
      case 'loop': {
        const max = Math.min(50, Math.max(1, Number(config.maxIterations) || 1));
        const key = `__loop_${node.id}`;
        const count = Number(state.variables[key] || 0) + 1;
        state.variables[key] = count;
        state.dirty = true;
        const edges = outgoingEdges(state.definition, node.id);
        const done = edges.find((edge) => edge.isDefault);
        const body = edges.find((edge) => edge !== done);
        const sourcePath = String(config.source || '').replace(/^\{\{\s*|\s*\}\}$/g, '');
        const listed = sourcePath ? getPath(ctx(), sourcePath) : undefined;
        const list = Array.isArray(listed) ? listed : null;
        let keep = count <= max && (!list || count <= list.length);
        if (keep && config.condition?.left) keep = conditionHolds(config.condition, ctx());
        if (keep && list && /^[A-Za-z][A-Za-z0-9_]{0,62}$/.test(String(config.itemVar || ''))) {
          state.variables[config.itemVar] = list[count - 1];
        }
        if (keep && body) await succeed(pool, state, row, node, { iteration: count, ...(list ? { item: list[count - 1] } : {}) }, { follow: [body] });
        else await succeed(pool, state, row, node, { iterations: Math.max(0, count - (keep ? 0 : 1)) }, { follow: done ? [done] : [] });
        return true;
      }
      case 'inclusive': {
        const edges = outgoingEdges(state.definition, node.id);
        const values = ctx();
        const matches = edges.filter((edge) => !edge.isDefault && (!edge.condition?.left || conditionHolds(edge.condition, values)));
        const taken = matches.length ? matches : edges.filter((edge) => edge.isDefault);
        if (!taken.length) throw new AppError(400, 'NO_BRANCH', 'No inclusive branch matched and there is no default branch');
        state.variables[`__taken_${node.id}`] = taken.length;
        state.dirty = true;
        await succeed(pool, state, row, node, { branches: taken.length }, { follow: taken });
        return true;
      }
      case 'race': {
        const edges = outgoingEdges(state.definition, node.id);
        const delays = config.delays || {};
        let best = null;
        for (const edge of edges) {
          const seconds = Number(delays[edge.to]);
          if (!Number.isFinite(seconds)) continue;
          if (!best || seconds < best.seconds) best = { edge, seconds };
        }
        if (!best) throw new AppError(400, 'NO_BRANCH', 'The race has no timed branch');
        await updateNode(pool, row.id, { status: 'WAITING', wake_at: sqlDate(new Date(Date.now() + best.seconds * 1000)), input_json: JSON.stringify({ to: best.edge.to, seconds: best.seconds }) });
        await addEvent(pool, run.id, node.id, 'node.waiting', `${node.name || node.id} waits ${best.seconds}s for the first branch`);
        return true;
      }
      case 'decision': {
        const edges = outgoingEdges(state.definition, node.id);
        const values = ctx();
        const match = edges.filter((edge) => !edge.isDefault).find((edge) => {
          const left = getPath(values, String(edge.condition.left).replace(/^\{\{\s*|\s*\}\}$/g, ''));
          const right = resolveTemplates(edge.condition.right ?? '', values);
          return compareValues(left, edge.condition.op, right);
        }) || edges.find((edge) => edge.isDefault);
        if (!match) throw new AppError(400, 'NO_BRANCH', 'No branch condition matched and there is no default branch');
        const target = state.nodesById.get(match.to);
        await succeed(pool, state, row, node, { branch: match.label || target?.name || match.to }, { follow: [match] });
        return true;
      }
      case 'timer': {
        const wake = new Date(Date.now() + Number(config.seconds) * 1000);
        await updateNode(pool, row.id, { status: 'WAITING', wake_at: sqlDate(wake) });
        await addEvent(pool, run.id, node.id, 'node.waiting', `${node.name || node.id} waits ${config.seconds}s`);
        return true;
      }
      case 'robot': {
        const [workflows] = await pool.query(`SELECT * FROM workflows WHERE id = ? AND project_id = ?`, [config.workflowId, run.project_id]);
        const workflow = workflows[0];
        if (!workflow) throw new AppError(404, 'WORKFLOW_NOT_FOUND', 'The workflow is not in this project');
        const [versions] = await pool.query(`SELECT * FROM workflow_versions WHERE id = ?`, [workflow.current_version_id]);
        if (!versions[0]) throw new AppError(409, 'VERSION_NOT_PUBLISHED', `${workflow.name} has no published version`);
        const [projects] = await pool.query(`SELECT * FROM projects WHERE id = ?`, [run.project_id]);
        const input = resolveTemplates(config.input || {}, ctx());
        const job = await enqueueJob(pool, cfg, {
          project: projects[0], workflow, version: versions[0], user: run.started_by ? { id: run.started_by } : null,
          input, triggerSource: 'flow',
        });
        await pool.query(`UPDATE automation_jobs SET flow_run_id = ? WHERE id = ?`, [run.id, job.id]);
        await updateNode(pool, row.id, withBoundary(node, { status: 'WAITING', job_id: job.id, input_json: JSON.stringify(clampJson(input)) }));
        await addEvent(pool, run.id, node.id, 'node.waiting', `${node.name || node.id} queued job for ${workflow.name}`, { jobId: job.id });
        return true;
      }
      case 'agent': {
        const [agents] = await pool.query(`SELECT * FROM agents WHERE id = ? AND project_id = ?`, [config.agentId, run.project_id]);
        const agent = agents[0];
        if (!agent) throw new AppError(404, 'AGENT_NOT_FOUND', 'The agent is not in this project');
        if (agent.status !== 'published' || !agent.current_version_id) throw new AppError(409, 'AGENT_NOT_PUBLISHED', `${agent.name} is not published`);
        const [versions] = await pool.query(`SELECT config_json FROM agent_versions WHERE id = ?`, [agent.current_version_id]);
        const input = resolveTemplates(config.input || {}, ctx());
        const agentRun = await startAgentRun(pool, cfg, {
          agent, config: parse(versions[0].config_json), versionId: agent.current_version_id, user: run.started_by ? { id: run.started_by } : null,
          input, mode: 'task', source: 'flow', flowRunId: run.id,
        });
        await updateNode(pool, row.id, withBoundary(node, { status: 'WAITING', agent_run_id: agentRun.id, input_json: JSON.stringify(clampJson(input)) }));
        await addEvent(pool, run.id, node.id, 'node.waiting', `${node.name || node.id} started agent ${agent.name}`, { agentRunId: agentRun.id });
        return true;
      }
      case 'human': {
        const values = ctx();
        const taskConfig = {
          taskType: config.taskType || (config.formFields?.length ? 'form' : 'approval'),
          title: resolveTemplates(config.title || 'Review required', values),
          description: config.description ? resolveTemplates(config.description, values) : undefined,
          priority: config.priority,
          formFields: config.formFields || [],
          outcomes: config.outcomes,
          requireCommentOnReject: config.requireCommentOnReject,
          data: config.data ? resolveTemplates(config.data, values) : {},
          assignee: config.assigneeUserId || undefined,
          assignedRole: config.assignedRole || undefined,
          dueInHours: config.dueInHours,
        };
        const task = await createTask(pool, pseudoJob(run), node.id, taskConfig);
        await pool.query(`UPDATE action_tasks SET flow_run_id = ? WHERE id = ?`, [run.id, task.id]);
        await updateNode(pool, row.id, withBoundary(node, { status: 'WAITING', task_id: task.id, input_json: JSON.stringify(clampJson({ title: taskConfig.title, data: taskConfig.data })) }));
        await addEvent(pool, run.id, node.id, 'node.waiting', `${node.name || node.id} created Action Center task “${taskConfig.title}”`, { taskId: task.id });
        return true;
      }
      case 'case': {
        const [types] = await pool.query(`SELECT * FROM case_types WHERE id = ? AND project_id = ?`, [config.caseTypeId, run.project_id]);
        if (!types[0]) throw new AppError(404, 'CASE_TYPE_NOT_FOUND', 'The case type is not in this project');
        const values = ctx();
        const { createCase } = await import('../case/engine.js');
        const created = await createCase(pool, cfg, {
          caseType: types[0], user: run.started_by ? { id: run.started_by } : null,
          title: config.title ? String(resolveTemplates(config.title, values) ?? '') : undefined,
          fields: config.fields ? resolveTemplates(config.fields, values) : {},
          priority: config.priority || undefined, source: 'flow', sourceRef: run.id,
        });
        const summary = { caseId: created.id, reference: created.reference, status: created.status, stage: created.current_stage_id };
        await updateNode(pool, row.id, { input_json: JSON.stringify(summary) });
        if (config.waitForResolution && !['resolved', 'closed'].includes(created.status)) {
          await updateNode(pool, row.id, withBoundary(node, { status: 'WAITING' }));
          await addEvent(pool, run.id, node.id, 'node.waiting', `${node.name || node.id} opened case ${created.reference} and waits for it to be resolved`, { caseId: created.id });
        } else {
          await succeed(pool, state, row, node, summary);
        }
        return true;
      }
      case 'http': {
        const values = ctx();
        const request = {
          connectionId: config.connectionId,
          method: String(config.method || 'GET').toUpperCase(),
          path: resolveTemplates(config.path || '/', values),
          query: config.query ? resolveTemplates(config.query, values) : undefined,
          headers: config.headers ? resolveTemplates(config.headers, values) : undefined,
          body: config.body != null && config.body !== '' ? resolveTemplates(typeof config.body === 'string' ? safeJson(config.body) : config.body, values) : undefined,
          failOnError: config.failOnError !== false,
        };
        const runtime = createRuntime(pool, cfg, pseudoJob(run));
        try {
          const output = await runtime.httpRequest(request);
          await updateNode(pool, row.id, { input_json: JSON.stringify(clampJson({ method: request.method, path: request.path })) });
          await succeed(pool, state, row, node, output);
        } finally {
          await runtime.dispose();
        }
        return true;
      }
      default:
        throw new AppError(400, 'UNKNOWN_NODE', `Unknown step type ${node.type}`);
    }
  }
  // WAITING
  if (['robot', 'human', 'agent', 'case'].includes(node.type) && node.config?.boundary?.to && row.wake_at && new Date(`${String(row.wake_at).replace(' ', 'T')}Z`) <= new Date()) {
    await takeBoundary(pool, state, row, node);
    return true;
  }
  if (node.type === 'race') {
    if (row.wake_at && new Date(`${String(row.wake_at).replace(' ', 'T')}Z`) <= new Date()) {
      const chosen = parse(row.input_json) || {};
      const edge = outgoingEdges(state.definition, node.id).find((item) => item.to === chosen.to);
      await succeed(pool, state, row, node, { waitedSeconds: chosen.seconds }, { follow: edge ? [edge] : [] });
      return true;
    }
    return false;
  }
  if (node.type === 'timer') {
    if (row.wake_at && new Date(`${row.wake_at.replace(' ', 'T')}Z`) <= new Date()) {
      await succeed(pool, state, row, node, { waitedSeconds: Number(config.seconds) });
      return true;
    }
    return false;
  }
  if (node.type === 'robot' && row.job_id) {
    const [jobs] = await pool.query(`SELECT id, status, error_summary FROM automation_jobs WHERE id = ?`, [row.job_id]);
    const job = jobs[0];
    if (!job) throw new AppError(404, 'JOB_NOT_FOUND', 'The job disappeared');
    if (job.status === 'SUCCEEDED') {
      const [attempts] = await pool.query(`SELECT output_json FROM job_attempts WHERE job_id = ? ORDER BY attempt_number DESC LIMIT 1`, [job.id]);
      const output = parse(attempts[0]?.output_json) || {};
      await succeed(pool, state, row, node, output);
      return true;
    }
    if (['FAILED', 'CANCELLED', 'SKIPPED'].includes(job.status)) {
      await fail(pool, state, row, node, `Job ${job.status.toLowerCase()}${job.error_summary ? `: ${job.error_summary}` : ''}`);
      return true;
    }
    return false;
  }
  if (node.type === 'agent' && row.agent_run_id) {
    const [agentRuns] = await pool.query(`SELECT id, status, output_json, error_message, prompt_tokens, completion_tokens FROM agent_runs WHERE id = ?`, [row.agent_run_id]);
    const agentRun = agentRuns[0];
    if (!agentRun) throw new AppError(404, 'AGENT_RUN_NOT_FOUND', 'The agent run disappeared');
    if (agentRun.status === 'SUCCEEDED') {
      await succeed(pool, state, row, node, parse(agentRun.output_json) ?? {});
      return true;
    }
    if (['FAILED', 'CANCELLED'].includes(agentRun.status)) {
      await fail(pool, state, row, node, `Agent run ${agentRun.status.toLowerCase()}${agentRun.error_message ? `: ${agentRun.error_message}` : ''}`);
      return true;
    }
    return false;
  }
  if (node.type === 'human' && row.task_id) {
    const [tasks] = await pool.query(`SELECT t.*, u.email AS completed_by_email FROM action_tasks t LEFT JOIN users u ON u.id = t.completed_by WHERE t.id = ?`, [row.task_id]);
    const task = tasks[0];
    if (!task) throw new AppError(404, 'TASK_NOT_FOUND', 'The Action Center task disappeared');
    if (task.status === 'completed') {
      const presented = presentTask(task);
      await succeed(pool, state, row, node, {
        taskId: task.id, outcome: presented.outcome, data: presented.result?.data ?? {}, comment: presented.comment,
        completedBy: presented.completedByEmail || presented.completedBy, completedAt: presented.completedAt,
      });
      return true;
    }
    if (task.status === 'cancelled') {
      await fail(pool, state, row, node, 'The Action Center task was cancelled');
      return true;
    }
    return false;
  }
  if (node.type === 'case') {
    const caseId = parse(row.input_json)?.caseId;
    const [cases] = await pool.query(`SELECT id, reference, status, fields_json, resolved_at FROM cases WHERE id = ?`, [caseId]);
    const found = cases[0];
    if (!found) throw new AppError(404, 'CASE_NOT_FOUND', 'The case disappeared');
    if (['resolved', 'closed'].includes(found.status)) {
      await succeed(pool, state, row, node, { caseId: found.id, reference: found.reference, status: found.status, fields: parse(found.fields_json) || {}, resolvedAt: found.resolved_at });
      return true;
    }
    if (found.status === 'cancelled') {
      await fail(pool, state, row, node, `Case ${found.reference} was cancelled`);
      return true;
    }
    return false;
  }
  return false; // joins waiting for more branches
}

function safeJson(text) {
  try { return JSON.parse(text); } catch { return text; }
}

/** Cancels a running or failed run: stops its jobs, cancels its open tasks. */
export async function cancelRun(pool, run, user) {
  if (!['RUNNING', 'FAILED'].includes(run.status)) throw new AppError(409, 'INVALID_STATE', `Cannot cancel a ${run.status.toLowerCase()} run`);
  const [result] = await pool.query(
    `UPDATE flow_runs SET status = 'CANCELLED', finished_at = UTC_TIMESTAMP(3), updated_at = UTC_TIMESTAMP(3) WHERE id = ? AND status IN ('RUNNING', 'FAILED')`,
    [run.id],
  );
  if (result.affectedRows !== 1) throw new AppError(409, 'INVALID_STATE', 'The run changed; reload and try again');
  const [rows] = await pool.query(`SELECT * FROM flow_run_nodes WHERE run_id = ? AND status IN ('READY', 'WAITING')`, [run.id]);
  for (const row of rows) {
    if (row.job_id) {
      const [jobs] = await pool.query(`SELECT * FROM automation_jobs WHERE id = ?`, [row.job_id]);
      if (jobs[0] && !['SUCCEEDED', 'FAILED', 'CANCELLED', 'SKIPPED'].includes(jobs[0].status)) await cancelJob(pool, jobs[0]).catch(() => {});
    }
    if (row.agent_run_id) {
      const [agentRuns] = await pool.query(`SELECT * FROM agent_runs WHERE id = ?`, [row.agent_run_id]);
      if (agentRuns[0] && ['RUNNING', 'WAITING', 'IDLE'].includes(agentRuns[0].status)) await cancelAgentRun(pool, {}, agentRuns[0], user).catch(() => {});
    }
    if (row.task_id) {
      await pool.query(`UPDATE action_tasks SET status = 'cancelled', comment = COALESCE(comment, 'The flow run was cancelled'), updated_at = UTC_TIMESTAMP(3) WHERE id = ? AND status = 'pending'`, [row.task_id]);
    }
    await updateNode(pool, row.id, { status: 'CANCELLED', finished_at: sqlDate(new Date()) });
  }
  await addEvent(pool, run.id, null, 'run.cancelled', `Run cancelled${user?.email ? ` by ${user.email}` : ''}`);
  await writeAudit(pool, { tenantId: run.tenant_id, userId: user?.id, action: 'flow_run.cancel', entityType: 'flow_run', entityId: run.id, projectId: run.project_id });
  return loadRun(pool, run.id);
}

/** Retries the failed steps of a failed run and continues it. */
export async function retryRun(pool, cfg, run, user) {
  if (run.status !== 'FAILED') throw new AppError(409, 'INVALID_STATE', 'Only a failed run can be retried');
  const [failed] = await pool.query(`SELECT * FROM flow_run_nodes WHERE run_id = ? AND status = 'FAILED'`, [run.id]);
  const [result] = await pool.query(
    `UPDATE flow_runs SET status = 'RUNNING', error_summary = NULL, finished_at = NULL, lock_until = NULL, updated_at = UTC_TIMESTAMP(3) WHERE id = ? AND status = 'FAILED'`,
    [run.id],
  );
  if (result.affectedRows !== 1) throw new AppError(409, 'INVALID_STATE', 'The run changed; reload and try again');
  for (const row of failed) {
    await updateNode(pool, row.id, { status: 'CANCELLED' });
    await pool.query(
      `INSERT INTO flow_run_nodes (id, run_id, node_id, node_type, status, attempt, arrivals, started_at, updated_at)
       VALUES (?, ?, ?, ?, 'READY', 1, ?, UTC_TIMESTAMP(3), UTC_TIMESTAMP(3))`,
      [crypto.randomUUID(), run.id, row.node_id, row.node_type, row.arrivals],
    );
  }
  await addEvent(pool, run.id, null, 'run.retried', `Retrying ${failed.length} failed step${failed.length === 1 ? '' : 's'}${user?.email ? ` (by ${user.email})` : ''}`);
  await writeAudit(pool, { tenantId: run.tenant_id, userId: user?.id, action: 'flow_run.retry', entityType: 'flow_run', entityId: run.id, projectId: run.project_id });
  return advanceRun(pool, cfg, run.id);
}

/** Worker tick: start scheduled flows and advance active runs. Returns how many runs moved. */
export async function advanceFlows(pool, cfg, { limit = 25 } = {}) {
  const [due] = await pool.query(
    `SELECT * FROM flows WHERE status = 'published' AND trigger_type = 'schedule' AND next_run_at IS NOT NULL AND next_run_at <= UTC_TIMESTAMP(3) LIMIT 10`,
  );
  for (const flow of due) {
    let upcoming = null;
    try { upcoming = sqlDate(nextRun(flow.schedule_cron, new Date(), flow.schedule_timezone || 'UTC')); } catch { upcoming = null; }
    const [claimed] = await pool.query(`UPDATE flows SET next_run_at = ? WHERE id = ? AND next_run_at = ?`, [upcoming, flow.id, flow.next_run_at]);
    if (claimed.affectedRows !== 1) continue;
    await startRun(pool, cfg, { flow, user: null, input: {}, triggerSource: 'schedule' }).catch((error) => {
      console.error(JSON.stringify({ event: 'flow.schedule.failed', flowId: flow.id, message: error.message }));
    });
  }
  const [runs] = await pool.query(
    `SELECT id FROM flow_runs WHERE status = 'RUNNING' AND (lock_until IS NULL OR lock_until < UTC_TIMESTAMP(3)) ORDER BY updated_at ASC LIMIT ${Number(limit)}`,
  );
  for (const { id } of runs) await advanceRun(pool, cfg, id);
  return runs.length;
}
