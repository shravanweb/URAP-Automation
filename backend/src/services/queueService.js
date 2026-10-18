import crypto from 'node:crypto';
import { writeAudit } from '../db/audit.js';
import { withTransaction } from '../db/pool.js';
import { AppError } from '../lib/errors.js';
import { clampJson } from '../lib/redact.js';
import { enqueueJob } from './jobService.js';

export const QUEUE_ITEM_STATUSES = ['NEW', 'IN_PROGRESS', 'SUCCESSFUL', 'FAILED', 'ABANDONED', 'DELETED'];
const PRIORITY = { low: 0, normal: 1, high: 2 };

function sqlDate(date) {
  return new Date(date).toISOString().slice(0, 23).replace('T', ' ');
}

export function priorityValue(value) {
  if (value === undefined || value === null || value === '') return 1;
  if (typeof value === 'number' && [0, 1, 2].includes(value)) return value;
  const mapped = PRIORITY[String(value).toLowerCase()];
  if (mapped === undefined) throw new AppError(400, 'VALIDATION', 'priority must be low, normal, or high');
  return mapped;
}

export function presentQueue(row, counts = null) {
  return {
    id: row.id,
    projectId: row.project_id,
    name: row.name,
    description: row.description,
    maxRetries: row.max_retries,
    uniqueReference: Boolean(row.unique_reference),
    triggerWorkflowId: row.trigger_workflow_id,
    triggerEnabled: Boolean(row.trigger_enabled),
    status: row.status,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    ...(counts ? { counts } : {}),
  };
}

export function presentItem(row) {
  return {
    id: row.id,
    queueId: row.queue_id,
    projectId: row.project_id,
    reference: row.reference,
    priority: ['low', 'normal', 'high'][row.priority] || 'normal',
    status: row.status,
    retryCount: row.retry_count,
    specificContent: row.specific_content_json,
    output: row.output_json,
    errorType: row.error_type,
    errorMessage: row.error_message,
    deferUntil: row.defer_until,
    dueAt: row.due_at,
    lockedByJobId: row.locked_by_job_id,
    lockedByRobotId: row.locked_by_robot_id,
    startedAt: row.started_at,
    finishedAt: row.finished_at,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export async function queueCounts(pool, queueIds) {
  const result = new Map(queueIds.map((id) => [id, Object.fromEntries(QUEUE_ITEM_STATUSES.map((status) => [status, 0]))]));
  if (!queueIds.length) return result;
  const [rows] = await pool.query(
    `SELECT queue_id, status, COUNT(*) AS count FROM queue_items
     WHERE queue_id IN (${queueIds.map(() => '?').join(',')}) GROUP BY queue_id, status`,
    queueIds,
  );
  for (const row of rows) result.get(row.queue_id)[row.status] = Number(row.count);
  return result;
}

export async function findQueue(pool, { tenantId, projectId, queueId, queueName }) {
  const [rows] = queueId
    ? await pool.query(`SELECT * FROM work_queues WHERE id = ? AND tenant_id = ? AND project_id = ?`, [queueId, tenantId, projectId])
    : await pool.query(`SELECT * FROM work_queues WHERE name = ? AND tenant_id = ? AND project_id = ?`, [queueName, tenantId, projectId]);
  if (!rows[0]) throw new AppError(404, 'QUEUE_NOT_FOUND', 'Queue was not found in this project');
  if (rows[0].status !== 'active') throw new AppError(409, 'QUEUE_ARCHIVED', 'Queue is archived');
  return rows[0];
}

export async function addQueueItem(pool, queue, { reference, specificContent, priority, deferUntil, dueAt, userId }) {
  if (queue.unique_reference && !reference) {
    throw new AppError(400, 'VALIDATION', 'This queue enforces unique references, so a reference is required');
  }
  const id = crypto.randomUUID();
  try {
    await pool.query(
      `INSERT INTO queue_items (
        id, queue_id, tenant_id, project_id, reference, unique_reference_key, priority, status, retry_count,
        specific_content_json, defer_until, due_at, created_by, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, 'NEW', 0, ?, ?, ?, ?, UTC_TIMESTAMP(3), UTC_TIMESTAMP(3))`,
      [
        id, queue.id, queue.tenant_id, queue.project_id, reference ? String(reference).slice(0, 200) : null,
        queue.unique_reference && reference ? String(reference).slice(0, 200) : null,
        priorityValue(priority), JSON.stringify(clampJson(specificContent || {}, 100000)),
        deferUntil ? sqlDate(deferUntil) : null, dueAt ? sqlDate(dueAt) : null, userId || null,
      ],
    );
  } catch (error) {
    if (error.code === 'ER_DUP_ENTRY') {
      throw new AppError(409, 'DUPLICATE_REFERENCE', `An item with reference ${reference} already exists in this queue`);
    }
    throw error;
  }
  const [rows] = await pool.query(`SELECT * FROM queue_items WHERE id = ?`, [id]);
  return rows[0];
}

/** Locks up to `count` NEW items for one consumer (a native job or a robot). */
export async function getNextItems(pool, queue, { count = 1, jobId = null, robotId = null } = {}) {
  const limit = Math.min(Math.max(Number(count) || 1, 1), 100);
  return withTransaction(pool, async (connection) => {
    const [rows] = await connection.query(
      `SELECT id FROM queue_items
       WHERE queue_id = ? AND status = 'NEW' AND (defer_until IS NULL OR defer_until <= UTC_TIMESTAMP(3))
       ORDER BY priority DESC, (due_at IS NULL), due_at, created_at
       LIMIT ${limit}
       FOR UPDATE SKIP LOCKED`,
      [queue.id],
    );
    if (!rows.length) return [];
    const ids = rows.map((row) => row.id);
    await connection.query(
      `UPDATE queue_items
       SET status = 'IN_PROGRESS', locked_by_job_id = ?, locked_by_robot_id = ?, started_at = UTC_TIMESTAMP(3),
           finished_at = NULL, updated_at = UTC_TIMESTAMP(3)
       WHERE id IN (${ids.map(() => '?').join(',')}) AND status = 'NEW'`,
      [jobId, robotId, ...ids],
    );
    const [items] = await connection.query(
      `SELECT * FROM queue_items WHERE id IN (${ids.map(() => '?').join(',')})
       ORDER BY priority DESC, (due_at IS NULL), due_at, created_at`,
      ids,
    );
    return items;
  });
}

/**
 * Records a transaction result. An application error is retried (the item returns to NEW with
 * retry_count + 1) while the queue's max_retries allows it. A business error is never retried.
 */
export async function setItemResult(pool, itemId, result, scope = {}) {
  const status = String(result.status || '').toUpperCase();
  if (!['SUCCESSFUL', 'FAILED'].includes(status)) {
    throw new AppError(400, 'VALIDATION', 'status must be SUCCESSFUL or FAILED');
  }
  const errorType = status === 'FAILED' ? (result.errorType === 'business' ? 'business' : 'application') : null;
  return withTransaction(pool, async (connection) => {
    const [rows] = await connection.query(
      `SELECT i.*, q.max_retries FROM queue_items i JOIN work_queues q ON q.id = i.queue_id WHERE i.id = ? FOR UPDATE`,
      [itemId],
    );
    const item = rows[0];
    if (!item || (scope.tenantId && item.tenant_id !== scope.tenantId)) throw new AppError(404, 'QUEUE_ITEM_NOT_FOUND', 'Queue item was not found');
    if (scope.projectIds && !scope.projectIds.includes(item.project_id)) throw new AppError(403, 'FORBIDDEN', 'Not authorized for this queue item');
    if (scope.projectId && item.project_id !== scope.projectId) throw new AppError(404, 'QUEUE_ITEM_NOT_FOUND', 'Queue item was not found in this project');
    if (item.status !== 'IN_PROGRESS') throw new AppError(409, 'INVALID_STATE', `Queue item is ${item.status}, not IN_PROGRESS`);
    const retry = status === 'FAILED' && errorType === 'application' && Number(item.retry_count) < Number(item.max_retries);
    await connection.query(
      `UPDATE queue_items SET status = ?, retry_count = ?, error_type = ?, error_message = ?, output_json = ?,
         locked_by_job_id = NULL, locked_by_robot_id = NULL, finished_at = ?, updated_at = UTC_TIMESTAMP(3)
       WHERE id = ?`,
      [
        retry ? 'NEW' : status,
        retry ? Number(item.retry_count) + 1 : item.retry_count,
        errorType,
        status === 'FAILED' ? String(result.errorMessage || 'Transaction failed').slice(0, 1000) : null,
        JSON.stringify(clampJson(result.output || {}, 100000)),
        retry ? null : sqlDate(new Date()),
        item.id,
      ],
    );
    const [updated] = await connection.query(`SELECT * FROM queue_items WHERE id = ?`, [item.id]);
    return updated[0];
  });
}

export async function retryItem(pool, item) {
  if (!['FAILED', 'ABANDONED'].includes(item.status)) throw new AppError(409, 'INVALID_STATE', 'Only failed or abandoned items can be retried');
  const [result] = await pool.query(
    `UPDATE queue_items SET status = 'NEW', retry_count = retry_count + 1, finished_at = NULL, locked_by_job_id = NULL,
       locked_by_robot_id = NULL, updated_at = UTC_TIMESTAMP(3)
     WHERE id = ? AND status IN ('FAILED', 'ABANDONED')`,
    [item.id],
  );
  if (result.affectedRows !== 1) throw new AppError(409, 'INVALID_STATE', 'Queue item changed concurrently');
  const [rows] = await pool.query(`SELECT * FROM queue_items WHERE id = ?`, [item.id]);
  return rows[0];
}

export async function deleteItem(pool, item) {
  if (item.status !== 'NEW') throw new AppError(409, 'INVALID_STATE', 'Only NEW items can be deleted');
  const [result] = await pool.query(
    `UPDATE queue_items SET status = 'DELETED', unique_reference_key = NULL, updated_at = UTC_TIMESTAMP(3) WHERE id = ? AND status = 'NEW'`,
    [item.id],
  );
  if (result.affectedRows !== 1) throw new AppError(409, 'INVALID_STATE', 'Queue item changed concurrently');
  const [rows] = await pool.query(`SELECT * FROM queue_items WHERE id = ?`, [item.id]);
  return rows[0];
}

/** Items a finished job left IN_PROGRESS are treated as application errors. */
export async function releaseItemsForJob(pool, jobId, message) {
  const [rows] = await pool.query(`SELECT id FROM queue_items WHERE locked_by_job_id = ? AND status = 'IN_PROGRESS'`, [jobId]);
  for (const row of rows) {
    await setItemResult(pool, row.id, { status: 'FAILED', errorType: 'application', errorMessage: message });
  }
  return rows.length;
}

export async function abandonStaleItems(pool, hours) {
  const [result] = await pool.query(
    `UPDATE queue_items SET status = 'ABANDONED', locked_by_job_id = NULL, locked_by_robot_id = NULL,
       finished_at = UTC_TIMESTAMP(3), error_message = 'Item stayed in progress past the abandon limit', updated_at = UTC_TIMESTAMP(3)
     WHERE status = 'IN_PROGRESS' AND started_at < DATE_SUB(UTC_TIMESTAMP(3), INTERVAL ? HOUR)`,
    [Math.max(Number(hours) || 24, 1)],
  );
  return result.affectedRows;
}

/** Queue trigger: start the configured workflow when NEW items wait and no trigger job is active. */
export async function runQueueTriggers(pool, cfg) {
  const [queues] = await pool.query(
    `SELECT q.* FROM work_queues q
     WHERE q.trigger_enabled = 1 AND q.trigger_workflow_id IS NOT NULL AND q.status = 'active'
       AND EXISTS (SELECT 1 FROM queue_items i WHERE i.queue_id = q.id AND i.status = 'NEW'
                   AND (i.defer_until IS NULL OR i.defer_until <= UTC_TIMESTAMP(3)))`,
  );
  const started = [];
  for (const queue of queues) {
    const [active] = await pool.query(
      `SELECT id FROM automation_jobs WHERE workflow_id = ? AND trigger_source = 'queue'
         AND status IN ('QUEUED', 'CLAIMED', 'RUNNING', 'RETRY_WAIT', 'CANCEL_REQUESTED', 'SUSPENDED') LIMIT 1`,
      [queue.trigger_workflow_id],
    );
    if (active.length) continue;
    const [workflows] = await pool.query(`SELECT * FROM workflows WHERE id = ?`, [queue.trigger_workflow_id]);
    const workflow = workflows[0];
    if (!workflow || workflow.status !== 'published') continue;
    const [versions] = await pool.query(`SELECT * FROM workflow_versions WHERE id = ?`, [workflow.current_version_id]);
    const [projects] = await pool.query(`SELECT * FROM projects WHERE id = ?`, [queue.project_id]);
    if (!versions[0] || projects[0]?.status !== 'active') continue;
    const job = await enqueueJob(pool, cfg, {
      project: projects[0], workflow, version: versions[0], user: null,
      input: { queueId: queue.id, queueName: queue.name }, triggerSource: 'queue',
    });
    await writeAudit(pool, {
      tenantId: queue.tenant_id, action: 'queue.trigger', entityType: 'work_queue', entityId: queue.id,
      projectId: queue.project_id, metadata: { jobId: job.id },
    });
    started.push({ queueId: queue.id, jobId: job.id });
  }
  return started;
}
