-- 010: platform Super Admin and workspace suspension. Additive only: new columns have safe
-- defaults (existing users are not super admins, existing workspaces are active) and one new table.
-- The only data change marks the installation owner's account as the first super admin.
ALTER TABLE users ADD COLUMN IF NOT EXISTS is_super_admin TINYINT(1) NOT NULL DEFAULT 0;
ALTER TABLE users ADD COLUMN IF NOT EXISTS last_login_at DATETIME(3) NULL;
ALTER TABLE tenants ADD COLUMN IF NOT EXISTS status VARCHAR(20) NOT NULL DEFAULT 'active';
ALTER TABLE tenants ADD COLUMN IF NOT EXISTS suspended_at DATETIME(3) NULL;
ALTER TABLE tenants ADD COLUMN IF NOT EXISTS suspended_reason VARCHAR(500) NULL;
CREATE TABLE IF NOT EXISTS platform_audit_logs (
  id CHAR(36) NOT NULL,
  actor_user_id CHAR(36) NULL,
  actor_email VARCHAR(320) NULL,
  action VARCHAR(80) NOT NULL,
  target_type VARCHAR(40) NOT NULL,
  target_id CHAR(36) NULL,
  target_label VARCHAR(320) NULL,
  tenant_id CHAR(36) NULL,
  metadata_json JSON NULL,
  ip VARCHAR(64) NULL,
  created_at DATETIME(3) NOT NULL,
  PRIMARY KEY (id),
  KEY idx_platform_audit_created (created_at),
  KEY idx_platform_audit_tenant (tenant_id, created_at)
) ENGINE=InnoDB;
UPDATE users SET is_super_admin = 1 WHERE email = 'shravan@nityainc.com';
