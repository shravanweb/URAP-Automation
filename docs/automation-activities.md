# Automation activities (web, documents, Action Center, connectors)

These activities follow UiPath's naming where it makes sense (Open Browser, Type Into, Get Text,
Extract Table Data, Create Form Task). They run in the server **worker** (execution type
*Native*) and, for web, desktop, OCR, document, and data steps, in the **URAP robot agent**
(execution type *Robot*, `npm run robot`). Desktop activities are described in
[desktop-automation.md](desktop-automation.md).

## Web automation (Playwright)

Install the browser once on every machine that runs web steps (worker or robot):

```powershell
cd backend
npx playwright install chromium
```

To use the Chrome or Edge that is already installed instead, set `BROWSER_CHANNEL=chrome` or
`BROWSER_CHANNEL=msedge` (or `BROWSER_EXECUTABLE_PATH`) in `.env`.

| Activity | Type | Main arguments | Output |
| --- | --- | --- | --- |
| Open Browser | `browser_open` | `url`, `browser` (chromium, firefox, webkit), `headless`, `viewport`, `timeoutMs`, `session` | `url`, `title` |
| Navigate To | `browser_navigate` | `url` or `action` (back, forward, reload) | `url`, `title` |
| Click | `browser_click` | selector, `button`, `clickCount`, `modifiers`, `waitForNavigation` | `clicked`, `url` |
| Type Into | `browser_type` | selector, `text` or `credentialId` (+ `credentialField`), `clearBefore`, `pressEnter`, `key` | `typedCharacters` (text is never echoed) |
| Select Item | `browser_select_option` | selector, `value`, `label`, or `optionIndex` | `selected` |
| Get Text | `browser_get_text` | selector, `attribute`, `value`, `all` | `text` (or `texts`) |
| Extract Table Data | `browser_extract_table` | selector; `mode` `table` (header from `th` or the first row) or `list` with `fields` `[{ name, selector, attribute }]`; `nextSelector` + `maxPages` for pagination; `maxRows` | `rows`, `count`, `columns`, `pages` |
| Wait For Element | `browser_wait_for` | selector, `state` (visible, hidden, attached, detached), `timeoutMs`, `failIfNotFound` | `found`, `waitedMs` |
| Take Screenshot | `browser_screenshot` | `path` (.png in project storage, default `screenshots/<time>.png`), `fullPage`, optional `selector` | `path`, `bytes` — stored as a job artifact |
| Close Browser | `browser_close` | `session` | `closed` |

**Selectors.** `selector` plus `selectorType`:

- `auto` (default): XPath when the selector starts with `/` or `(`, otherwise CSS
- `css`, `xpath`
- `text`: visible text, `exact: true` for an exact match
- `role`: Playwright role selector, for example `button[name="Save"]`
- `label`, `placeholder`, `testid` (`data-testid`)

`index` picks the nth match (the first match is the default), and `frame` targets an iframe
(`iframe#main`).

A missing element fails the step with `ELEMENT_NOT_FOUND`. That error is retryable, so the
workflow retry policy applies.

**Sessions.** One browser per job is the default. Name a `session` to drive two browsers in the
same job. All browsers close when the job ends, even if it fails.

**Safety.** Only `http` and `https` URLs are allowed. `BROWSER_ALLOWED_HOSTS=example.com,intranet.local`
limits which hosts a workflow may open (subdomains are included).

### Recorder and selector picker

- **Designer → Record web** starts a Chromium window on the machine that runs the API. Every click,
  typed value, and selected option becomes an activity.
- **Pick an element** returns the ranked selector candidates for one element without recording a
  step: test id, id, role and name, label, name attribute, placeholder, text, CSS path, then XPath.
  The Target element field of the selected activity offers the picked selectors.
- **Insert steps** adds the recorded activities before End.
- **Passwords are never recorded.** A password field becomes a Type Into step that asks for a
  Credential connection.
- **API on a server without a screen:** run the recorder on your desktop instead:
  `cd backend; npm run record -- https://site --out recorded.json`. Then paste the JSON in
  *Record web → Import Playwright codegen*. `RECORDER_HEADLESS=true` makes API sessions headless,
  which is only useful for tests.
- **Playwright codegen import:** `npx playwright codegen https://site` → copy the JavaScript or
  Test output → *Record web → Import Playwright codegen*. These are mapped:
  - `goto`, `click`, `dblclick`, `fill`, `press`, `selectOption`, `check`, `hover`
  - `getByRole`, `getByText`, `getByLabel`, `getByPlaceholder`, `getByTestId`, `locator`,
    `frameLocator`, `first`, `nth`
  - `expect(...).toBeVisible()` and `toBeHidden()`

  Lines that cannot be mapped are listed rather than dropped.

Recorder API (role administrator, project manager, or automation developer):

- `POST /api/recorder/sessions` with `{ url, headless? }`
- `GET /api/recorder/sessions/{id}` returns `{ status, mode, events, picks, steps }`
- `POST /api/recorder/sessions/{id}/mode` with `{ mode: "record" | "pick" }`
- `POST /api/recorder/sessions/{id}/stop`

Sessions close after 15 idle minutes.

### Credentials for Type Into

Create a connection of type **Credential** with secret `{ "username": "...", "password": "..." }`.
Then set `credentialId` (and `credentialField`, default `password`) on Type Into, either the web or
the desktop version.

The value is decrypted only inside the worker. It never appears in the workflow definition, the
job input, or the step log. Robot jobs cannot read server credentials, so a robot Type Into must
use `text`.

## OCR and document understanding

| Activity | Type | Arguments | Output |
| --- | --- | --- | --- |
| OCR | `ocr_extract` | `path` (image or PDF in project storage), `language` (`eng`, `eng+hin`, …), `pages` (`1-3,5`, at most 50), `forceOcr`, `minTextChars`, `scale` | `text`, `confidence` (0–100), `pageCount`, `pages[]` (`source`: `text-layer` or `ocr`), `lines[]` with per-line confidence |
| Extract Document Fields | `extract_document_fields` | `source` (an OCR output, `{{steps.ocr}}`), `text`, or `path` (runs OCR first); `documentType` (`invoice`, `receipt`, `purchase_order`) and/or custom `fields`; `minConfidence` (default 0.8); `dateOrder` (`DMY` or `MDY`) | `values`, `fields{ name: { value, raw, confidence, label, valid } }`, `missing`, `lowConfidence`, `confidence`, `needsReview` |

**How OCR works.**

- PDFs with a text layer are read directly with pdf.js (confidence 99, no OCR).
- Scanned pages are rendered at 2× and recognised with tesseract.js.
- Images can be PNG, JPG, BMP, TIFF, WebP, or GIF. Uploads of png/jpg/tif/bmp are accepted under
  Projects → Files, and their file signature is checked.
- The first run downloads the language data (about 10 MB for `eng`) into `data/ocr-cache`. For
  offline machines, put `eng.traineddata` in a folder and set `OCR_LANG_PATH`.

**Templates.**

| Template | Fields |
| --- | --- |
| Invoice | invoice number and date (required), due date, PO number, vendor name, GSTIN, subtotal, tax, total (required), currency, email |
| Receipt | merchant, date, total |
| Purchase order | PO number, order date, total |

**Amounts and dates.**

- Amounts understand `1,23,456.50` (Indian grouping), `1.234,56`, currency symbols, and `Rs`/`₹`.
- Dates understand `15/09/2026`, `2026-09-15`, `5 Sep 2026`, and `September 5, 2026`.

**Custom fields.** `{ "name": "reference", "label": "Ref" | "labels": [...], "pattern": "regex with one group", "type": "string|id|amount|date|number|email|gstin", "required": true, "pick": "first|last" }`

**Confidence.** A field's confidence is the product of four factors:

- the label strength: specific labels score higher than generic ones such as "Total"
- the OCR confidence of the line the value came from
- 0.6 when the value does not parse
- 0.85 when equally strong labels disagree

`needsReview` is true when a required field is missing or below `minConfidence`. A typical next
step is a Flow Decision on `{{steps.fields.needsReview}}` that sends the document to a Validation
task in the Action Center.

## Action Center (human in the loop)

`create_task` creates a task and, by default (`waitForCompletion: true`), **suspends the job**.

Arguments:

| Argument | Meaning |
| --- | --- |
| `taskType` | `approval`, `form`, or `validation` |
| `title`, `description`, `priority` | Shown to the user |
| `data` | Values the user sees |
| `formFields` | `[{ name, label, type: text, textarea, number, date, select (with options), checkbox, email, required, default }]` |
| `outcomes` | Buttons, for example `["approve", "reject"]` |
| `requireCommentOnReject` | Rejecting needs a comment |
| `assignedRole` or `assignee` | A user email or id |
| `dueInHours` | Due time |

What happens:

1. The job status becomes `SUSPENDED` and the attempt stays open. Artifacts produced so far are
   stored, and queue items locked by the job stay locked.
2. Users see the task under **Action Center**, with a pending count in the navigation. A task can
   be assigned to yourself or released.
3. The form is validated on the server when the user completes the task.
4. Completing the task stores `{ taskId, outcome, data, comment, completedBy, completedAt }` as the
   output of the task step and queues the job again.
5. The worker continues **after** the task step in the same attempt. Steps that already ran are
   not repeated.

Other behaviour:

- **Cancel.** Cancelling a suspended job cancels its open tasks.
- **Retry.** Retrying a job starts it from the beginning.
- **Separate wait.** `waitForCompletion: false` creates the task without waiting.
- **`wait_for_task`** pauses on an existing task id until it is completed.
- **Limits.** Tasks cannot pause inside a For Each body or a sub-workflow (`SUSPEND_NOT_ALLOWED`),
  and they are not available on robot jobs.

Who can complete a task:

- administrators, project managers, operators, and automation developers who are members of the
  project
- an `assignedRole` or assigned user narrows this further; administrators and project managers can
  always complete a task

API:

- `GET /api/tasks` with `status` (pending, completed, cancelled, or all), `projectId`, `type`,
  `jobId`, `mine=true`
- `GET /api/tasks/summary`
- `GET /api/tasks/{id}`
- `POST /api/tasks/{id}/complete` with `{ outcome, data, comment }`
- `POST /api/tasks/{id}/assign` with `{ userId }` (omit it to assign yourself, `null` to release)

## Connectors

### HTTP Request (`rest_api` connection)

Arguments:

| Argument | Meaning |
| --- | --- |
| `method`, `path` | Request; the path stays on the connection's host |
| `query` | Object |
| `headers` | Object; `Host`, `Cookie`, `Content-Length` and similar headers are refused |
| `bodyType` | `json`, `form`, or `text` |
| `body` | Request body |
| `timeoutMs` | Capped at the connection timeout |
| `failOnError` | `false` returns 4xx/5xx responses instead of failing |

Connection config: `baseUrl`, `allowedMethods`, `keyHeaderName`.

Connection secret, one of:

- `token` (Bearer)
- `username` and `password` (Basic)
- `apiKey` (sent in `keyHeaderName`, default `x-api-key`)

Output: `{ status, ok, headers (content-type, location, etag, x-request-id, retry-after), data }`.

### Database Query (`mysql` or `postgres` connection)

- **Approved operations:** `select_rows`, `count_rows`, `insert_row`, and `update_rows`, against
  `allowedTables` and `allowedColumns`.
- **SQL with `run_query`:** needs `allowCustomQueries: true` on the connection.
  - Pass `query` and `parameters` (`?` for MySQL, `$1` for PostgreSQL).
  - One statement only, at most 10,000 characters and 100 parameters, at most `maxRows` rows
    returned (default 500, maximum 5,000).
  - Connections are **read-only by default** (`readOnly: true`): only SELECT, WITH, SHOW, EXPLAIN,
    DESCRIBE, and VALUES run, inside a read-only transaction. Set `readOnly: false` to allow
    writes.
- **PostgreSQL connection config:** `host`, `port`, `database`, `user`, `ssl`. Secret:
  `{ "password": "..." }`.

### Google Sheets (`google_sheets` connection)

Setup:

1. Create a Google Cloud **service account** and enable the Google Sheets API.
2. Download the JSON key and paste it as the connection secret.
3. Share the spreadsheet with the service account's email.
4. Connection config: `{ "spreadsheetId": "<id from the URL>" }`.

Activities:

- `sheets_read_range`: `range`, `headerRow` (default true). Output: `rows` (objects), `count`.
- `sheets_append_rows`: `range`, `rows` (objects or arrays), `columns`.
- `sheets_update_range`: `range`, `values` (2-D array) or `rows`.

`valueInputOption` is `USER_ENTERED` by default; use `RAW` to store values as typed.

This connector was tested against a local mock of the Sheets REST API, not against Google
itself.

## Robot agent

Workflows with execution type **Robot** (`uipath`) are dispatched to robots.

- **Real steps.** When the definition has real steps, the URAP robot agent (`npm run robot`, which
  replaces `npm run robot-simulator`):
  1. downloads the package from `GET /api/robot/jobs/{id}/package`
  2. runs browser, desktop, OCR, document, and data steps on its own machine
  3. uploads files the steps produced (screenshots) to `POST /api/robot/jobs/{id}/artifacts`
  4. posts the result with the step log to `POST /api/robot/jobs/{id}/result`
- **Start → End only.** Definitions with no other steps keep the original UiPath file-handoff
  contract (the report file).
- **Server-only steps** fail the robot job with `ROBOT_UNSUPPORTED` before anything runs: HTTP,
  database, file connection, queues, notifications, sub-workflows, Action Center, Google Sheets.
  Use a native workflow for those, or split the work.
- **Robot files.** On the robot, file paths are relative to `ROBOT_WORK_DIR` (default
  `ROBOT_ROOT/work`), in a folder per job (`<jobId>`).
