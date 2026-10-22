-- Password-reset links, and the coded agent type (JavaScript tools in a permission sandbox).

CREATE TABLE IF NOT EXISTS password_reset_tokens (
  id CHAR(36) NOT NULL,
  user_id CHAR(36) NOT NULL,
  token_hash CHAR(64) NOT NULL,
  expires_at DATETIME(3) NOT NULL,
  used_at DATETIME(3) NULL,
  created_at DATETIME(3) NOT NULL,
  PRIMARY KEY (id),
  UNIQUE KEY uq_password_reset_hash (token_hash),
  KEY idx_password_reset_user (user_id),
  CONSTRAINT fk_password_reset_user FOREIGN KEY (user_id) REFERENCES users (id)
) ENGINE=InnoDB;

ALTER TABLE agents DROP CONSTRAINT IF EXISTS chk_agents_type;
ALTER TABLE agents ADD CONSTRAINT chk_agents_type CHECK (agent_type IN ('conversational', 'autonomous', 'coded'));
