-- 002: Orchestrator-style work queues, queue items, and queue triggers.
-- Applied once by backend/src/db/migrate.js on new and existing databases.

CREATE TABLE IF NOT EXISTS work_queues (
  id CHAR(36) NOT NULL,
  tenant_id CHAR(36) NOT NULL,
  project_id CHAR(36) NOT NULL,
  name VARCHAR(120) NOT NULL,
  description VARCHAR(1000) NULL,
  max_retries INT NOT NULL DEFAULT 0,
  unique_reference TINYINT(1) NOT NULL DEFAULT 0,
  trigger_workflow_id CHAR(36) NULL,
  trigger_enabled TINYINT(1) NOT NULL DEFAULT 0,
  status VARCHAR(20) NOT NULL DEFAULT 'active',
  created_by CHAR(36) NOT NULL,
  created_at DATETIME(3) NOT NULL,
  updated_at DATETIME(3) NOT NULL,
  PRIMARY KEY (id),
  UNIQUE KEY uq_work_queue_name (project_id, name),
  KEY idx_work_queues_tenant (tenant_id),
  CONSTRAINT fk_work_queues_tenant FOREIGN KEY (tenant_id) REFERENCES tenants (id),
  CONSTRAINT fk_work_queues_project FOREIGN KEY (project_id) REFERENCES projects (id),
  CONSTRAINT fk_work_queues_workflow FOREIGN KEY (trigger_workflow_id) REFERENCES workflows (id),
  CONSTRAINT fk_work_queues_user FOREIGN KEY (created_by) REFERENCES users (id),
  CONSTRAINT chk_work_queues_retries CHECK (max_retries BETWEEN 0 AND 10),
  CONSTRAINT chk_work_queues_status CHECK (status IN ('active', 'archived'))
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS queue_items (
  id CHAR(36) NOT NULL,
  queue_id CHAR(36) NOT NULL,
  tenant_id CHAR(36) NOT NULL,
  project_id CHAR(36) NOT NULL,
  reference VARCHAR(200) NULL,
  unique_reference_key VARCHAR(200) NULL,
  priority INT NOT NULL DEFAULT 1,
  status VARCHAR(20) NOT NULL DEFAULT 'NEW',
  retry_count INT NOT NULL DEFAULT 0,
  specific_content_json JSON NOT NULL,
  output_json JSON NULL,
  error_type VARCHAR(20) NULL,
  error_message VARCHAR(1000) NULL,
  defer_until DATETIME(3) NULL,
  due_at DATETIME(3) NULL,
  locked_by_job_id CHAR(36) NULL,
  locked_by_robot_id CHAR(36) NULL,
  started_at DATETIME(3) NULL,
  finished_at DATETIME(3) NULL,
  created_by CHAR(36) NULL,
  created_at DATETIME(3) NOT NULL,
  updated_at DATETIME(3) NOT NULL,
  PRIMARY KEY (id),
  UNIQUE KEY uq_queue_items_reference (queue_id, unique_reference_key),
  KEY idx_queue_items_next (queue_id, status, priority, created_at),
  KEY idx_queue_items_project (project_id, status),
  KEY idx_queue_items_job (locked_by_job_id),
  CONSTRAINT fk_queue_items_queue FOREIGN KEY (queue_id) REFERENCES work_queues (id),
  CONSTRAINT fk_queue_items_tenant FOREIGN KEY (tenant_id) REFERENCES tenants (id),
  CONSTRAINT fk_queue_items_project FOREIGN KEY (project_id) REFERENCES projects (id),
  CONSTRAINT fk_queue_items_job FOREIGN KEY (locked_by_job_id) REFERENCES automation_jobs (id),
  CONSTRAINT fk_queue_items_robot FOREIGN KEY (locked_by_robot_id) REFERENCES automation_robots (id),
  CONSTRAINT chk_queue_items_status CHECK (status IN ('NEW', 'IN_PROGRESS', 'SUCCESSFUL', 'FAILED', 'ABANDONED', 'DELETED')),
  CONSTRAINT chk_queue_items_priority CHECK (priority BETWEEN 0 AND 2),
  CONSTRAINT chk_queue_items_error_type CHECK (error_type IS NULL OR error_type IN ('business', 'application'))
) ENGINE=InnoDB;

ALTER TABLE automation_jobs DROP CONSTRAINT chk_jobs_trigger;

ALTER TABLE automation_jobs
  ADD CONSTRAINT chk_jobs_trigger CHECK (trigger_source IN ('manual', 'schedule', 'api', 'retry', 'test', 'queue'));
