import crypto from 'node:crypto';
import { redact } from '../lib/redact.js';
import { currentRequest } from '../lib/requestContext.js';

export async function writeAudit(pool, entry) {
  const ctx = currentRequest();
  await pool.query(
    `INSERT INTO audit_logs (
      id, tenant_id, actor_user_id, actor_robot_id, action, entity_type, entity_id,
      project_id, metadata_json, ip_address, user_agent, request_id, result, created_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, UTC_TIMESTAMP(3))`,
    [
      crypto.randomUUID(),
      entry.tenantId,
      entry.userId || null,
      entry.robotId || null,
      entry.action,
      entry.entityType,
      entry.entityId || null,
      entry.projectId || null,
      JSON.stringify(redact(entry.metadata || {})),
      entry.ip || ctx?.ip || null,
      (entry.userAgent || ctx?.userAgent || null)?.slice(0, 255) || null,
      entry.requestId || ctx?.requestId || null,
      entry.result || 'success',
    ],
  );
}
