import crypto from 'node:crypto';
import { writeAudit } from '../db/audit.js';
import { withTransaction } from '../db/pool.js';
import { nextRun } from '../scheduler/cron.js';
import { enqueueJob } from './jobService.js';

function sqlDate(date) {
  return new Date(date).toISOString().slice(0, 23).replace('T', ' ');
}

async function advance(connection, schedule) {
  if (schedule.schedule_type === 'once') {
    await connection.query(
      `UPDATE schedules SET enabled = 0, next_run_at = NULL, last_run_at = UTC_TIMESTAMP(3), lock_until = NULL, updated_at = UTC_TIMESTAMP(3) WHERE id = ?`,
      [schedule.id],
    );
    return;
  }
  const upcoming = nextRun(schedule.cron_expression, new Date(), schedule.timezone || 'UTC');
  await connection.query(
    `UPDATE schedules SET next_run_at = ?, last_run_at = UTC_TIMESTAMP(3), lock_until = NULL, updated_at = UTC_TIMESTAMP(3) WHERE id = ?`,
    [sqlDate(upcoming), schedule.id],
  );
}

export async function runDueSchedules(pool, cfg) {
  const due = await withTransaction(pool, async (connection) => {
    const [rows] = await connection.query(
      `SELECT * FROM schedules
       WHERE enabled = 1 AND schedule_type IN ('once', 'recurring')
         AND next_run_at IS NOT NULL AND next_run_at <= UTC_TIMESTAMP(3)
         AND (lock_until IS NULL OR lock_until < UTC_TIMESTAMP(3))
         AND NOT EXISTS (SELECT 1 FROM tenants t WHERE t.id = schedules.tenant_id AND t.status = 'suspended')
       ORDER BY next_run_at ASC
       LIMIT 10
       FOR UPDATE SKIP LOCKED`,
    );
    for (const schedule of rows) {
      await connection.query(
        `UPDATE schedules SET lock_until = DATE_ADD(UTC_TIMESTAMP(3), INTERVAL 2 MINUTE) WHERE id = ?`,
        [schedule.id],
      );
    }
    return rows;
  });
  const results = [];
  for (const schedule of due) {
    results.push(await triggerSchedule(pool, cfg, schedule));
  }
  return results;
}

async function triggerSchedule(pool, cfg, schedule) {
  const [workflows] = await pool.query(`SELECT * FROM workflows WHERE id = ?`, [schedule.workflow_id]);
  const workflow = workflows[0];
  const [versions] = await pool.query(
    `SELECT * FROM workflow_versions WHERE id = ?`,
    [workflow?.current_version_id],
  );
  const version = versions[0];
  const [projects] = await pool.query(`SELECT * FROM projects WHERE id = ?`, [schedule.project_id]);
  const project = projects[0];
  const blocked = !workflow || workflow.status !== 'published' || !version || project?.status !== 'active';
  if (!blocked && schedule.overlap_policy === 'skip') {
    const [active] = await pool.query(
      `SELECT id FROM automation_jobs
       WHERE schedule_id = ? AND status IN ('QUEUED', 'CLAIMED', 'RUNNING', 'RETRY_WAIT', 'CANCEL_REQUESTED', 'SUSPENDED')
       LIMIT 1`,
      [schedule.id],
    );
    if (active.length) {
      await withTransaction(pool, async (connection) => {
        await connection.query(
          `INSERT INTO schedule_runs (id, schedule_id, status, reason, triggered_at)
           VALUES (?, ?, 'SKIPPED', 'An earlier run is still active', UTC_TIMESTAMP(3))`,
          [crypto.randomUUID(), schedule.id],
        );
        const [skipped] = await connection.query(
          `INSERT INTO automation_jobs (
            id, tenant_id, project_id, workflow_id, workflow_version_id, schedule_id, trigger_source,
            execution_target, status, input_json, correlation_id, current_attempt, max_attempts,
            queued_at, finished_at, available_at, error_summary, created_at, updated_at
          ) VALUES (?, ?, ?, ?, ?, ?, 'schedule', 'native', 'SKIPPED', ?, ?, 0, 1,
            UTC_TIMESTAMP(3), UTC_TIMESTAMP(3), UTC_TIMESTAMP(3), 'Skipped because an earlier run is still active',
            UTC_TIMESTAMP(3), UTC_TIMESTAMP(3))`,
          [
            crypto.randomUUID(), schedule.tenant_id, schedule.project_id, workflow.id, version.id,
            schedule.id, JSON.stringify(schedule.input_json || {}), crypto.randomUUID(),
          ],
        );
        void skipped;
        await advance(connection, schedule);
      });
      return { scheduleId: schedule.id, status: 'SKIPPED' };
    }
  }
  if (blocked) {
    await withTransaction(pool, async (connection) => {
      await connection.query(
        `INSERT INTO schedule_runs (id, schedule_id, status, reason, triggered_at)
         VALUES (?, ?, 'FAILED', 'Workflow is not published or the project is archived', UTC_TIMESTAMP(3))`,
        [crypto.randomUUID(), schedule.id],
      );
      await advance(connection, schedule);
    });
    return { scheduleId: schedule.id, status: 'FAILED' };
  }
  const job = await enqueueJob(pool, cfg, {
    project, workflow, version, user: null, input: schedule.input_json || {},
    triggerSource: 'schedule', scheduleId: schedule.id,
  });
  await withTransaction(pool, async (connection) => {
    await connection.query(
      `INSERT INTO schedule_runs (id, schedule_id, job_id, status, triggered_at) VALUES (?, ?, ?, 'TRIGGERED', UTC_TIMESTAMP(3))`,
      [crypto.randomUUID(), schedule.id, job.id],
    );
    await advance(connection, schedule);
  });
  await writeAudit(pool, {
    tenantId: schedule.tenant_id,
    action: 'schedule.trigger',
    entityType: 'schedule',
    entityId: schedule.id,
    projectId: schedule.project_id,
    metadata: { jobId: job.id },
  });
  return { scheduleId: schedule.id, status: 'TRIGGERED', jobId: job.id };
}
