-- 009: richer audit rows. All columns are nullable so existing rows stay valid (shown as "—").
-- user_agent and request_id are captured from the HTTP request that caused the event; result is
-- 'success' or 'failure' (e.g. a rejected sign-in). Secrets are never stored: metadata is redacted
-- before insert and request bodies are not copied.
ALTER TABLE audit_logs ADD COLUMN IF NOT EXISTS user_agent VARCHAR(255) NULL;
ALTER TABLE audit_logs ADD COLUMN IF NOT EXISTS request_id VARCHAR(64) NULL;
ALTER TABLE audit_logs ADD COLUMN IF NOT EXISTS result VARCHAR(16) NULL;
CREATE INDEX IF NOT EXISTS idx_audit_tenant_action ON audit_logs (tenant_id, action, created_at);
CREATE INDEX IF NOT EXISTS idx_audit_actor ON audit_logs (actor_user_id, created_at);
