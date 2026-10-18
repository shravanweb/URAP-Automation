# Testing

## Automated

From `backend`:

```powershell
npm test
```

`test/unit.test.js` covers encryption, redaction, path escape, PDF text, state transitions, workflow validation, conditions, loops, cron, the robot result contract, and the presence of the UiPath XAML files.

`test/api.test.js` uses MariaDB database `urap_test` and covers:

- project creation and viewer isolation
- dashboard counts from the database
- invalid workflow rejection and a real native run
- failed attempt retention and idempotent retry
- duplicate claim
- two concurrent jobs
- a connector health failure and an HTTP retry
- schedule overlap skip, CSV export, and Excel export
- robot authorization and file-handoff completion
- a down database returning `DATABASE_UNAVAILABLE` without a stack trace

`test/platform.test.js` covers migrations (including upgrading a database that only has `001_init`), work queues with business and application errors, queue triggers, the robot queue API, robot job claim with the contract robot and retry attempts, a hybrid robot step, schedule cron/time zone validation and enable/disable, audit scoping and user administration, file upload to CSV output with notifications, stale-job recovery, filtered exports, and workflow rename with audit.

`test/signup.test.js` (8 tests) covers `GET /api/auth/options`, self sign-up (project manager role, starter project, sign-in afterwards, audit entry), duplicate email (409, case-insensitive), field validation with nothing created, `ALLOW_SIGNUP=false` (403), the sign-up rate limit (429), refusing `SIGNUP_ROLE=administrator`, and the console password reset.

`test/automation.unit.test.js` (19 tests) covers selector normalisation, URL checks, recorder event to step conversion, desktop hotkeys and SendKeys escaping, the desktop adapter with a mock driver, driver selection, the Windows driver with a mocked `spawn`, the real `uia-helper.ps1` run with `pwsh` (skipped without it), amount and date parsing, invoice field extraction and confidence, PDF text layers, the custom SQL policy, PostgreSQL through PGlite, Google Sheets against a local mock server, Action Center form validation, engine suspend and resume, robot step execution, and validation of the new steps.

`test/automation.platform.test.js` (8 tests) uses real Chromium against a local test site (open, type with a Credential connection, select, click, get text, extract table, screenshot artifact), `ELEMENT_NOT_FOUND`, a headless recorder session, OCR of an uploaded PNG and a scanned PDF, Action Center complete/resume and cancel, HTTP request options, and robot web steps plus `ROBOT_UNSUPPORTED`. It needs `npx playwright install chromium`. Fixtures are in `test/fixtures` (`node test/fixtures/make-fixtures.mjs` rebuilds them).

The global setup drops `urap_test` only. It refuses any other database name. Set `TEST_DATABASE_URL` to use a different server or credentials.

From `frontend`:

```powershell
npm test
```

That renders the sign-in, sign-up, forgot-password, legal, and landing pages, the sign-up schema and password-strength hint, the status badge, the property panel, the Action Center page, and the Playwright codegen parser; also and empty state, tests the designer graph helpers (insert, remove, edges, definition), renders every page for a signed-in administrator, and checks the API client.

## End to end

With MariaDB, `npm start`, `npm run worker`, and `npm run dev` running:

```powershell
node scripts\e2e-smoke.mjs
```

It logs in with `ADMIN_EMAIL`/`ADMIN_PASSWORD` from `.env`, creates a project, uploads a CSV, publishes and runs a workflow, downloads the Excel output, checks a failed run and retry, a queue trigger, a one-time schedule, a robot job through the contract robot, exports, audit, notifications, and the Vite proxy (22 checks). With `E2E_AUTOMATION` not set to `0` it adds 13 more: a web workflow against a local test page (type, select, XPath click, wait, get text, table scrape, screenshot) run by the worker and by the robot agent, OCR of a PNG and a scanned PDF with field extraction, an Action Center suspend/complete/resume, and a headless recorder session. Expect 38 checks (3 more cover self sign-up, duplicate sign-up, and the sign-up and forgot-password routes).

External HTTP, SMTP, and UiPath are not called as live third-party services. The HTTP test uses a local server. The robot file test uses the contract processor and the outbox directory.

## Manual UiPath test

1. Start the API and worker.
2. Publish a workflow with execution type `uipath`.
3. Queue it and confirm the status remains `QUEUED`.
4. Run `uipath/Main.xaml` in Studio against that inbox file.
5. Confirm the job becomes `SUCCEEDED` or `FAILED` only after the result file or robot API call, and that the report file is downloadable.

This manual test was not run here because UiPath Robot is not installed.

## Manual desktop test (Windows)

See `desktop-automation.md`. Desktop steps were only tested with mocks and a PowerShell parse/ping test on Linux.
