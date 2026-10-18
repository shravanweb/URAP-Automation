-- Agents: AI agents with versioned configuration, runs (conversations / autonomous runs),
-- messages with tool calls and token usage. Also links jobs, tasks, and flow steps to agent runs.

CREATE TABLE IF NOT EXISTS agents (
  id CHAR(36) NOT NULL,
  tenant_id CHAR(36) NOT NULL,
  project_id CHAR(36) NOT NULL,
  name VARCHAR(200) NOT NULL,
  description VARCHAR(4000) NOT NULL DEFAULT '',
  agent_type VARCHAR(20) NOT NULL DEFAULT 'conversational',
  status VARCHAR(20) NOT NULL DEFAULT 'draft',
  draft_json JSON NOT NULL,
  current_version_id CHAR(36) NULL,
  created_by CHAR(36) NOT NULL,
  created_at DATETIME(3) NOT NULL,
  updated_at DATETIME(3) NOT NULL,
  PRIMARY KEY (id),
  KEY idx_agents_project (project_id, updated_at),
  CONSTRAINT fk_agents_tenant FOREIGN KEY (tenant_id) REFERENCES tenants (id),
  CONSTRAINT fk_agents_project FOREIGN KEY (project_id) REFERENCES projects (id),
  CONSTRAINT fk_agents_user FOREIGN KEY (created_by) REFERENCES users (id),
  CONSTRAINT chk_agents_type CHECK (agent_type IN ('conversational', 'autonomous')),
  CONSTRAINT chk_agents_status CHECK (status IN ('draft', 'published', 'disabled'))
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS agent_versions (
  id CHAR(36) NOT NULL,
  agent_id CHAR(36) NOT NULL,
  version_number INT NOT NULL,
  config_json JSON NOT NULL,
  published_by CHAR(36) NULL,
  published_at DATETIME(3) NOT NULL,
  PRIMARY KEY (id),
  UNIQUE KEY uq_agent_versions (agent_id, version_number),
  CONSTRAINT fk_agent_versions_agent FOREIGN KEY (agent_id) REFERENCES agents (id)
) ENGINE=InnoDB;

ALTER TABLE agents
  ADD CONSTRAINT fk_agents_version FOREIGN KEY (current_version_id) REFERENCES agent_versions (id);

CREATE TABLE IF NOT EXISTS agent_runs (
  id CHAR(36) NOT NULL,
  tenant_id CHAR(36) NOT NULL,
  project_id CHAR(36) NOT NULL,
  agent_id CHAR(36) NOT NULL,
  agent_version_id CHAR(36) NULL,
  config_json JSON NOT NULL,
  mode VARCHAR(20) NOT NULL,
  source VARCHAR(20) NOT NULL,
  status VARCHAR(20) NOT NULL,
  title VARCHAR(200) NOT NULL DEFAULT '',
  input_json JSON NULL,
  output_json JSON NULL,
  error_message VARCHAR(1000) NULL,
  provider_label VARCHAR(120) NULL,
  steps INT NOT NULL DEFAULT 0,
  prompt_tokens INT NOT NULL DEFAULT 0,
  completion_tokens INT NOT NULL DEFAULT 0,
  flow_run_id CHAR(36) NULL,
  lock_until DATETIME(3) NULL,
  started_by CHAR(36) NULL,
  started_at DATETIME(3) NOT NULL,
  finished_at DATETIME(3) NULL,
  created_at DATETIME(3) NOT NULL,
  updated_at DATETIME(3) NOT NULL,
  PRIMARY KEY (id),
  KEY idx_agent_runs_agent (agent_id, created_at),
  KEY idx_agent_runs_status (status, updated_at),
  KEY idx_agent_runs_flow (flow_run_id),
  CONSTRAINT fk_agent_runs_tenant FOREIGN KEY (tenant_id) REFERENCES tenants (id),
  CONSTRAINT fk_agent_runs_project FOREIGN KEY (project_id) REFERENCES projects (id),
  CONSTRAINT fk_agent_runs_agent FOREIGN KEY (agent_id) REFERENCES agents (id),
  CONSTRAINT fk_agent_runs_version FOREIGN KEY (agent_version_id) REFERENCES agent_versions (id),
  CONSTRAINT chk_agent_runs_mode CHECK (mode IN ('chat', 'task')),
  CONSTRAINT chk_agent_runs_source CHECK (source IN ('chat', 'api', 'flow', 'test')),
  CONSTRAINT chk_agent_runs_status CHECK (status IN ('RUNNING', 'WAITING', 'IDLE', 'SUCCEEDED', 'FAILED', 'CANCELLED'))
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS agent_messages (
  id CHAR(36) NOT NULL,
  run_id CHAR(36) NOT NULL,
  seq BIGINT NOT NULL AUTO_INCREMENT,
  role VARCHAR(20) NOT NULL,
  content MEDIUMTEXT NULL,
  tool_calls_json JSON NULL,
  tool_call_id VARCHAR(80) NULL,
  tool_name VARCHAR(64) NULL,
  tool_args_json JSON NULL,
  status VARCHAR(20) NOT NULL DEFAULT 'done',
  job_id CHAR(36) NULL,
  task_id CHAR(36) NULL,
  prompt_tokens INT NOT NULL DEFAULT 0,
  completion_tokens INT NOT NULL DEFAULT 0,
  duration_ms INT NULL,
  created_by CHAR(36) NULL,
  created_at DATETIME(3) NOT NULL,
  updated_at DATETIME(3) NOT NULL,
  PRIMARY KEY (id),
  UNIQUE KEY uq_agent_messages_seq (seq),
  KEY idx_agent_messages_run (run_id, seq),
  KEY idx_agent_messages_job (job_id),
  KEY idx_agent_messages_task (task_id),
  CONSTRAINT fk_agent_messages_run FOREIGN KEY (run_id) REFERENCES agent_runs (id),
  CONSTRAINT chk_agent_messages_role CHECK (role IN ('system', 'user', 'assistant', 'tool')),
  CONSTRAINT chk_agent_messages_status CHECK (status IN ('running', 'pending', 'done', 'error'))
) ENGINE=InnoDB;

ALTER TABLE action_tasks ADD COLUMN agent_run_id CHAR(36) NULL;

ALTER TABLE action_tasks ADD KEY idx_tasks_agent_run (agent_run_id);

ALTER TABLE automation_jobs ADD COLUMN agent_run_id CHAR(36) NULL;

ALTER TABLE flow_run_nodes ADD COLUMN agent_run_id CHAR(36) NULL;

ALTER TABLE automation_jobs DROP CONSTRAINT chk_jobs_trigger;

ALTER TABLE automation_jobs
  ADD CONSTRAINT chk_jobs_trigger CHECK (trigger_source IN ('manual', 'schedule', 'api', 'retry', 'test', 'queue', 'flow', 'agent'))
