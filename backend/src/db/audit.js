import crypto from 'node:crypto';
import { redact } from '../lib/redact.js';

export async function writeAudit(pool, entry) {
  await pool.query(
    `INSERT INTO audit_logs (
      id, tenant_id, actor_user_id, actor_robot_id, action, entity_type, entity_id,
      project_id, metadata_json, ip_address, created_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, UTC_TIMESTAMP(3))`,
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
      entry.ip || null,
    ],
  );
}
