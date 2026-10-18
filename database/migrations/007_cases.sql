-- 007: Case management. A case type is a versioned definition (fields, stages in order with
-- entry and exit conditions, tasks per stage, SLAs, escalation rules). The editable definition
-- lives in case_types.draft_json and every publish snapshots it into case_type_versions. A case
-- is one instance of a published version: its fields, current stage, status, owner, SLA timers,
-- the tasks it started (case_tasks), comments, attachments, and an activity history.

CREATE TABLE IF NOT EXISTS case_types (
  id CHAR(36) NOT NULL,
  tenant_id CHAR(36) NOT NULL,
  project_id CHAR(36) NOT NULL,
  name VARCHAR(200) NOT NULL,
  description TEXT NULL,
  prefix VARCHAR(8) NOT NULL,
  status VARCHAR(20) NOT NULL DEFAULT 'draft',
  draft_json JSON NOT NULL,
  current_version_id CHAR(36) NULL,
  next_number INT NOT NULL DEFAULT 0,
  webhook_token_hash CHAR(64) NULL,
  created_by CHAR(36) NULL,
  created_at DATETIME(3) NOT NULL,
  updated_at DATETIME(3) NOT NULL,
  PRIMARY KEY (id),
  KEY idx_case_types_project (project_id, updated_at),
  CONSTRAINT fk_case_types_tenant FOREIGN KEY (tenant_id) REFERENCES tenants (id),
  CONSTRAINT fk_case_types_project FOREIGN KEY (project_id) REFERENCES projects (id),
  CONSTRAINT fk_case_types_user FOREIGN KEY (created_by) REFERENCES users (id),
  CONSTRAINT chk_case_types_status CHECK (status IN ('draft', 'published', 'disabled'))
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS case_type_versions (
  id CHAR(36) NOT NULL,
  case_type_id CHAR(36) NOT NULL,
  version_number INT NOT NULL,
  definition_json JSON NOT NULL,
  published_by CHAR(36) NULL,
  published_at DATETIME(3) NOT NULL,
  PRIMARY KEY (id),
  UNIQUE KEY uq_case_type_versions (case_type_id, version_number),
  CONSTRAINT fk_case_type_versions_type FOREIGN KEY (case_type_id) REFERENCES case_types (id),
  CONSTRAINT fk_case_type_versions_user FOREIGN KEY (published_by) REFERENCES users (id)
) ENGINE=InnoDB;

ALTER TABLE case_types ADD CONSTRAINT fk_case_types_version FOREIGN KEY (current_version_id) REFERENCES case_type_versions (id);

CREATE TABLE IF NOT EXISTS cases (
  id CHAR(36) NOT NULL,
  tenant_id CHAR(36) NOT NULL,
  project_id CHAR(36) NOT NULL,
  case_type_id CHAR(36) NOT NULL,
  case_type_version_id CHAR(36) NOT NULL,
  case_number INT NOT NULL,
  reference VARCHAR(40) NOT NULL,
  title VARCHAR(300) NOT NULL,
  status VARCHAR(20) NOT NULL DEFAULT 'open',
  priority VARCHAR(10) NOT NULL DEFAULT 'medium',
  fields_json JSON NOT NULL,
  current_stage_id VARCHAR(80) NULL,
  stage_visit INT NOT NULL DEFAULT 0,
  stage_entered_at DATETIME(3) NULL,
  owner_user_id CHAR(36) NULL,
  assignee_user_id CHAR(36) NULL,
  due_at DATETIME(3) NULL,
  stage_due_at DATETIME(3) NULL,
  sla_state VARCHAR(20) NOT NULL DEFAULT 'none',
  stage_sla_state VARCHAR(20) NOT NULL DEFAULT 'none',
  hold_started_at DATETIME(3) NULL,
  hold_reason VARCHAR(500) NULL,
  escalations_json JSON NULL,
  source VARCHAR(20) NOT NULL DEFAULT 'manual',
  source_ref VARCHAR(80) NULL,
  created_by CHAR(36) NULL,
  lock_until DATETIME(3) NULL,
  resolved_at DATETIME(3) NULL,
  closed_at DATETIME(3) NULL,
  created_at DATETIME(3) NOT NULL,
  updated_at DATETIME(3) NOT NULL,
  PRIMARY KEY (id),
  UNIQUE KEY uq_cases_number (case_type_id, case_number),
  KEY idx_cases_project (project_id, status, updated_at),
  KEY idx_cases_type (case_type_id, status, current_stage_id),
  KEY idx_cases_owner (owner_user_id, status),
  KEY idx_cases_sla (status, sla_state),
  CONSTRAINT fk_cases_tenant FOREIGN KEY (tenant_id) REFERENCES tenants (id),
  CONSTRAINT fk_cases_project FOREIGN KEY (project_id) REFERENCES projects (id),
  CONSTRAINT fk_cases_type FOREIGN KEY (case_type_id) REFERENCES case_types (id),
  CONSTRAINT fk_cases_version FOREIGN KEY (case_type_version_id) REFERENCES case_type_versions (id),
  CONSTRAINT fk_cases_owner FOREIGN KEY (owner_user_id) REFERENCES users (id),
  CONSTRAINT fk_cases_assignee FOREIGN KEY (assignee_user_id) REFERENCES users (id),
  CONSTRAINT fk_cases_creator FOREIGN KEY (created_by) REFERENCES users (id),
  CONSTRAINT chk_cases_status CHECK (status IN ('open', 'on_hold', 'resolved', 'closed', 'cancelled')),
  CONSTRAINT chk_cases_priority CHECK (priority IN ('low', 'medium', 'high', 'critical')),
  CONSTRAINT chk_cases_sla CHECK (sla_state IN ('none', 'on_track', 'at_risk', 'breached', 'met')),
  CONSTRAINT chk_cases_stage_sla CHECK (stage_sla_state IN ('none', 'on_track', 'at_risk', 'breached', 'met')),
  CONSTRAINT chk_cases_source CHECK (source IN ('manual', 'api', 'webhook', 'flow', 'app', 'agent'))
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS case_tasks (
  id CHAR(36) NOT NULL,
  case_id CHAR(36) NOT NULL,
  stage_id VARCHAR(80) NOT NULL,
  task_key VARCHAR(80) NOT NULL,
  name VARCHAR(200) NOT NULL,
  kind VARCHAR(20) NOT NULL,
  required TINYINT(1) NOT NULL DEFAULT 1,
  status VARCHAR(20) NOT NULL,
  attempt INT NOT NULL DEFAULT 1,
  visit INT NOT NULL DEFAULT 1,
  job_id CHAR(36) NULL,
  action_task_id CHAR(36) NULL,
  flow_run_id CHAR(36) NULL,
  agent_run_id CHAR(36) NULL,
  outcome VARCHAR(40) NULL,
  output_json JSON NULL,
  error_message VARCHAR(1000) NULL,
  completed_by CHAR(36) NULL,
  started_at DATETIME(3) NULL,
  completed_at DATETIME(3) NULL,
  created_at DATETIME(3) NOT NULL,
  updated_at DATETIME(3) NOT NULL,
  PRIMARY KEY (id),
  KEY idx_case_tasks_case (case_id, stage_id, status),
  KEY idx_case_tasks_status (status),
  CONSTRAINT fk_case_tasks_case FOREIGN KEY (case_id) REFERENCES cases (id),
  CONSTRAINT fk_case_tasks_job FOREIGN KEY (job_id) REFERENCES automation_jobs (id),
  CONSTRAINT fk_case_tasks_task FOREIGN KEY (action_task_id) REFERENCES action_tasks (id),
  CONSTRAINT fk_case_tasks_flow_run FOREIGN KEY (flow_run_id) REFERENCES flow_runs (id),
  CONSTRAINT fk_case_tasks_agent_run FOREIGN KEY (agent_run_id) REFERENCES agent_runs (id),
  CONSTRAINT fk_case_tasks_user FOREIGN KEY (completed_by) REFERENCES users (id),
  CONSTRAINT chk_case_tasks_kind CHECK (kind IN ('human', 'workflow', 'flow', 'agent')),
  CONSTRAINT chk_case_tasks_status CHECK (status IN ('not_started', 'in_progress', 'completed', 'failed', 'skipped', 'cancelled'))
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS case_events (
  id CHAR(36) NOT NULL,
  case_id CHAR(36) NOT NULL,
  seq BIGINT NOT NULL AUTO_INCREMENT,
  event VARCHAR(40) NOT NULL,
  message VARCHAR(1000) NOT NULL,
  actor_user_id CHAR(36) NULL,
  data_json JSON NULL,
  created_at DATETIME(3) NOT NULL,
  PRIMARY KEY (id),
  UNIQUE KEY uq_case_events_seq (seq),
  KEY idx_case_events_case (case_id, seq),
  CONSTRAINT fk_case_events_case FOREIGN KEY (case_id) REFERENCES cases (id),
  CONSTRAINT fk_case_events_user FOREIGN KEY (actor_user_id) REFERENCES users (id)
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS case_comments (
  id CHAR(36) NOT NULL,
  case_id CHAR(36) NOT NULL,
  user_id CHAR(36) NULL,
  body TEXT NOT NULL,
  created_at DATETIME(3) NOT NULL,
  PRIMARY KEY (id),
  KEY idx_case_comments_case (case_id, created_at),
  CONSTRAINT fk_case_comments_case FOREIGN KEY (case_id) REFERENCES cases (id),
  CONSTRAINT fk_case_comments_user FOREIGN KEY (user_id) REFERENCES users (id)
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS case_attachments (
  id CHAR(36) NOT NULL,
  case_id CHAR(36) NOT NULL,
  artifact_id CHAR(36) NOT NULL,
  user_id CHAR(36) NULL,
  created_at DATETIME(3) NOT NULL,
  PRIMARY KEY (id),
  KEY idx_case_attachments_case (case_id, created_at),
  CONSTRAINT fk_case_attachments_case FOREIGN KEY (case_id) REFERENCES cases (id),
  CONSTRAINT fk_case_attachments_artifact FOREIGN KEY (artifact_id) REFERENCES artifacts (id),
  CONSTRAINT fk_case_attachments_user FOREIGN KEY (user_id) REFERENCES users (id)
) ENGINE=InnoDB;

ALTER TABLE automation_jobs ADD COLUMN case_id CHAR(36) NULL;
ALTER TABLE automation_jobs ADD KEY idx_jobs_case (case_id);
ALTER TABLE flow_runs ADD COLUMN case_id CHAR(36) NULL;
ALTER TABLE agent_runs ADD COLUMN case_id CHAR(36) NULL;
ALTER TABLE action_tasks ADD COLUMN case_id CHAR(36) NULL;
ALTER TABLE action_tasks ADD KEY idx_tasks_case (case_id);

ALTER TABLE automation_jobs DROP CONSTRAINT chk_jobs_trigger;

ALTER TABLE automation_jobs
  ADD CONSTRAINT chk_jobs_trigger CHECK (trigger_source IN ('manual', 'schedule', 'api', 'retry', 'test', 'queue', 'flow', 'agent', 'app', 'case'));

ALTER TABLE flow_runs DROP CONSTRAINT chk_flow_runs_trigger;

ALTER TABLE flow_runs
  ADD CONSTRAINT chk_flow_runs_trigger CHECK (trigger_source IN ('manual', 'schedule', 'webhook', 'test', 'app', 'case'));

ALTER TABLE agent_runs DROP CONSTRAINT chk_agent_runs_source;

ALTER TABLE agent_runs
  ADD CONSTRAINT chk_agent_runs_source CHECK (source IN ('chat', 'api', 'flow', 'test', 'app', 'case'))
