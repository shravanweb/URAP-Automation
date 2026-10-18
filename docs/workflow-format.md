# Workflow format

Published definitions use schema version `1.0`.

```json
{
  "schemaVersion": "1.0",
  "retryPolicy": { "maxAttempts": 2, "backoffSeconds": 30 },
  "steps": [
    { "id": "start", "type": "start", "name": "Start", "config": {}, "errorPolicy": "fail", "next": "end" },
    { "id": "end", "type": "end", "name": "End", "config": {}, "errorPolicy": "fail", "next": null }
  ]
}
```

Step types: `start`, `end`, `read_excel`, `read_csv`, `read_pdf_text`, `transform_data`, `validate_data`, `find_duplicates`, `if_else`, `for_each`, `http_request`, `database_query`, `browser_ui_action`, `file_operation`, `write_excel`, `send_notification`, `call_subworkflow`, `uipath_workflow`, `write_csv`, `log_message`, `add_queue_item`, `get_queue_item`, `set_queue_item_status`,
`browser_open`, `browser_navigate`, `browser_click`, `browser_type`, `browser_select_option`, `browser_get_text`, `browser_extract_table`, `browser_wait_for`, `browser_screenshot`, `browser_close`,
`desktop_open_app`, `desktop_attach_window`, `desktop_click`, `desktop_type`, `desktop_hotkey`, `desktop_get_text`, `desktop_close_window`,
`ocr_extract`, `extract_document_fields`, `create_task`, `wait_for_task`, `sheets_read_range`, `sheets_append_rows`, `sheets_update_range`.

Arguments for the web, document, Action Center, HTTP, database, and Google Sheets activities are listed in `automation-activities.md`. Desktop activities are in `desktop-automation.md`.

Example web step:

```json
{ "id": "login", "type": "browser_type", "name": "Type password", "errorPolicy": "fail", "next": "submit",
  "config": { "selector": "Password", "selectorType": "label", "credentialId": "<credential connection id>", "credentialField": "password" } }
```

`{{input.field}}` and `{{steps.stepId.field}}` and `{{item.field}}` copy values. They are not evaluated as JavaScript. A config key named `script`, `sql`, `command`, `shell`, `code`, `eval`, or `expression` is rejected.

`if_else` uses `operator` (`eq`, `neq`, `gt`, `gte`, `lt`, `lte`, `contains`, `empty`, `not_empty`) and branch ids `whenTrue` and `whenFalse`.

`for_each` requires `source`, `bodyStart`, `bodyEnd`, and `maxIterations` from 1 to 1000. The engine stops if the source is longer than the limit.

`database_query` accepts `select_rows`, `count_rows`, `insert_row`, or `update_rows` against tables and columns listed on the MySQL or PostgreSQL connection, and `run_query` (parameterised SQL) when the connection has `allowCustomQueries: true`; such connections are read-only unless `readOnly: false`. `update_rows` requires a filter. Identifiers must match `[A-Za-z_][A-Za-z0-9_]{0,63}`.

`http_request` uses a connection base URL. The step path must start with `/` and remain on that origin. It also takes `query`, `headers`, `bodyType` (`json`, `form`, `text`), `timeoutMs`, and `failOnError`.

File steps stay inside the project storage directory and require `path`. `..` and absolute paths are rejected.

`write_csv` takes `path`, `rows`, and optional `columns`. Cells that start with `=`, `+`, `-`, or `@` are prefixed with `'` so spreadsheets do not run them as formulas.

`log_message` takes `message` and `level` (`info`, `warn`, `error`) and stores the rendered message in the step log.

Queue steps name the queue with `queueName` (same project) or `queueId`:

- `add_queue_item`: `reference`, `priority` (`high`, `normal`, `low`), `specificContent`, optional `deferUntil` and `dueAt`.
- `get_queue_item`: `maxItems` from 1 to 100. Output is `{ found, item, items, count }`. Items are taken high priority first and marked `IN_PROGRESS` for this job.
- `set_queue_item_status`: `itemId`, `status` (`SUCCESSFUL` or `FAILED`), `errorType` (`business` or `application`), `errorMessage`, `output`. Application errors go back to `NEW` until the queue's retry limit; business errors are final. Items still `IN_PROGRESS` when the job ends are released as application errors.

`create_task` with `waitForCompletion: true` (default) suspends the job; the task result becomes the step output when the job resumes. It is rejected inside `for_each` bodies and sub-workflows.

Config keys matching password, secret, token, authorization, API key, credential, or cookie are redacted in stored step logs. Use a Credential connection (`credentialId`) for passwords instead of literal text.

Validation must pass before publish. A draft may be saved while invalid, and the API returns the errors.
