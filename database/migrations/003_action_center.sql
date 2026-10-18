-- Action Center (human-in-the-loop tasks), suspended jobs, and new connectors.

ALTER TABLE automation_jobs DROP CONSTRAINT chk_jobs_status;

ALTER TABLE automation_jobs
  ADD CONSTRAINT chk_jobs_status CHECK (status IN (
    'DRAFT', 'QUEUED', 'CLAIMED', 'RUNNING', 'SUCCEEDED', 'FAILED',
    'RETRY_WAIT', 'CANCEL_REQUESTED', 'CANCELLED', 'SKIPPED', 'SUSPENDED'
  ));

-- Saved execution state of a job waiting for an Action Center task: { stepId, taskId, steps, output }.
ALTER TABLE automation_jobs ADD COLUMN resume_state_json JSON NULL;

CREATE TABLE IF NOT EXISTS action_tasks (
  id CHAR(36) NOT NULL,
  tenant_id CHAR(36) NOT NULL,
  project_id CHAR(36) NOT NULL,
  job_id CHAR(36) NULL,
  workflow_id CHAR(36) NULL,
  step_key VARCHAR(80) NULL,
  task_type VARCHAR(20) NOT NULL,
  title VARCHAR(200) NOT NULL,
  description TEXT NULL,
  priority VARCHAR(10) NOT NULL DEFAULT 'medium',
  status VARCHAR(20) NOT NULL DEFAULT 'pending',
  form_schema_json JSON NULL,
  data_json JSON NULL,
  result_json JSON NULL,
  outcome VARCHAR(40) NULL,
  comment VARCHAR(2000) NULL,
  assigned_role VARCHAR(40) NULL,
  assigned_user_id CHAR(36) NULL,
  due_at DATETIME(3) NULL,
  completed_by CHAR(36) NULL,
  completed_at DATETIME(3) NULL,
  created_at DATETIME(3) NOT NULL,
  updated_at DATETIME(3) NOT NULL,
  PRIMARY KEY (id),
  KEY idx_tasks_status (tenant_id, status, priority, created_at),
  KEY idx_tasks_project (project_id, status),
  KEY idx_tasks_job (job_id),
  KEY idx_tasks_assignee (assigned_user_id, status),
  CONSTRAINT fk_tasks_tenant FOREIGN KEY (tenant_id) REFERENCES tenants (id),
  CONSTRAINT fk_tasks_project FOREIGN KEY (project_id) REFERENCES projects (id),
  CONSTRAINT fk_tasks_job FOREIGN KEY (job_id) REFERENCES automation_jobs (id),
  CONSTRAINT fk_tasks_assignee FOREIGN KEY (assigned_user_id) REFERENCES users (id),
  CONSTRAINT fk_tasks_completed_by FOREIGN KEY (completed_by) REFERENCES users (id),
  CONSTRAINT chk_tasks_type CHECK (task_type IN ('approval', 'form', 'validation')),
  CONSTRAINT chk_tasks_status CHECK (status IN ('pending', 'completed', 'cancelled')),
  CONSTRAINT chk_tasks_priority CHECK (priority IN ('low', 'medium', 'high', 'critical'))
) ENGINE=InnoDB;
