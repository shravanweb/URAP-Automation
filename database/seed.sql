-- Reference data only. No users, passwords, tokens, or execution history.

SET NAMES utf8mb4;
SET time_zone = '+00:00';

INSERT INTO tenants (id, name, slug, isolation_enabled, created_at, updated_at)
VALUES (
  '00000000-0000-4000-8000-000000000001',
  'Default tenant',
  'default',
  1,
  UTC_TIMESTAMP(3),
  UTC_TIMESTAMP(3)
) ON DUPLICATE KEY UPDATE name = VALUES(name);

INSERT INTO use_case_categories (code, label, description) VALUES
  ('erp', 'ERP', 'Orders, inventory, purchasing, shipments, and operational reports'),
  ('crm', 'CRM', 'Customer records, leads, and follow-up tasks'),
  ('hrms', 'HRMS', 'Attendance, employee data, and leave records'),
  ('ecommerce', 'E-commerce', 'Order validation, inventory sync, and status updates'),
  ('finance', 'Finance', 'Invoice extraction, reconciliation, and financial reports'),
  ('excel', 'Excel and files', 'Spreadsheets, CSV, duplicates, validation, and exports'),
  ('web', 'Web applications', 'Form filling and browser-based record updates'),
  ('api', 'API integration', 'Authorized synchronization between applications'),
  ('documents', 'Documents', 'PDF, CSV, Excel, and document processing'),
  ('email', 'Email', 'Authorized mailbox processing and attachment routing'),
  ('testing', 'Testing', 'Repeatable UI checks, API tests, and validation workflows'),
  ('reporting', 'Reporting', 'Scheduled reports and data exports'),
  ('general', 'General', 'Cross-industry automation that does not fit one category')
ON DUPLICATE KEY UPDATE label = VALUES(label), description = VALUES(description);

INSERT INTO connectors (
  id, display_name, description, config_schema_json, permissions_json,
  input_format, output_format, timeout_ms, availability
) VALUES
  (
    'rest_api',
    'REST API',
    'HTTP calls restricted to a configured base URL',
    JSON_OBJECT('required', JSON_ARRAY('baseUrl'), 'properties', JSON_OBJECT('baseUrl', 'https URL', 'healthPath', 'optional path', 'allowedMethods', 'array')),
    JSON_ARRAY('connections.test', 'workflows.execute'),
    'json',
    'json',
    30000,
    'available'
  ),
  (
    'excel',
    'Excel',
    'Read and write xlsx workbooks inside project storage',
    JSON_OBJECT('required', JSON_ARRAY(), 'properties', JSON_OBJECT('note', 'Uses the project storage root')),
    JSON_ARRAY('files.read', 'files.write'),
    'xlsx',
    'json-rows',
    30000,
    'available'
  ),
  (
    'csv',
    'CSV',
    'Read and write CSV files inside project storage',
    JSON_OBJECT('required', JSON_ARRAY(), 'properties', JSON_OBJECT('delimiter', 'optional single character')),
    JSON_ARRAY('files.read', 'files.write'),
    'csv',
    'json-rows',
    30000,
    'available'
  ),
  (
    'pdf_text',
    'PDF text',
    'Extract literal text from simple PDF documents',
    JSON_OBJECT('required', JSON_ARRAY(), 'properties', JSON_OBJECT('note', 'Literal text extraction, not OCR')),
    JSON_ARRAY('files.read'),
    'pdf',
    'text',
    30000,
    'available'
  ),
  (
    'file_storage',
    'File storage',
    'List, read, copy, and write files inside a configured root',
    JSON_OBJECT('required', JSON_ARRAY('rootRelative'), 'properties', JSON_OBJECT('rootRelative', 'path under project storage')),
    JSON_ARRAY('files.read', 'files.write'),
    'path',
    'file-metadata',
    30000,
    'available'
  ),
  (
    'mysql',
    'MySQL',
    'Parameterized operations on allow-listed tables only',
    JSON_OBJECT('required', JSON_ARRAY('host', 'database', 'user', 'allowedTables'), 'properties', JSON_OBJECT('port', 'number', 'allowedTables', 'array of table names', 'allowedColumns', 'map of table to columns')),
    JSON_ARRAY('database.read', 'database.write'),
    'operation',
    'json-rows',
    30000,
    'available'
  ),
  (
    'browser_uipath',
    'Browser via UiPath',
    'Browser UI actions executed only by an authorized robot',
    JSON_OBJECT('required', JSON_ARRAY('applicationName'), 'properties', JSON_OBJECT('applicationName', 'label', 'startUrl', 'https URL')),
    JSON_ARRAY('robot.execute'),
    'ui-action',
    'robot-result',
    120000,
    'requires_robot'
  ),
  (
    'email',
    'Email',
    'Send mail through a configured SMTP connection',
    JSON_OBJECT('required', JSON_ARRAY('host', 'port', 'from'), 'properties', JSON_OBJECT('host', 'smtp host', 'port', 'number', 'from', 'mailbox', 'secure', 'boolean')),
    JSON_ARRAY('mail.send'),
    'message',
    'delivery-receipt',
    30000,
    'available'
  ),
  (
    'postgres',
    'PostgreSQL',
    'Approved table operations, plus parameterized custom queries when allowCustomQueries is true',
    JSON_OBJECT('required', JSON_ARRAY('host', 'database', 'user'), 'properties', JSON_OBJECT('host', 'hostname', 'port', 'number', 'database', 'name', 'user', 'login', 'ssl', 'boolean', 'allowedTables', 'array', 'allowCustomQueries', 'boolean', 'readOnly', 'boolean')),
    JSON_ARRAY('connections.test', 'workflows.execute'),
    'operation',
    'rows',
    30000,
    'available'
  ),
  (
    'google_sheets',
    'Google Sheets',
    'Read, append, and update ranges with a Google service account',
    JSON_OBJECT('required', JSON_ARRAY('spreadsheetId'), 'properties', JSON_OBJECT('spreadsheetId', 'id from the sheet URL', 'secret', 'service account key JSON')),
    JSON_ARRAY('connections.test', 'workflows.execute'),
    'rows',
    'rows',
    30000,
    'available'
  ),
  (
    'credential',
    'Credential',
    'Stored username and password for Type Into activities (like an Orchestrator credential asset)',
    JSON_OBJECT('required', JSON_ARRAY(), 'properties', JSON_OBJECT('description', 'optional note', 'secret', 'username and password')),
    JSON_ARRAY('workflows.execute'),
    'none',
    'text',
    1000,
    'available'
  ),
  (
    'ai_provider',
    'AI provider',
    'Model provider for agents: OpenAI, Azure OpenAI, Groq, Ollama or any OpenAI-compatible API, or Anthropic. The API key is stored encrypted.',
    JSON_OBJECT('required', JSON_ARRAY('provider', 'model'), 'properties', JSON_OBJECT('provider', 'openai | azure_openai | anthropic | openai_compatible', 'baseUrl', 'optional https URL (required for Azure and local servers)', 'model', 'default model or Azure deployment', 'apiVersion', 'Azure only', 'secret', 'apiKey')),
    JSON_ARRAY('connections.test', 'agents.run'),
    'json',
    'json',
    60000,
    'available'
  )
ON DUPLICATE KEY UPDATE
  display_name = VALUES(display_name),
  description = VALUES(description),
  config_schema_json = VALUES(config_schema_json),
  availability = VALUES(availability);
