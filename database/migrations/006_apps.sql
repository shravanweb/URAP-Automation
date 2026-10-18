-- 006: Apps. An app is a custom interface (pages of components bound to platform data, with
-- actions that run workflows, flows, agents, queue items, tasks, and REST calls). The editable
-- definition lives in apps.draft_json and every publish snapshots it into app_versions. Who may
-- open the app (project members, every tenant user, some roles, or named users) is in
-- apps.settings_json and applies immediately. Work an app starts is tagged with app_id.

CREATE TABLE IF NOT EXISTS apps (
  id CHAR(36) NOT NULL,
  tenant_id CHAR(36) NOT NULL,
  project_id CHAR(36) NOT NULL,
  name VARCHAR(200) NOT NULL,
  description TEXT NULL,
  status VARCHAR(20) NOT NULL DEFAULT 'draft',
  draft_json JSON NOT NULL,
  settings_json JSON NOT NULL,
  current_version_id CHAR(36) NULL,
  created_by CHAR(36) NULL,
  created_at DATETIME(3) NOT NULL,
  updated_at DATETIME(3) NOT NULL,
  PRIMARY KEY (id),
  KEY idx_apps_project (project_id, updated_at),
  KEY idx_apps_tenant (tenant_id, status),
  CONSTRAINT fk_apps_tenant FOREIGN KEY (tenant_id) REFERENCES tenants (id),
  CONSTRAINT fk_apps_project FOREIGN KEY (project_id) REFERENCES projects (id),
  CONSTRAINT fk_apps_user FOREIGN KEY (created_by) REFERENCES users (id),
  CONSTRAINT chk_apps_status CHECK (status IN ('draft', 'published', 'disabled'))
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS app_versions (
  id CHAR(36) NOT NULL,
  app_id CHAR(36) NOT NULL,
  version_number INT NOT NULL,
  definition_json JSON NOT NULL,
  published_by CHAR(36) NULL,
  published_at DATETIME(3) NOT NULL,
  PRIMARY KEY (id),
  UNIQUE KEY uq_app_versions (app_id, version_number),
  CONSTRAINT fk_app_versions_app FOREIGN KEY (app_id) REFERENCES apps (id),
  CONSTRAINT fk_app_versions_user FOREIGN KEY (published_by) REFERENCES users (id)
) ENGINE=InnoDB;

ALTER TABLE apps ADD CONSTRAINT fk_apps_version FOREIGN KEY (current_version_id) REFERENCES app_versions (id);

ALTER TABLE automation_jobs ADD COLUMN app_id CHAR(36) NULL;
ALTER TABLE automation_jobs ADD KEY idx_jobs_app (app_id);
ALTER TABLE flow_runs ADD COLUMN app_id CHAR(36) NULL;
ALTER TABLE agent_runs ADD COLUMN app_id CHAR(36) NULL;
ALTER TABLE action_tasks ADD COLUMN app_id CHAR(36) NULL;
ALTER TABLE queue_items ADD COLUMN app_id CHAR(36) NULL;

ALTER TABLE automation_jobs DROP CONSTRAINT chk_jobs_trigger;

ALTER TABLE automation_jobs
  ADD CONSTRAINT chk_jobs_trigger CHECK (trigger_source IN ('manual', 'schedule', 'api', 'retry', 'test', 'queue', 'flow', 'agent', 'app'));

ALTER TABLE flow_runs DROP CONSTRAINT chk_flow_runs_trigger;

ALTER TABLE flow_runs
  ADD CONSTRAINT chk_flow_runs_trigger CHECK (trigger_source IN ('manual', 'schedule', 'webhook', 'test', 'app'));

ALTER TABLE agent_runs DROP CONSTRAINT chk_agent_runs_source;

ALTER TABLE agent_runs
  ADD CONSTRAINT chk_agent_runs_source CHECK (source IN ('chat', 'api', 'flow', 'test', 'app'));
