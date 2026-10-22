import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import { writeAudit } from '../db/audit.js';
import { withTransaction } from '../db/pool.js';
import { AppError } from '../lib/errors.js';
import { clampJson, redact } from '../lib/redact.js';
import { sha256 } from '../lib/cryptoSecrets.js';
import { resolveInside } from '../lib/paths.js';
import { assertTransition } from '../workflow/stateMachine.js';
import { executeWorkflow } from '../workflow/engine.js';
import { createRuntime } from './runtime.js';
import { releaseItemsForJob } from './queueService.js';
import { cancelTasksForJob } from './taskService.js';
import { packageNeedsExecution } from '../robot/robotRuntime.js';

const ACTIVE = ['QUEUED', 'CLAIMED', 'RUNNING', 'RETRY_WAIT', 'CANCEL_REQUESTED', 'SUSPENDED'];

function parseJson(value) {
  return typeof value === 'string' ? JSON.parse(value) : value;
}

function sqlDate(date) {
  return new Date(date).toISOString().slice(0, 23).replace('T', ' ');
}

async function transition(connection, job, to, fields = {}) {
  assertTransition(job.status, to);
  const assignments = ['status = ?', 'updated_at = UTC_TIMESTAMP(3)'];
  const params = [to];
  for (const [key, value] of Object.entries(fields)) {
    assignments.push(`${key} = ?`);
    params.push(value);
  }
  params.push(job.id, job.status);
  const [result] = await connection.query(
    `UPDATE automation_jobs SET ${assignments.join(', ')} WHERE id = ? AND status = ?`,
    params,
  );
  if (result.affectedRows !== 1) {
    throw new AppError(409, 'INVALID_STATE', 'Job status changed concurrently');
  }
  job.status = to;
}

export async function enqueueJob(pool, cfg, { project, workflow, version, user, input, triggerSource, scheduleId, idempotencyKey }) {
  if (project.status !== 'active') throw new AppError(409, 'PROJECT_INACTIVE', 'Archived projects cannot run jobs');
  if (workflow.status !== 'published') throw new AppError(409, 'WORKFLOW_DISABLED', 'Only a published workflow can run');
  if (version.status !== 'published') throw new AppError(409, 'VERSION_NOT_PUBLISHED', 'Job must use a published workflow version');
  const definition = version.definition_json;
  const target = workflow.execution_type === 'uipath' ? 'robot' : 'native';
  const jobId = crypto.randomUUID();
  const correlationId = crypto.randomUUID();
  const safeInput = redact(input || {});
  try {
    await pool.query(
      `INSERT INTO automation_jobs (
        id, tenant_id, project_id, workflow_id, workflow_version_id, schedule_id, trigger_source,
        execution_target, status, priority, input_json, correlation_id, idempotency_key,
        current_attempt, max_attempts, queued_at, available_at, created_by, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'QUEUED', 0, ?, ?, ?, 0, ?, UTC_TIMESTAMP(3), UTC_TIMESTAMP(3), ?, UTC_TIMESTAMP(3), UTC_TIMESTAMP(3))`,
      [
        jobId, project.tenant_id, project.id, workflow.id, version.id, scheduleId || null,
        triggerSource, target, JSON.stringify(safeInput), correlationId, idempotencyKey || null,
        definition.retryPolicy?.maxAttempts || 1, user?.id || null,
      ],
    );
  } catch (error) {
    if (error.code === 'ER_DUP_ENTRY' && idempotencyKey) {
      const [rows] = await pool.query(
        `SELECT * FROM automation_jobs WHERE tenant_id = ? AND idempotency_key = ?`,
        [project.tenant_id, idempotencyKey],
      );
      return rows[0];
    }
    throw error;
  }
  if (target === 'robot') {
    await writeRobotInbox(cfg, {
      jobId,
      projectId: project.id,
      workflowId: workflow.id,
      workflowVersionId: version.id,
      correlationId,
      input: safeInput,
      connectionRefs: [],
      task: 'ExecuteSupportedTask',
      ...(packageNeedsExecution(definition) ? { definition } : {}),
      reportPath: path.join(cfg.storageRoot, project.tenant_id, project.id, 'reports', `${jobId}.txt`),
    });
  }
  await writeAudit(pool, {
    tenantId: project.tenant_id,
    userId: user?.id,
    action: 'job.enqueue',
    entityType: 'job',
    entityId: jobId,
    projectId: project.id,
    metadata: { triggerSource, workflowId: workflow.id, version: version.version_number },
  });
  const [rows] = await pool.query(`SELECT * FROM automation_jobs WHERE id = ?`, [jobId]);
  return rows[0];
}

async function writeRobotInbox(cfg, payload) {
  const inbox = path.join(cfg.robotRoot, 'inbox');
  await fs.mkdir(inbox, { recursive: true });
  await fs.writeFile(path.join(inbox, `${payload.jobId}.json`), JSON.stringify(payload, null, 2));
}

export async function claimNext(pool, target, actor = {}) {
  const params = [target];
  let sql = `SELECT id FROM automation_jobs
    WHERE execution_target = ? AND status = 'QUEUED' AND available_at <= UTC_TIMESTAMP(3)
      AND NOT EXISTS (SELECT 1 FROM tenants t WHERE t.id = automation_jobs.tenant_id AND t.status = 'suspended')`;
  if (actor.projectIds) {
    if (!actor.projectIds.length) return null;
    sql += ` AND project_id IN (${actor.projectIds.map(() => '?').join(',')})`;
    params.push(...actor.projectIds);
  }
  sql += ` ORDER BY priority DESC, queued_at ASC LIMIT 5`;
  return withTransaction(pool, async (connection) => {
    const [rows] = await connection.query(sql, params);
    let job = null;
    for (const row of rows) {
      const [updated] = await connection.query(
        `UPDATE automation_jobs
         SET status = 'CLAIMED', claimed_at = UTC_TIMESTAMP(3), robot_id = COALESCE(?, robot_id), updated_at = UTC_TIMESTAMP(3)
         WHERE id = ? AND status = 'QUEUED'`,
        [actor.robotId || null, row.id],
      );
      if (updated.affectedRows === 1) {
        const [jobs] = await connection.query(`SELECT * FROM automation_jobs WHERE id = ? FOR UPDATE`, [row.id]);
        job = jobs[0];
        break;
      }
    }
    if (!job) return null;
    const resume = parseJson(job.resume_state_json);
    if (resume && resume.output !== undefined && Number(job.current_attempt) > 0) {
      // Resuming after an Action Center task: continue the same attempt.
      const [attempts] = await connection.query(`SELECT id FROM job_attempts WHERE job_id = ? AND attempt_number = ?`, [job.id, job.current_attempt]);
      if (attempts[0]) {
        await connection.query(`UPDATE job_attempts SET status = 'RUNNING', finished_at = NULL, worker_id = ? WHERE id = ?`, [actor.workerId || null, attempts[0].id]);
        await transition(connection, job, 'RUNNING', {});
        return { job, attemptId: attempts[0].id, attemptNumber: Number(job.current_attempt), resume };
      }
    }
    const attemptId = crypto.randomUUID();
    const attemptNumber = Number(job.current_attempt) + 1;
    await connection.query(
      `INSERT INTO job_attempts (
        id, job_id, attempt_number, status, started_at, worker_id, created_at
      ) VALUES (?, ?, ?, 'RUNNING', UTC_TIMESTAMP(3), ?, UTC_TIMESTAMP(3))`,
      [attemptId, job.id, attemptNumber, actor.workerId || null],
    );
    await transition(connection, job, 'RUNNING', {
      current_attempt: attemptNumber,
      started_at: job.started_at || sqlDate(new Date()),
    });
    return { job, attemptId, attemptNumber };
  });
}

export function mimeFor(file) {
  const lower = String(file).toLowerCase();
  if (lower.endsWith('.xlsx')) return 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';
  if (lower.endsWith('.csv')) return 'text/csv';
  if (lower.endsWith('.txt')) return 'text/plain';
  if (lower.endsWith('.json')) return 'application/json';
  if (lower.endsWith('.pdf')) return 'application/pdf';
  if (lower.endsWith('.png')) return 'image/png';
  if (lower.endsWith('.jpg') || lower.endsWith('.jpeg')) return 'image/jpeg';
  return 'application/octet-stream';
}

async function persistArtifacts(pool, cfg, job, attemptId, stepOutputs, { extraPaths = [], tolerant = false } = {}) {
  const storageRoot = path.join(cfg.storageRoot, job.tenant_id, job.project_id);
  const save = async (relative) => {
    const absolute = resolveInside(storageRoot, relative);
    let data;
    try {
      data = await fs.readFile(absolute);
    } catch (error) {
      if (tolerant) return null;
      throw error;
    }
    const id = crypto.randomUUID();
    await pool.query(
      `INSERT INTO artifacts (
        id, tenant_id, project_id, job_id, attempt_id, file_name, storage_path, mime_type,
        size_bytes, checksum_sha256, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, UTC_TIMESTAMP(3))`,
      [
        id, job.tenant_id, job.project_id, job.id, attemptId, path.basename(relative),
        relative, mimeFor(relative),
        data.length, sha256(data),
      ],
    );
    return id;
  };
  for (const output of Object.values(stepOutputs || {})) {
    if (!output || typeof output !== 'object') continue;
    if (output.path && !output.artifactId) {
      const id = await save(output.path);
      if (id) output.artifactId = id;
    }
    // Steps that save several files (the attendance punch screenshots) list them in artifacts.
    if (Array.isArray(output.artifacts) && !output.artifactIds) {
      output.artifactIds = [];
      for (const relative of output.artifacts) {
        const id = await save(relative);
        if (id) output.artifactIds.push(id);
      }
    }
  }
  for (const relative of extraPaths) await save(relative);
}

export async function processClaimedJob(pool, cfg, claimed, overrides = {}) {
  const { job, attemptId, attemptNumber, resume } = claimed;
  const [versions] = await pool.query(`SELECT * FROM workflow_versions WHERE id = ?`, [job.workflow_version_id]);
  const definition = versions[0].definition_json;
  const runtime = createRuntime(pool, cfg, job, overrides);
  const result = await executeWorkflow(definition, job.input_json || {}, runtime, {
    shouldCancel: async () => {
      const [rows] = await pool.query(`SELECT status FROM automation_jobs WHERE id = ?`, [job.id]);
      return rows[0]?.status === 'CANCEL_REQUESTED';
    },
    onStep: async (event) => {
      await pool.query(`UPDATE automation_jobs SET updated_at = UTC_TIMESTAMP(3) WHERE id = ?`, [job.id]);
      await pool.query(
        `INSERT INTO job_step_runs (
          id, attempt_id, step_key, step_type, status, started_at, finished_at, duration_ms,
          input_json, output_json, error_message, iteration_index
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          crypto.randomUUID(), attemptId, event.step.id, event.step.type, event.status,
          event.startedAt ? sqlDate(event.startedAt) : null,
          event.finishedAt ? sqlDate(event.finishedAt) : null,
          event.durationMs ?? null,
          JSON.stringify(clampJson(event.step.config || {})),
          event.output === undefined ? null : JSON.stringify(clampJson(event.output)),
          event.error ? String(event.error).slice(0, 1000) : null,
          event.iteration ?? null,
        ],
      );
    },
  }, 0, resume ? { steps: resume.steps, stepId: resume.stepId, output: resume.output } : null).finally(() => runtime.dispose());
  if (result.status === 'SUCCEEDED' || result.status === 'SUSPENDED') {
    await persistArtifacts(pool, cfg, job, attemptId, result.steps);
  } else if (result.status === 'FAILED') {
    // Keep what the failed run produced (screenshots up to and at the failure) for debugging.
    await persistArtifacts(pool, cfg, job, attemptId, result.steps, { extraPaths: result.error?.screenshots || [], tolerant: true }).catch(() => {});
  }
  if (result.status === 'SUSPENDED') {
    await withTransaction(pool, async (connection) => {
      // Lock the task before the job, the same order completeTask uses.
      const [tasks] = await connection.query(`SELECT * FROM action_tasks WHERE id = ? FOR UPDATE`, [result.suspend.taskId]);
      const [freshRows] = await connection.query(`SELECT * FROM automation_jobs WHERE id = ? FOR UPDATE`, [job.id]);
      const fresh = freshRows[0];
      if (fresh.status === 'CANCEL_REQUESTED') {
        await transition(connection, fresh, 'CANCELLED', { finished_at: sqlDate(new Date()), resume_state_json: null });
        await connection.query(`UPDATE job_attempts SET status = 'CANCELLED', finished_at = UTC_TIMESTAMP(3) WHERE id = ?`, [attemptId]);
        await cancelTasksForJob(connection, job.id);
        return;
      }
      await transition(connection, fresh, 'SUSPENDED', {
        resume_state_json: JSON.stringify({ stepId: result.suspend.stepId, taskId: result.suspend.taskId, steps: result.steps }),
      });
      await connection.query(`UPDATE job_attempts SET status = 'SUSPENDED' WHERE id = ?`, [attemptId]);
      const task = tasks[0];
      if (task && task.status === 'completed') {
        // Someone finished the task before the job had suspended: queue the resume now.
        const resultJson = parseJson(task.result_json) || {};
        const output = { taskId: task.id, status: 'completed', outcome: task.outcome, data: resultJson.data ?? null, comment: task.comment, completedBy: task.completed_by, completedAt: task.completed_at };
        await transition(connection, fresh, 'QUEUED', {
          available_at: sqlDate(new Date()),
          resume_state_json: JSON.stringify({ stepId: result.suspend.stepId, taskId: task.id, steps: result.steps, output }),
        });
      }
    });
    const [rows] = await pool.query(`SELECT * FROM automation_jobs WHERE id = ?`, [job.id]);
    return rows[0];
  }
  await withTransaction(pool, async (connection) => {
    const [freshRows] = await connection.query(`SELECT * FROM automation_jobs WHERE id = ? FOR UPDATE`, [job.id]);
    const fresh = freshRows[0];
    const retryable = Boolean(result.error?.retryable);
    const canRetry = result.status === 'FAILED' && retryable && attemptNumber < Number(fresh.max_attempts);
    let next = result.status === 'SUCCEEDED' ? 'SUCCEEDED' : 'FAILED';
    if (fresh.status === 'CANCEL_REQUESTED' || result.status === 'CANCELLED') next = 'CANCELLED';
    else if (canRetry) next = 'RETRY_WAIT';
    const backoff = definition.retryPolicy?.backoffSeconds || 0;
    const fields = {
      finished_at: next === 'RETRY_WAIT' ? null : sqlDate(new Date()),
      error_summary: result.error?.message?.slice(0, 1000) || null,
      resume_state_json: null,
    };
    if (next === 'RETRY_WAIT') fields.available_at = sqlDate(new Date(Date.now() + backoff * 1000));
    await transition(connection, fresh, next, fields);
    await connection.query(
      `UPDATE job_attempts SET status = ?, finished_at = UTC_TIMESTAMP(3), error_code = ?, error_message = ?, retryable = ?, output_json = ? WHERE id = ?`,
      [
        next === 'RETRY_WAIT' ? 'FAILED' : next,
        result.error?.code || null,
        result.error?.message?.slice(0, 1000) || null,
        retryable ? 1 : 0,
        JSON.stringify(clampJson(result.output || {})),
        attemptId,
      ],
    );
  });
  const attendanceSteps = (definition.steps || []).filter((step) => step.type === 'browser_flutter_attendance');
  const punchStep = attendanceSteps.find((step) => step.config?.phase === 'verify') || attendanceSteps.find((step) => !step.config?.phase || step.config.phase === 'all') || attendanceSteps.at(-1);
  if (punchStep) {
    // Attendance punches are recorded in the audit log, so each day's result is easy to find.
    const punch = result.steps?.[punchStep.id] || {};
    await writeAudit(pool, {
      tenantId: job.tenant_id, userId: job.created_by || null, action: 'job.attendance_punch', entityType: 'job', entityId: job.id, projectId: job.project_id,
      result: result.status === 'SUCCEEDED' ? 'success' : 'failure',
      metadata: { workflowId: job.workflow_id, action: punch.action || punchStep.config?.action, outcome: punch.status || result.status, confirmed: punch.confirmed ?? false, error: result.error?.message?.slice(0, 300) || null, screenshots: attendanceSteps.reduce((sum, step) => sum + (result.steps?.[step.id]?.screenshots?.length || 0), 0) + (result.error?.screenshots?.length || 0) },
    }).catch(() => {});
  }
  await releaseItemsForJob(pool, job.id, result.status === 'SUCCEEDED'
    ? 'The job finished without setting the transaction status'
    : `The job attempt ended: ${result.error?.message || result.status}`.slice(0, 1000));
  const [rows] = await pool.query(`SELECT * FROM automation_jobs WHERE id = ?`, [job.id]);
  return rows[0];
}

/**
 * A worker that crashes leaves its job RUNNING. Running jobs refresh updated_at on every step,
 * so a job that has not moved for `minutes` is failed (or cancelled when cancellation was
 * requested) and its open attempt is closed. An operator can then retry it.
 */
export async function recoverStaleJobs(pool, minutes) {
  const [rows] = await pool.query(
    `SELECT * FROM automation_jobs
     WHERE execution_target = 'native' AND status IN ('CLAIMED', 'RUNNING', 'CANCEL_REQUESTED')
       AND updated_at < DATE_SUB(UTC_TIMESTAMP(3), INTERVAL ? MINUTE)`,
    [Math.max(Number(minutes) || 30, 1)],
  );
  const recovered = [];
  for (const row of rows) {
    try {
      await withTransaction(pool, async (connection) => {
        const [fresh] = await connection.query(`SELECT * FROM automation_jobs WHERE id = ? FOR UPDATE`, [row.id]);
        const job = fresh[0];
        if (!['CLAIMED', 'RUNNING', 'CANCEL_REQUESTED'].includes(job.status)) return;
        const next = job.status === 'CANCEL_REQUESTED' ? 'CANCELLED' : 'FAILED';
        const message = 'The worker stopped reporting progress for this job';
        await transition(connection, job, next, { finished_at: sqlDate(new Date()), error_summary: message });
        await connection.query(
          `UPDATE job_attempts SET status = ?, finished_at = UTC_TIMESTAMP(3), error_code = 'WORKER_LOST', error_message = ?, retryable = 1
           WHERE job_id = ? AND status = 'RUNNING'`,
          [next, message, job.id],
        );
      });
      await releaseItemsForJob(pool, row.id, 'The worker stopped reporting progress for this job');
      recovered.push(row.id);
    } catch (error) {
      if (!(error instanceof AppError)) throw error;
    }
  }
  return recovered;
}

/** Lets an authorized robot take ownership of a queued robot job before it starts work. */
export async function claimRobotJob(pool, jobId, robot, projectIds) {
  return withTransaction(pool, async (connection) => {
    const [rows] = await connection.query(`SELECT * FROM automation_jobs WHERE id = ? FOR UPDATE`, [jobId]);
    const job = rows[0];
    if (!job || job.tenant_id !== robot.tenant_id) throw new AppError(404, 'NOT_FOUND', 'Job not found');
    if (!projectIds.includes(job.project_id)) throw new AppError(403, 'FORBIDDEN', 'Robot is not authorized for this job');
    if (job.execution_target !== 'robot') throw new AppError(409, 'INVALID_STATE', 'This job is not assigned to a robot');
    if (job.status !== 'QUEUED') throw new AppError(409, 'ALREADY_CLAIMED', `Job is ${job.status}`);
    const attemptNumber = Number(job.current_attempt) + 1;
    await transition(connection, job, 'CLAIMED', { claimed_at: sqlDate(new Date()), robot_id: robot.id });
    await transition(connection, job, 'RUNNING', { started_at: job.started_at || sqlDate(new Date()), current_attempt: attemptNumber });
    await connection.query(
      `INSERT INTO job_attempts (id, job_id, attempt_number, status, started_at, worker_id, created_at)
       VALUES (?, ?, ?, 'RUNNING', UTC_TIMESTAMP(3), ?, UTC_TIMESTAMP(3))`,
      [crypto.randomUUID(), job.id, attemptNumber, robot.id],
    );
    const [fresh] = await connection.query(`SELECT * FROM automation_jobs WHERE id = ?`, [job.id]);
    return fresh[0];
  });
}

export async function processNextNativeJob(pool, cfg, workerId) {
  const claimed = await claimNext(pool, 'native', { workerId });
  if (!claimed) return null;
  return processClaimedJob(pool, cfg, claimed);
}

export async function promoteRetries(pool) {
  const [result] = await pool.query(
    `UPDATE automation_jobs
     SET status = 'QUEUED', updated_at = UTC_TIMESTAMP(3)
     WHERE status = 'RETRY_WAIT' AND available_at <= UTC_TIMESTAMP(3)`,
  );
  return result.affectedRows;
}

export async function retryJob(pool, job, cfg = null) {
  if (['QUEUED', 'RETRY_WAIT', 'CLAIMED', 'RUNNING', 'CANCEL_REQUESTED', 'SUSPENDED'].includes(job.status)) return job;
  if (job.status === 'SKIPPED') throw new AppError(409, 'INVALID_STATE', 'A skipped schedule run cannot be retried. Run the workflow instead.');
  await withTransaction(pool, async (connection) => {
    const [rows] = await connection.query(`SELECT * FROM automation_jobs WHERE id = ? FOR UPDATE`, [job.id]);
    const fresh = rows[0];
    if (['QUEUED', 'RETRY_WAIT', 'CLAIMED', 'RUNNING', 'CANCEL_REQUESTED', 'SUSPENDED'].includes(fresh.status)) return;
    await transition(connection, fresh, 'QUEUED', {
      available_at: sqlDate(new Date()),
      error_summary: null,
      finished_at: null,
      trigger_source: 'retry',
      resume_state_json: null,
    });
  });
  const [rows] = await pool.query(`SELECT * FROM automation_jobs WHERE id = ?`, [job.id]);
  if (cfg && rows[0].execution_target === 'robot' && rows[0].status === 'QUEUED') {
    await writeRobotInbox(cfg, robotPayload(cfg, rows[0]));
  }
  return rows[0];
}

function robotPayload(cfg, job) {
  return {
    jobId: job.id,
    projectId: job.project_id,
    workflowId: job.workflow_id,
    workflowVersionId: job.workflow_version_id,
    correlationId: job.correlation_id,
    input: job.input_json || {},
    connectionRefs: [],
    task: 'ExecuteSupportedTask',
    reportPath: path.join(cfg.storageRoot, job.tenant_id, job.project_id, 'reports', `${job.id}.txt`),
  };
}

export async function cancelJob(pool, job) {
  if (job.status === 'CANCELLED' || job.status === 'CANCEL_REQUESTED') return job;
  await withTransaction(pool, async (connection) => {
    const [rows] = await connection.query(`SELECT * FROM automation_jobs WHERE id = ? FOR UPDATE`, [job.id]);
    const fresh = rows[0];
    if (fresh.status === 'CANCELLED' || fresh.status === 'CANCEL_REQUESTED') return;
    if (['SUCCEEDED', 'FAILED', 'SKIPPED'].includes(fresh.status)) {
      throw new AppError(409, 'INVALID_STATE', `Cannot cancel a ${fresh.status} job`);
    }
    const next = fresh.status === 'RUNNING' ? 'CANCEL_REQUESTED' : 'CANCELLED';
    await transition(connection, fresh, next, next === 'CANCELLED' ? { finished_at: sqlDate(new Date()), resume_state_json: null } : {});
    if (next === 'CANCELLED') {
      await cancelTasksForJob(connection, fresh.id);
      await connection.query(`UPDATE job_attempts SET status = 'CANCELLED', finished_at = UTC_TIMESTAMP(3) WHERE job_id = ? AND status IN ('RUNNING', 'SUSPENDED')`, [fresh.id]);
    }
  });
  const [rows] = await pool.query(`SELECT * FROM automation_jobs WHERE id = ?`, [job.id]);
  return rows[0];
}

export async function applyRobotResult(pool, cfg, result, actor = {}) {
  if (!result?.jobId) throw new AppError(400, 'VALIDATION', 'Robot result requires a jobId');
  if (!['SUCCEEDED', 'FAILED'].includes(result.executionStatus)) {
    throw new AppError(400, 'VALIDATION', 'Robot executionStatus must be SUCCEEDED or FAILED');
  }
  return withTransaction(pool, async (connection) => {
    const [rows] = await connection.query(`SELECT * FROM automation_jobs WHERE id = ? FOR UPDATE`, [result.jobId]);
    const job = rows[0];
    if (!job) throw new AppError(404, 'NOT_FOUND', 'Job not found');
    if (actor.robot && (actor.robot.tenant_id !== job.tenant_id || !actor.projectIds.includes(job.project_id))) {
      throw new AppError(403, 'FORBIDDEN', 'Robot is not authorized for this job');
    }
    if (result.correlationId && result.correlationId !== job.correlation_id) {
      throw new AppError(400, 'CORRELATION_MISMATCH', 'Correlation id does not match the job');
    }
    if (['SUCCEEDED', 'FAILED', 'CANCELLED', 'SKIPPED'].includes(job.status)) return job;
    if (job.execution_target !== 'robot') throw new AppError(409, 'INVALID_STATE', 'This job is not assigned to a robot');
    let attemptNumber = Number(job.current_attempt);
    if (job.status === 'QUEUED') {
      await transition(connection, job, 'CLAIMED', { claimed_at: sqlDate(new Date()), robot_id: actor.robot?.id || job.robot_id });
    }
    if (job.status === 'CLAIMED') {
      attemptNumber += 1;
      await transition(connection, job, 'RUNNING', {
        started_at: result.startedAt ? sqlDate(result.startedAt) : sqlDate(new Date()),
        current_attempt: attemptNumber,
      });
    }
    attemptNumber = Math.max(attemptNumber, 1);
    const [attempts] = await connection.query(
      `SELECT id, attempt_number FROM job_attempts WHERE job_id = ? AND attempt_number = ? LIMIT 1`,
      [job.id, attemptNumber],
    );
    let attemptId = attempts[0]?.id;
    if (!attemptId) {
      attemptId = crypto.randomUUID();
      await connection.query(
        `INSERT INTO job_attempts (id, job_id, attempt_number, status, started_at, worker_id, created_at)
         VALUES (?, ?, ?, 'RUNNING', UTC_TIMESTAMP(3), ?, UTC_TIMESTAMP(3))`,
        [attemptId, job.id, attemptNumber, actor.robot?.id || 'robot-file'],
      );
    }
    let next = result.executionStatus === 'SUCCEEDED' ? 'SUCCEEDED' : 'FAILED';
    if (job.status === 'CANCEL_REQUESTED' && next === 'SUCCEEDED') next = 'CANCELLED';
    await transition(connection, job, next, {
      finished_at: result.completedAt ? sqlDate(result.completedAt) : sqlDate(new Date()),
      error_summary: result.errorMessage ? String(result.errorMessage).slice(0, 1000) : null,
    });
    await connection.query(
      `UPDATE job_attempts SET status = ?, finished_at = UTC_TIMESTAMP(3), error_code = ?, error_message = ?, retryable = ?, output_json = ? WHERE id = ?`,
      [
        next, result.errorCode || null, result.errorMessage ? String(result.errorMessage).slice(0, 1000) : null,
        result.retryable ? 1 : 0, JSON.stringify(clampJson(result.output || {})), attemptId,
      ],
    );
    if (Array.isArray(result.steps)) {
      for (const step of result.steps.slice(0, 500)) {
        if (!step || typeof step.stepId !== 'string' || typeof step.type !== 'string') continue;
        await connection.query(
          `INSERT INTO job_step_runs (
            id, attempt_id, step_key, step_type, status, started_at, finished_at, duration_ms,
            input_json, output_json, error_message, iteration_index
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          [
            crypto.randomUUID(), attemptId, step.stepId.slice(0, 80), step.type.slice(0, 64),
            ['SUCCEEDED', 'FAILED', 'SKIPPED'].includes(step.status) ? step.status : 'FAILED',
            step.startedAt ? sqlDate(step.startedAt) : null,
            step.finishedAt ? sqlDate(step.finishedAt) : null,
            Number.isFinite(step.durationMs) ? Math.round(step.durationMs) : null,
            JSON.stringify(clampJson(step.input || {})),
            step.output === undefined ? null : JSON.stringify(clampJson(step.output)),
            step.error ? String(step.error).slice(0, 1000) : null,
            Number.isInteger(step.iteration) ? step.iteration : null,
          ],
        );
      }
    }
    if (result.output?.reportPath) {
      const relative = path.join('reports', `${job.id}.txt`);
      const absolute = resolveInside(path.join(cfg.storageRoot, job.tenant_id, job.project_id), relative);
      try {
        const data = await fs.readFile(absolute);
        await connection.query(
          `INSERT INTO artifacts (
            id, tenant_id, project_id, job_id, attempt_id, file_name, storage_path, mime_type,
            size_bytes, checksum_sha256, created_at
          ) VALUES (?, ?, ?, ?, ?, ?, ?, 'text/plain', ?, ?, UTC_TIMESTAMP(3))`,
          [crypto.randomUUID(), job.tenant_id, job.project_id, job.id, attemptId, `${job.id}.txt`, relative, data.length, sha256(data)],
        );
      } catch (error) {
        if (error.code !== 'ENOENT') throw error;
      }
    }
    await writeAudit(pool, {
      tenantId: job.tenant_id,
      robotId: actor.robot?.id,
      action: 'job.robot_result',
      entityType: 'job',
      entityId: job.id,
      projectId: job.project_id,
      metadata: { executionStatus: next },
    });
    return job;
  });
}

export async function syncRobotOutbox(pool, cfg) {
  const outbox = path.join(cfg.robotRoot, 'outbox');
  let files = [];
  try {
    files = await fs.readdir(outbox);
  } catch (error) {
    if (error.code === 'ENOENT') return [];
    throw error;
  }
  const applied = [];
  // Only `{jobId}.json` results complete robot jobs. Step-level files written for hybrid
  // workflows are named `{jobId}-{task}.json` and are read by the step itself.
  const resultFile = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\.json$/i;
  for (const file of files.filter((name) => resultFile.test(name))) {
    const full = path.join(outbox, file);
    try {
      const result = JSON.parse(await fs.readFile(full, 'utf8'));
      const job = await applyRobotResult(pool, cfg, result, {});
      applied.push(job.id);
      const processed = path.join(cfg.robotRoot, 'processed');
      await fs.mkdir(processed, { recursive: true });
      await fs.rename(full, path.join(processed, `${Date.now()}-${file}`));
    } catch (error) {
      if (!(error instanceof AppError) && !(error instanceof SyntaxError)) throw error;
      const rejected = path.join(cfg.robotRoot, 'rejected');
      await fs.mkdir(rejected, { recursive: true });
      await fs.rename(full, path.join(rejected, `${Date.now()}-${file}`));
    }
  }
  return applied;
}

export { ACTIVE };
