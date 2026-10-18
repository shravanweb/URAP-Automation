-- 008: BPMN processes. A process keeps its BPMN 2.0 XML as a draft; every publish snapshots the
-- XML and the Flow definition compiled from it into bpmn_process_versions. Execution reuses the
-- Flow engine: each process owns one backing flow (flows.bpmn_process_id) whose versions are the
-- compiled definitions, so runs, timers, Action Center tasks, schedules, and webhooks work the
-- same way as for flows. Backing flows are hidden from the Flows list.

CREATE TABLE IF NOT EXISTS bpmn_processes (
  id CHAR(36) NOT NULL,
  tenant_id CHAR(36) NOT NULL,
  project_id CHAR(36) NOT NULL,
  name VARCHAR(200) NOT NULL,
  description TEXT NULL,
  status VARCHAR(20) NOT NULL DEFAULT 'draft',
  draft_xml MEDIUMTEXT NOT NULL,
  flow_id CHAR(36) NULL,
  current_version_id CHAR(36) NULL,
  created_by CHAR(36) NULL,
  created_at DATETIME(3) NOT NULL,
  updated_at DATETIME(3) NOT NULL,
  PRIMARY KEY (id),
  KEY idx_bpmn_project (project_id, updated_at),
  CONSTRAINT fk_bpmn_tenant FOREIGN KEY (tenant_id) REFERENCES tenants (id),
  CONSTRAINT fk_bpmn_project FOREIGN KEY (project_id) REFERENCES projects (id),
  CONSTRAINT fk_bpmn_flow FOREIGN KEY (flow_id) REFERENCES flows (id),
  CONSTRAINT fk_bpmn_user FOREIGN KEY (created_by) REFERENCES users (id),
  CONSTRAINT chk_bpmn_status CHECK (status IN ('draft', 'published', 'disabled'))
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS bpmn_process_versions (
  id CHAR(36) NOT NULL,
  process_id CHAR(36) NOT NULL,
  version_number INT NOT NULL,
  xml MEDIUMTEXT NOT NULL,
  definition_json JSON NOT NULL,
  flow_version_id CHAR(36) NOT NULL,
  published_by CHAR(36) NULL,
  published_at DATETIME(3) NOT NULL,
  PRIMARY KEY (id),
  UNIQUE KEY uq_bpmn_version (process_id, version_number),
  KEY idx_bpmn_versions_flow (flow_version_id),
  CONSTRAINT fk_bpmn_versions_process FOREIGN KEY (process_id) REFERENCES bpmn_processes (id),
  CONSTRAINT fk_bpmn_versions_flow FOREIGN KEY (flow_version_id) REFERENCES flow_versions (id),
  CONSTRAINT fk_bpmn_versions_user FOREIGN KEY (published_by) REFERENCES users (id)
) ENGINE=InnoDB;

ALTER TABLE bpmn_processes ADD CONSTRAINT fk_bpmn_current_version FOREIGN KEY (current_version_id) REFERENCES bpmn_process_versions (id);

ALTER TABLE flows ADD COLUMN bpmn_process_id CHAR(36) NULL;

ALTER TABLE flows ADD KEY idx_flows_bpmn (bpmn_process_id)
