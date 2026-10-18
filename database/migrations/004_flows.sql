-- 004: Flows. A flow orchestrates a business process across robots (published URAP workflows),
-- people (Action Center tasks), and systems (REST API calls). The editable definition lives in
-- flows.draft_json and every publish snapshots it into flow_versions. A run executes one version
-- and keeps per-node state (flow_run_nodes) and a timeline (flow_run_events) in the database so
-- the engine can resume after a restart.

CREATE TABLE IF NOT EXISTS flows (
  id CHAR(36) NOT NULL,
  tenant_id CHAR(36) NOT NULL,
  project_id CHAR(36) NOT NULL,
  name VARCHAR(200) NOT NULL,
  description TEXT NULL,
  status VARCHAR(20) NOT NULL DEFAULT 'draft',
  draft_json JSON NOT NULL,
  current_version_id CHAR(36) NULL,
  trigger_type VARCHAR(20) NOT NULL DEFAULT 'manual',
  schedule_cron VARCHAR(120) NULL,
  schedule_timezone VARCHAR(64) NULL,
  next_run_at DATETIME(3) NULL,
  webhook_token_hash CHAR(64) NULL,
  created_by CHAR(36) NULL,
  created_at DATETIME(3) NOT NULL,
  updated_at DATETIME(3) NOT NULL,
  PRIMARY KEY (id),
  KEY idx_flows_project (project_id, updated_at),
  KEY idx_flows_schedule (status, trigger_type, next_run_at),
  CONSTRAINT fk_flows_tenant FOREIGN KEY (tenant_id) REFERENCES tenants (id),
  CONSTRAINT fk_flows_project FOREIGN KEY (project_id) REFERENCES projects (id),
  CONSTRAINT fk_flows_user FOREIGN KEY (created_by) REFERENCES users (id),
  CONSTRAINT chk_flows_status CHECK (status IN ('draft', 'published', 'disabled')),
  CONSTRAINT chk_flows_trigger CHECK (trigger_type IN ('manual', 'schedule', 'webhook'))
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS flow_versions (
  id CHAR(36) NOT NULL,
  flow_id CHAR(36) NOT NULL,
  version_number INT NOT NULL,
  definition_json JSON NOT NULL,
  published_by CHAR(36) NULL,
  published_at DATETIME(3) NOT NULL,
  PRIMARY KEY (id),
  UNIQUE KEY uq_flow_version (flow_id, version_number),
  CONSTRAINT fk_flow_versions_flow FOREIGN KEY (flow_id) REFERENCES flows (id),
  CONSTRAINT fk_flow_versions_user FOREIGN KEY (published_by) REFERENCES users (id)
) ENGINE=InnoDB;

ALTER TABLE flows ADD CONSTRAINT fk_flows_version FOREIGN KEY (current_version_id) REFERENCES flow_versions (id);

CREATE TABLE IF NOT EXISTS flow_runs (
  id CHAR(36) NOT NULL,
  tenant_id CHAR(36) NOT NULL,
  project_id CHAR(36) NOT NULL,
  flow_id CHAR(36) NOT NULL,
  flow_version_id CHAR(36) NOT NULL,
  status VARCHAR(20) NOT NULL,
  trigger_source VARCHAR(20) NOT NULL,
  input_json JSON NOT NULL,
  variables_json JSON NOT NULL,
  error_summary VARCHAR(1000) NULL,
  started_by CHAR(36) NULL,
  lock_until DATETIME(3) NULL,
  started_at DATETIME(3) NOT NULL,
  finished_at DATETIME(3) NULL,
  created_at DATETIME(3) NOT NULL,
  updated_at DATETIME(3) NOT NULL,
  PRIMARY KEY (id),
  KEY idx_flow_runs_flow (flow_id, created_at),
  KEY idx_flow_runs_status (status, updated_at),
  KEY idx_flow_runs_project (project_id, created_at),
  CONSTRAINT fk_flow_runs_tenant FOREIGN KEY (tenant_id) REFERENCES tenants (id),
  CONSTRAINT fk_flow_runs_project FOREIGN KEY (project_id) REFERENCES projects (id),
  CONSTRAINT fk_flow_runs_flow FOREIGN KEY (flow_id) REFERENCES flows (id),
  CONSTRAINT fk_flow_runs_version FOREIGN KEY (flow_version_id) REFERENCES flow_versions (id),
  CONSTRAINT fk_flow_runs_user FOREIGN KEY (started_by) REFERENCES users (id),
  CONSTRAINT chk_flow_runs_status CHECK (status IN ('RUNNING', 'SUCCEEDED', 'FAILED', 'CANCELLED')),
  CONSTRAINT chk_flow_runs_trigger CHECK (trigger_source IN ('manual', 'schedule', 'webhook', 'test'))
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS flow_run_nodes (
  id CHAR(36) NOT NULL,
  run_id CHAR(36) NOT NULL,
  node_id VARCHAR(80) NOT NULL,
  node_type VARCHAR(20) NOT NULL,
  status VARCHAR(20) NOT NULL,
  attempt INT NOT NULL DEFAULT 1,
  arrivals INT NOT NULL DEFAULT 0,
  job_id CHAR(36) NULL,
  task_id CHAR(36) NULL,
  wake_at DATETIME(3) NULL,
  input_json JSON NULL,
  output_json JSON NULL,
  error_message VARCHAR(1000) NULL,
  started_at DATETIME(3) NOT NULL,
  finished_at DATETIME(3) NULL,
  updated_at DATETIME(3) NOT NULL,
  PRIMARY KEY (id),
  KEY idx_flow_nodes_run (run_id, status),
  KEY idx_flow_nodes_job (job_id),
  KEY idx_flow_nodes_task (task_id),
  CONSTRAINT fk_flow_nodes_run FOREIGN KEY (run_id) REFERENCES flow_runs (id),
  CONSTRAINT fk_flow_nodes_job FOREIGN KEY (job_id) REFERENCES automation_jobs (id),
  CONSTRAINT fk_flow_nodes_task FOREIGN KEY (task_id) REFERENCES action_tasks (id),
  CONSTRAINT chk_flow_nodes_status CHECK (status IN ('READY', 'WAITING', 'SUCCEEDED', 'FAILED', 'CANCELLED'))
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS flow_run_events (
  id CHAR(36) NOT NULL,
  run_id CHAR(36) NOT NULL,
  seq BIGINT NOT NULL AUTO_INCREMENT,
  node_id VARCHAR(80) NULL,
  event VARCHAR(40) NOT NULL,
  message VARCHAR(1000) NOT NULL,
  data_json JSON NULL,
  created_at DATETIME(3) NOT NULL,
  PRIMARY KEY (id),
  UNIQUE KEY uq_flow_events_seq (seq),
  KEY idx_flow_events_run (run_id, seq),
  CONSTRAINT fk_flow_events_run FOREIGN KEY (run_id) REFERENCES flow_runs (id)
) ENGINE=InnoDB;

ALTER TABLE action_tasks ADD COLUMN flow_run_id CHAR(36) NULL;

ALTER TABLE action_tasks ADD KEY idx_tasks_flow_run (flow_run_id);

ALTER TABLE automation_jobs ADD COLUMN flow_run_id CHAR(36) NULL;

ALTER TABLE automation_jobs DROP CONSTRAINT chk_jobs_trigger;

ALTER TABLE automation_jobs
  ADD CONSTRAINT chk_jobs_trigger CHECK (trigger_source IN ('manual', 'schedule', 'api', 'retry', 'test', 'queue', 'flow'))
