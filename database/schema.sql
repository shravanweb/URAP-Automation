-- Universal RPA Automation Platform
-- MySQL 8 / MariaDB 10.6+ schema. All timestamps are UTC.

SET NAMES utf8mb4;
SET time_zone = '+00:00';

CREATE TABLE IF NOT EXISTS schema_migrations (
  id VARCHAR(64) NOT NULL,
  applied_at DATETIME(3) NOT NULL,
  PRIMARY KEY (id)
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS tenants (
  id CHAR(36) NOT NULL,
  name VARCHAR(200) NOT NULL,
  slug VARCHAR(80) NOT NULL,
  isolation_enabled TINYINT(1) NOT NULL DEFAULT 1,
  created_at DATETIME(3) NOT NULL,
  updated_at DATETIME(3) NOT NULL,
  PRIMARY KEY (id),
  UNIQUE KEY uq_tenants_slug (slug)
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS users (
  id CHAR(36) NOT NULL,
  tenant_id CHAR(36) NOT NULL,
  email VARCHAR(320) NOT NULL,
  display_name VARCHAR(200) NOT NULL,
  password_hash VARCHAR(255) NOT NULL,
  role VARCHAR(40) NOT NULL,
  status VARCHAR(20) NOT NULL DEFAULT 'active',
  created_at DATETIME(3) NOT NULL,
  updated_at DATETIME(3) NOT NULL,
  PRIMARY KEY (id),
  UNIQUE KEY uq_users_tenant_email (tenant_id, email),
  KEY idx_users_tenant_role (tenant_id, role),
  CONSTRAINT fk_users_tenant FOREIGN KEY (tenant_id) REFERENCES tenants (id),
  CONSTRAINT chk_users_role CHECK (role IN ('administrator', 'project_manager', 'automation_developer', 'operator', 'viewer')),
  CONSTRAINT chk_users_status CHECK (status IN ('active', 'disabled'))
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS refresh_tokens (
  id CHAR(36) NOT NULL,
  user_id CHAR(36) NOT NULL,
  token_hash CHAR(64) NOT NULL,
  expires_at DATETIME(3) NOT NULL,
  revoked_at DATETIME(3) NULL,
  created_at DATETIME(3) NOT NULL,
  PRIMARY KEY (id),
  UNIQUE KEY uq_refresh_token_hash (token_hash),
  KEY idx_refresh_user (user_id),
  CONSTRAINT fk_refresh_user FOREIGN KEY (user_id) REFERENCES users (id)
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS use_case_categories (
  code VARCHAR(80) NOT NULL,
  label VARCHAR(120) NOT NULL,
  description VARCHAR(400) NOT NULL,
  PRIMARY KEY (code)
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS projects (
  id CHAR(36) NOT NULL,
  tenant_id CHAR(36) NOT NULL,
  name VARCHAR(200) NOT NULL,
  description TEXT NULL,
  category VARCHAR(80) NOT NULL,
  status VARCHAR(20) NOT NULL DEFAULT 'active',
  settings_json JSON NOT NULL,
  created_by CHAR(36) NOT NULL,
  created_at DATETIME(3) NOT NULL,
  updated_at DATETIME(3) NOT NULL,
  archived_at DATETIME(3) NULL,
  PRIMARY KEY (id),
  KEY idx_projects_tenant_status (tenant_id, status),
  KEY idx_projects_tenant_name (tenant_id, name),
  KEY idx_projects_category (tenant_id, category),
  CONSTRAINT fk_projects_tenant FOREIGN KEY (tenant_id) REFERENCES tenants (id),
  CONSTRAINT fk_projects_created_by FOREIGN KEY (created_by) REFERENCES users (id),
  CONSTRAINT chk_projects_status CHECK (status IN ('active', 'archived'))
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS project_members (
  id CHAR(36) NOT NULL,
  project_id CHAR(36) NOT NULL,
  user_id CHAR(36) NOT NULL,
  role VARCHAR(40) NOT NULL,
  created_at DATETIME(3) NOT NULL,
  PRIMARY KEY (id),
  UNIQUE KEY uq_project_member (project_id, user_id),
  KEY idx_project_members_user (user_id),
  CONSTRAINT fk_members_project FOREIGN KEY (project_id) REFERENCES projects (id),
  CONSTRAINT fk_members_user FOREIGN KEY (user_id) REFERENCES users (id),
  CONSTRAINT chk_members_role CHECK (role IN ('administrator', 'project_manager', 'automation_developer', 'operator', 'viewer'))
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS connectors (
  id VARCHAR(64) NOT NULL,
  display_name VARCHAR(120) NOT NULL,
  description VARCHAR(500) NOT NULL,
  config_schema_json JSON NOT NULL,
  permissions_json JSON NOT NULL,
  input_format VARCHAR(80) NOT NULL,
  output_format VARCHAR(80) NOT NULL,
  timeout_ms INT NOT NULL DEFAULT 30000,
  availability VARCHAR(32) NOT NULL,
  PRIMARY KEY (id),
  CONSTRAINT chk_connectors_availability CHECK (availability IN ('available', 'requires_robot', 'disabled'))
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS connections (
  id CHAR(36) NOT NULL,
  tenant_id CHAR(36) NOT NULL,
  project_id CHAR(36) NOT NULL,
  connector_type VARCHAR(64) NOT NULL,
  name VARCHAR(200) NOT NULL,
  config_json JSON NOT NULL,
  secret_ciphertext VARBINARY(4096) NULL,
  secret_iv VARBINARY(16) NULL,
  secret_tag VARBINARY(16) NULL,
  status VARCHAR(20) NOT NULL DEFAULT 'untested',
  last_tested_at DATETIME(3) NULL,
  last_error VARCHAR(500) NULL,
  created_by CHAR(36) NOT NULL,
  created_at DATETIME(3) NOT NULL,
  updated_at DATETIME(3) NOT NULL,
  PRIMARY KEY (id),
  KEY idx_connections_project (project_id, connector_type),
  CONSTRAINT fk_connections_tenant FOREIGN KEY (tenant_id) REFERENCES tenants (id),
  CONSTRAINT fk_connections_project FOREIGN KEY (project_id) REFERENCES projects (id),
  CONSTRAINT fk_connections_connector FOREIGN KEY (connector_type) REFERENCES connectors (id),
  CONSTRAINT fk_connections_user FOREIGN KEY (created_by) REFERENCES users (id),
  CONSTRAINT chk_connections_status CHECK (status IN ('untested', 'available', 'unavailable'))
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS workflows (
  id CHAR(36) NOT NULL,
  tenant_id CHAR(36) NOT NULL,
  project_id CHAR(36) NOT NULL,
  name VARCHAR(200) NOT NULL,
  description TEXT NULL,
  execution_type VARCHAR(20) NOT NULL,
  status VARCHAR(20) NOT NULL DEFAULT 'draft',
  current_version_id CHAR(36) NULL,
  created_by CHAR(36) NOT NULL,
  created_at DATETIME(3) NOT NULL,
  updated_at DATETIME(3) NOT NULL,
  PRIMARY KEY (id),
  KEY idx_workflows_project_status (project_id, status),
  KEY idx_workflows_tenant (tenant_id, name),
  CONSTRAINT fk_workflows_tenant FOREIGN KEY (tenant_id) REFERENCES tenants (id),
  CONSTRAINT fk_workflows_project FOREIGN KEY (project_id) REFERENCES projects (id),
  CONSTRAINT fk_workflows_user FOREIGN KEY (created_by) REFERENCES users (id),
  CONSTRAINT chk_workflows_exec CHECK (execution_type IN ('native', 'uipath', 'hybrid')),
  CONSTRAINT chk_workflows_status CHECK (status IN ('draft', 'published', 'disabled', 'archived'))
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS workflow_versions (
  id CHAR(36) NOT NULL,
  workflow_id CHAR(36) NOT NULL,
  version_number INT NOT NULL,
  status VARCHAR(20) NOT NULL,
  definition_json JSON NOT NULL,
  validation_json JSON NULL,
  published_at DATETIME(3) NULL,
  created_by CHAR(36) NOT NULL,
  created_at DATETIME(3) NOT NULL,
  PRIMARY KEY (id),
  UNIQUE KEY uq_workflow_version (workflow_id, version_number),
  KEY idx_workflow_versions_status (workflow_id, status),
  CONSTRAINT fk_versions_workflow FOREIGN KEY (workflow_id) REFERENCES workflows (id),
  CONSTRAINT fk_versions_user FOREIGN KEY (created_by) REFERENCES users (id),
  CONSTRAINT chk_versions_status CHECK (status IN ('draft', 'published', 'retired'))
) ENGINE=InnoDB;

ALTER TABLE workflows
  ADD CONSTRAINT fk_workflows_current_version FOREIGN KEY (current_version_id) REFERENCES workflow_versions (id);

CREATE TABLE IF NOT EXISTS workflow_steps (
  id CHAR(36) NOT NULL,
  workflow_version_id CHAR(36) NOT NULL,
  step_key VARCHAR(80) NOT NULL,
  step_type VARCHAR(64) NOT NULL,
  name VARCHAR(200) NOT NULL,
  position INT NOT NULL,
  config_json JSON NOT NULL,
  timeout_ms INT NULL,
  error_policy VARCHAR(32) NOT NULL,
  PRIMARY KEY (id),
  UNIQUE KEY uq_step_key (workflow_version_id, step_key),
  KEY idx_steps_version_position (workflow_version_id, position),
  CONSTRAINT fk_steps_version FOREIGN KEY (workflow_version_id) REFERENCES workflow_versions (id)
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS schedules (
  id CHAR(36) NOT NULL,
  tenant_id CHAR(36) NOT NULL,
  project_id CHAR(36) NOT NULL,
  workflow_id CHAR(36) NOT NULL,
  name VARCHAR(200) NOT NULL,
  schedule_type VARCHAR(20) NOT NULL,
  cron_expression VARCHAR(120) NULL,
  run_at DATETIME(3) NULL,
  timezone VARCHAR(64) NOT NULL DEFAULT 'UTC',
  enabled TINYINT(1) NOT NULL DEFAULT 1,
  overlap_policy VARCHAR(20) NOT NULL DEFAULT 'skip',
  input_json JSON NOT NULL,
  next_run_at DATETIME(3) NULL,
  last_run_at DATETIME(3) NULL,
  lock_until DATETIME(3) NULL,
  created_by CHAR(36) NOT NULL,
  created_at DATETIME(3) NOT NULL,
  updated_at DATETIME(3) NOT NULL,
  PRIMARY KEY (id),
  KEY idx_schedules_due (enabled, next_run_at),
  KEY idx_schedules_project (project_id),
  CONSTRAINT fk_schedules_tenant FOREIGN KEY (tenant_id) REFERENCES tenants (id),
  CONSTRAINT fk_schedules_project FOREIGN KEY (project_id) REFERENCES projects (id),
  CONSTRAINT fk_schedules_workflow FOREIGN KEY (workflow_id) REFERENCES workflows (id),
  CONSTRAINT fk_schedules_user FOREIGN KEY (created_by) REFERENCES users (id),
  CONSTRAINT chk_schedules_type CHECK (schedule_type IN ('manual', 'once', 'recurring')),
  CONSTRAINT chk_schedules_overlap CHECK (overlap_policy IN ('skip', 'queue'))
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS automation_robots (
  id CHAR(36) NOT NULL,
  tenant_id CHAR(36) NOT NULL,
  name VARCHAR(200) NOT NULL,
  adapter VARCHAR(40) NOT NULL,
  status VARCHAR(20) NOT NULL DEFAULT 'unknown',
  config_json JSON NOT NULL,
  token_hash CHAR(64) NULL,
  last_heartbeat_at DATETIME(3) NULL,
  last_error VARCHAR(500) NULL,
  created_at DATETIME(3) NOT NULL,
  updated_at DATETIME(3) NOT NULL,
  PRIMARY KEY (id),
  KEY idx_robots_tenant (tenant_id, status),
  CONSTRAINT fk_robots_tenant FOREIGN KEY (tenant_id) REFERENCES tenants (id),
  CONSTRAINT chk_robots_adapter CHECK (adapter IN ('local_file_handoff', 'orchestrator', 'contract_simulator')),
  CONSTRAINT chk_robots_status CHECK (status IN ('unknown', 'available', 'unavailable', 'busy'))
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS robot_project_access (
  robot_id CHAR(36) NOT NULL,
  project_id CHAR(36) NOT NULL,
  created_at DATETIME(3) NOT NULL,
  PRIMARY KEY (robot_id, project_id),
  CONSTRAINT fk_robot_access_robot FOREIGN KEY (robot_id) REFERENCES automation_robots (id),
  CONSTRAINT fk_robot_access_project FOREIGN KEY (project_id) REFERENCES projects (id)
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS automation_jobs (
  id CHAR(36) NOT NULL,
  tenant_id CHAR(36) NOT NULL,
  project_id CHAR(36) NOT NULL,
  workflow_id CHAR(36) NOT NULL,
  workflow_version_id CHAR(36) NOT NULL,
  schedule_id CHAR(36) NULL,
  robot_id CHAR(36) NULL,
  trigger_source VARCHAR(20) NOT NULL,
  execution_target VARCHAR(20) NOT NULL,
  status VARCHAR(32) NOT NULL,
  priority INT NOT NULL DEFAULT 0,
  input_json JSON NOT NULL,
  correlation_id CHAR(36) NOT NULL,
  idempotency_key VARCHAR(80) NULL,
  retry_of_attempt INT NULL,
  current_attempt INT NOT NULL DEFAULT 0,
  max_attempts INT NOT NULL DEFAULT 1,
  queued_at DATETIME(3) NOT NULL,
  claimed_at DATETIME(3) NULL,
  started_at DATETIME(3) NULL,
  finished_at DATETIME(3) NULL,
  available_at DATETIME(3) NOT NULL,
  error_summary VARCHAR(1000) NULL,
  created_by CHAR(36) NULL,
  created_at DATETIME(3) NOT NULL,
  updated_at DATETIME(3) NOT NULL,
  PRIMARY KEY (id),
  UNIQUE KEY uq_jobs_idempotency (tenant_id, idempotency_key),
  KEY idx_jobs_queue (execution_target, status, available_at, priority, queued_at),
  KEY idx_jobs_project_created (project_id, created_at),
  KEY idx_jobs_workflow (workflow_id),
  KEY idx_jobs_schedule (schedule_id, status),
  KEY idx_jobs_correlation (correlation_id),
  CONSTRAINT fk_jobs_tenant FOREIGN KEY (tenant_id) REFERENCES tenants (id),
  CONSTRAINT fk_jobs_project FOREIGN KEY (project_id) REFERENCES projects (id),
  CONSTRAINT fk_jobs_workflow FOREIGN KEY (workflow_id) REFERENCES workflows (id),
  CONSTRAINT fk_jobs_version FOREIGN KEY (workflow_version_id) REFERENCES workflow_versions (id),
  CONSTRAINT fk_jobs_schedule FOREIGN KEY (schedule_id) REFERENCES schedules (id),
  CONSTRAINT fk_jobs_robot FOREIGN KEY (robot_id) REFERENCES automation_robots (id),
  CONSTRAINT fk_jobs_user FOREIGN KEY (created_by) REFERENCES users (id),
  CONSTRAINT chk_jobs_status CHECK (status IN (
    'DRAFT', 'QUEUED', 'CLAIMED', 'RUNNING', 'SUCCEEDED', 'FAILED',
    'RETRY_WAIT', 'CANCEL_REQUESTED', 'CANCELLED', 'SKIPPED'
  )),
  CONSTRAINT chk_jobs_trigger CHECK (trigger_source IN ('manual', 'schedule', 'api', 'retry', 'test')),
  CONSTRAINT chk_jobs_target CHECK (execution_target IN ('native', 'robot'))
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS job_attempts (
  id CHAR(36) NOT NULL,
  job_id CHAR(36) NOT NULL,
  attempt_number INT NOT NULL,
  status VARCHAR(32) NOT NULL,
  started_at DATETIME(3) NULL,
  finished_at DATETIME(3) NULL,
  error_code VARCHAR(80) NULL,
  error_message VARCHAR(1000) NULL,
  retryable TINYINT(1) NOT NULL DEFAULT 0,
  output_json JSON NULL,
  worker_id VARCHAR(80) NULL,
  created_at DATETIME(3) NOT NULL,
  PRIMARY KEY (id),
  UNIQUE KEY uq_job_attempt (job_id, attempt_number),
  KEY idx_attempts_status (status, finished_at),
  CONSTRAINT fk_attempts_job FOREIGN KEY (job_id) REFERENCES automation_jobs (id)
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS job_step_runs (
  id CHAR(36) NOT NULL,
  attempt_id CHAR(36) NOT NULL,
  step_key VARCHAR(80) NOT NULL,
  step_type VARCHAR(64) NOT NULL,
  status VARCHAR(32) NOT NULL,
  started_at DATETIME(3) NULL,
  finished_at DATETIME(3) NULL,
  duration_ms INT NULL,
  input_json JSON NULL,
  output_json JSON NULL,
  error_message VARCHAR(1000) NULL,
  iteration_index INT NULL,
  PRIMARY KEY (id),
  KEY idx_step_runs_attempt (attempt_id, started_at),
  CONSTRAINT fk_step_runs_attempt FOREIGN KEY (attempt_id) REFERENCES job_attempts (id)
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS schedule_runs (
  id CHAR(36) NOT NULL,
  schedule_id CHAR(36) NOT NULL,
  job_id CHAR(36) NULL,
  status VARCHAR(20) NOT NULL,
  reason VARCHAR(500) NULL,
  triggered_at DATETIME(3) NOT NULL,
  PRIMARY KEY (id),
  KEY idx_schedule_runs_schedule (schedule_id, triggered_at),
  CONSTRAINT fk_schedule_runs_schedule FOREIGN KEY (schedule_id) REFERENCES schedules (id),
  CONSTRAINT fk_schedule_runs_job FOREIGN KEY (job_id) REFERENCES automation_jobs (id),
  CONSTRAINT chk_schedule_runs_status CHECK (status IN ('TRIGGERED', 'SKIPPED', 'FAILED'))
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS artifacts (
  id CHAR(36) NOT NULL,
  tenant_id CHAR(36) NOT NULL,
  project_id CHAR(36) NOT NULL,
  job_id CHAR(36) NULL,
  attempt_id CHAR(36) NULL,
  file_name VARCHAR(255) NOT NULL,
  storage_path VARCHAR(500) NOT NULL,
  mime_type VARCHAR(120) NOT NULL,
  size_bytes BIGINT NOT NULL,
  checksum_sha256 CHAR(64) NOT NULL,
  created_by CHAR(36) NULL,
  created_at DATETIME(3) NOT NULL,
  PRIMARY KEY (id),
  KEY idx_artifacts_project (project_id, created_at),
  KEY idx_artifacts_job (job_id),
  CONSTRAINT fk_artifacts_tenant FOREIGN KEY (tenant_id) REFERENCES tenants (id),
  CONSTRAINT fk_artifacts_project FOREIGN KEY (project_id) REFERENCES projects (id),
  CONSTRAINT fk_artifacts_job FOREIGN KEY (job_id) REFERENCES automation_jobs (id),
  CONSTRAINT fk_artifacts_attempt FOREIGN KEY (attempt_id) REFERENCES job_attempts (id),
  CONSTRAINT fk_artifacts_user FOREIGN KEY (created_by) REFERENCES users (id)
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS notifications (
  id CHAR(36) NOT NULL,
  tenant_id CHAR(36) NOT NULL,
  project_id CHAR(36) NOT NULL,
  job_id CHAR(36) NULL,
  channel VARCHAR(32) NOT NULL,
  subject VARCHAR(300) NOT NULL,
  body TEXT NOT NULL,
  created_at DATETIME(3) NOT NULL,
  PRIMARY KEY (id),
  KEY idx_notifications_project (project_id, created_at),
  CONSTRAINT fk_notifications_tenant FOREIGN KEY (tenant_id) REFERENCES tenants (id),
  CONSTRAINT fk_notifications_project FOREIGN KEY (project_id) REFERENCES projects (id),
  CONSTRAINT fk_notifications_job FOREIGN KEY (job_id) REFERENCES automation_jobs (id)
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS audit_logs (
  id CHAR(36) NOT NULL,
  tenant_id CHAR(36) NOT NULL,
  actor_user_id CHAR(36) NULL,
  actor_robot_id CHAR(36) NULL,
  action VARCHAR(80) NOT NULL,
  entity_type VARCHAR(80) NOT NULL,
  entity_id CHAR(36) NULL,
  project_id CHAR(36) NULL,
  metadata_json JSON NULL,
  ip_address VARCHAR(64) NULL,
  created_at DATETIME(3) NOT NULL,
  PRIMARY KEY (id),
  KEY idx_audit_tenant_created (tenant_id, created_at),
  KEY idx_audit_project (project_id, created_at),
  KEY idx_audit_entity (entity_type, entity_id),
  CONSTRAINT fk_audit_tenant FOREIGN KEY (tenant_id) REFERENCES tenants (id),
  CONSTRAINT fk_audit_user FOREIGN KEY (actor_user_id) REFERENCES users (id),
  CONSTRAINT fk_audit_robot FOREIGN KEY (actor_robot_id) REFERENCES automation_robots (id),
  CONSTRAINT fk_audit_project FOREIGN KEY (project_id) REFERENCES projects (id)
) ENGINE=InnoDB;
