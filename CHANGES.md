# universal-rpa: changes

## Update 4 (18 Oct 2026): original homepage restored

This update is built on Update 3, which your laptop has now. Nothing on your laptop was touched.

- **The original homepage is back**, with the same content and layout as before Update 3. `frontend/src/pages/LandingPage.jsx` and its hero image `frontend/homescreen.png` were restored from the earlier version.
- **The new pages stay as they are:** sign-up, sign-in, forgot password, legal, and the app shell.
- **The page looks the same as before.** Its original styles were moved into `frontend/src/pages/landing-legacy.css`, scoped to the homepage, and the Poppins font is loaded again in `frontend/index.html`. The new design system does not change the homepage, and the homepage styles do not affect other pages. Screenshots of the old and restored versions match pixel for pixel at 1280 px and 390 px (`screens/landing-old-original-1280.png`, `screens/landing-old-restored-1280.png`).
- **The only functional change:** "Try URAP free" and "Get started" open the sign-up page (`/signup`), and "Sign in" opens `/login`.
- **Tests:** the homepage test now checks the original page and its sign-up and sign-in links.
- The Update 3 notes below that describe the redesigned homepage, and the removal of `homescreen.png`, no longer apply.

## Update 3 (18 Oct 2026): professional public site, sign-up, sign-in, and app shell

This update is built on the code your laptop has now: Update 2 plus the `uia-helper.ps1` `open_app` fix, which is kept unchanged. Nothing on your laptop was touched.

### What changed

1. **Homepage**, rebuilt in an enterprise SaaS style:
   - A hero with a clear value proposition and a product preview built in HTML (sharp at any size).
   - Product facts, counted from the code: 45+ activities, 8 selector strategies, 3 execution modes, self-hosted.
   - Six product cards: Studio designer, Robots, Orchestrator, Action Center, Document Understanding, and Queues.
   - A four-step "How it works" section and a governance section.
   - Pricing with Free, Pro, and Enterprise plan descriptions. No payment is collected, and the page says so.
   - A closing call to action and a full footer.
   - There are no customer logos or testimonials.
2. **"Try URAP free" opens a real sign-up page** (`/signup`):
   - Fields: full name, work email, organization name, and password with a strength meter and live rule checks. An accept-terms checkbox links to a new `/legal` page (Terms of Use and Privacy Notice).
   - **Backend:** `POST /api/auth/signup` and `GET /api/auth/options`.
     - A new account joins the default tenant as `SIGNUP_ROLE` (default `project_manager`; `administrator` is refused). It gets a starter project, "<organization> workspace", and is signed in immediately. A welcome banner links to the Workflow Builder.
     - **Validation:** zod checks every field. Passwords need 12+ characters with letters and numbers and must not contain the email name. Duplicate emails are refused with 409 `EMAIL_IN_USE`, case-insensitive.
     - **Limits and audit:** a separate rate limit allows 10 attempts per hour per client (429). Each sign-up writes an audit entry.
     - **Switch:** controlled by `ALLOW_SIGNUP` (default `true`). When it is off, the page explains that sign-up is disabled.
3. **Sign-in**, a full-height split layout:
   - A brand panel (navy gradient, concise copy, a run preview, and four product highlights on a grid with fixed spacing, so nothing can overlap) and a form panel.
   - Show/hide password, a Caps Lock hint, and "Keep me signed in on this device" (the session is stored in localStorage instead of sessionStorage).
   - Error states for wrong credentials, too many attempts, server down, and empty fields, plus a loading state.
   - Accessibility: autofocus, labelled inputs, `aria-invalid` and `aria-describedby`, `role="alert"` messages, and full keyboard use.
   - After sign-in you return to the page you originally asked for.
4. **Forgot password**:
   - There is no outgoing email setup for account messages, so `/forgot-password` is a clear "contact your administrator" page.
   - To make that path work, administrators now have **Settings → Users → Reset password**. It sets a random temporary password, shows it once, and signs the user out elsewhere.
   - A locked-out administrator can run `npm run reset-password -- you@company.com` on the server.
5. **Design system:**
   - **Tokens:** navy ink, cool neutrals, and one orange accent. Button orange #D63A0C passes WCAG AA with white text; #FA4616 is used for the logo.
   - **Type and components:** Inter type, and shared classes for buttons, inputs, labels, errors, and cards.
   - **Icons:** a new logo and favicon, and an inline SVG icon set.
   - **Dark mode:** the auth pages follow the OS dark-mode setting.
   - **Consistency:** the old warm palette names now map to the new tokens, so every in-app page picks up the look without page rewrites.
6. **In-app shell:**
   - A navy sidebar with grouped sections (Overview, Build, Run, Govern), icons, an active indicator, and the Action Center count.
   - A sticky header with the page title, an Action Center shortcut, and a user menu (name, email, role, Settings, Homepage, Sign out).
   - A slide-in navigation drawer on mobile, and a skip-to-content link.
   - All 12 in-app pages were checked in the browser and render in the new shell.

### Database and installation

- **No database migration.** Sign-up uses the existing `users`, `projects`, and `project_members` tables.
- **No new npm dependencies** in the backend or frontend. Run `npm install` only if your `node_modules` predates Update 2.
- Optional new `.env` settings: `ALLOW_SIGNUP=true`, `SIGNUP_ROLE=project_manager`, `SIGNUP_RATE_LIMIT_MAX=10`, `SIGNUP_RATE_LIMIT_WINDOW_MS=3600000`.
- The Inter font loads from Google Fonts, as Poppins did before. Offline, the pages fall back to Segoe UI.
- Removed: `frontend/homescreen.png`, the old hero image (1.8 MB), which is no longer used. It is listed in `DELETED-FILES.txt`.

Steps (PowerShell), after extracting `update-files.zip` over your folder and deleting the file listed in `DELETED-FILES.txt`:

```powershell
# restart the API so it reads the new settings; the frontend dev server picks up the files itself
cd "C:\Users\Shravan\Desktop\UI Path\universal-rpa\backend"; npm start
cd "C:\Users\Shravan\Desktop\UI Path\universal-rpa\backend"; npm test      # expect 68 passed
cd ..\frontend; npm test                                                         # expect 22 passed
cd ..; node scripts\e2e-smoke.mjs                                               # expect 38 checks (API, worker, Vite running)
```

### Verified on the box

- **Backend:** 68/68 passed. That is the 60 existing tests plus 8 new ones in `test/signup.test.js` (sign-up success, duplicate, validation, disabled, rate limit, role guard, console password reset).
- **Frontend:** 22/22 passed. That is the 14 existing tests plus 8 new ones: auth page rendering, the sign-up schema, sign-in error messages, and the password-strength hint. `npm run build` succeeds.
- **e2e-smoke:** 38/38 passed (35 existing plus 3 new sign-up and route checks).
- **Screenshots** of the landing, sign-up, sign-in, and forgot-password pages at 1280, 1440, 1920, 768, and 390 px are in `screens/`. An automated audit of every text box found no overlapping text, no horizontal scrolling, and no clipped text at any width. The audit was confirmed to flag the old "Studio, Robot, and Orchestrator" overlap.
- **Browser walkthrough:** "Try URAP free" opens sign-up; field errors appear; the strength meter updates; sign-up lands on the dashboard with a welcome banner and the starter project; sign-out shows a notice; a duplicate email shows the field error; wrong-password and empty-field errors appear; show password works; remember me uses localStorage; the mobile shell has no horizontal scroll; all admin pages render; Reset password appears in Settings; dark-mode sign-in works. No console errors.

---

## Update 2 (18 Oct 2026): UiPath-style automation

This update was built on the box from the version that passed on your laptop (33/33 backend, 8/8 frontend, 22/22 e2e). The stack is unchanged. Nothing on your laptop was touched.

### What was added

1. **Web UI automation (Playwright)**
   - Ten activities, run by both the worker and the robot agent: Open Browser, Navigate To, Click, Type Into, Select Item, Get Text, Extract Table Data (table or list mode, pagination), Wait For Element, Take Screenshot (stored as a job artifact), and Close Browser.
   - Selector types: CSS, XPath, text, role, label, placeholder, and test id, plus a match index and an iframe.
   - Type Into can take a password from a new **Credential** connection, so passwords never appear in definitions or logs.
   - **Recorder and selector picker:** Designer → Record web. There is also `npm run record -- <url>` for your PC, and *Import Playwright codegen* for code from `npx playwright codegen`.
2. **Windows desktop automation**
   - Seven activities: Open Application, Attach Window, Click, Type Into, Send Hotkey, Get Text, and Close Window.
   - They use a driver adapter. The Windows driver calls a PowerShell UI Automation helper, so there is no native npm module and no extra install. `DESKTOP_DRIVER` selects the driver: auto, windows, mock, or none.
   - Documented in `docs/desktop-automation.md`.
3. **OCR and Document Understanding**
   - OCR reads the PDF text layer first and uses tesseract.js for images and scanned pages, with per-page and per-line confidence.
   - Extract Document Fields has invoice, receipt, and purchase-order templates, plus custom regex/label fields. Each field gets a confidence score, and `needsReview` is set when a field is missing or uncertain.
   - Project file upload now accepts PNG, JPEG, TIFF, and BMP.
4. **Action Center**
   - Create Task (approval, form, or validation) suspends the job (`SUSPENDED`). Wait For Task waits on an existing task.
   - A new Action Center page (with a pending count in the navigation) lists tasks with filters, a form, outcome buttons, and assign/release.
   - Completing a task resumes the job **after** the task step, in the same attempt. Cancelling a job cancels its tasks.
5. **Connectors**
   - **HTTP Request** gains query, headers, Basic/Bearer/API-key auth, json/form/text bodies, a timeout, and `failOnError: false`.
   - **Database Query** now supports **PostgreSQL** as well as MySQL. It also accepts parameterised `run_query` SQL when you enable it on the connection, and that SQL is read-only by default.
   - **Google Sheets** (service account): Read Range, Append Rows, and Update Range.
6. **Designer**
   - The palette has a search box and groups: Web, Desktop, Documents, Action Center, and Integration.
   - Each step has a **property panel** with typed fields, kept in sync with the JSON editor. It includes selector fields with picked selectors, a credential picker, and a connection picker.
   - The dashboard shows a "Waiting for people" count. Operations shows suspended jobs and hints for the new connection types.
7. **Robot agent**
   - `npm run robot` (also available as `npm run robot-simulator`) downloads the job package, runs web, desktop, OCR, and data steps locally, uploads screenshots, and reports the step log.
   - Server-only steps fail the job with `ROBOT_UNSUPPORTED`.
   - Start → End definitions keep the old UiPath file-handoff contract.

Full argument lists are in `docs/automation-activities.md`. The README and the API, schema, workflow-format, testing, installation, UiPath, and user-manual docs, plus `openapi.yaml`, were updated.

### Database

Migration `003_action_center.sql` adds:

- the `action_tasks` table
- the `automation_jobs.resume_state_json` column
- the `SUSPENDED` job and attempt status

The reseed adds the `postgres`, `google_sheets`, and `credential` connectors. `npm run setup` applies all of this to your existing `urap` database. Nothing is dropped.

### New npm dependencies (backend)

- `playwright` ^1.64 (the browser is downloaded separately; see below)
- `tesseract.js` ^7 (OCR)
- `pdfjs-dist` ^6.4 and `@napi-rs/canvas` ^1.0, which render scanned PDF pages for OCR. `@napi-rs/canvas` ships prebuilt Windows binaries, so no build tools are needed.
- `pg` ^8.23 (PostgreSQL)
- dev only: `@electric-sql/pglite` ^0.5 (in-process PostgreSQL for the tests)

The frontend has no new dependencies.

### Install this update on Windows (PowerShell)

Stop the running API, worker, Vite, and robot windows first. Then either:

- unzip `universal-rpa-complete.zip` over a fresh folder, keeping your old one as a backup, or
- extract `update-files.zip` over your existing `universal-rpa` folder. It contains only the changed and new files, with their paths. `DELETED-FILES.txt` lists the files to remove; there are none in this update.

```powershell
cd "C:\Users\Shravan\Desktop\UI Path\universal-rpa\backend"
npm install
npx playwright install chromium     # one-time, about 150 MB, into %LOCALAPPDATA%\ms-playwright
npm run setup                       # applies migration 003 and reseeds the connector catalog
cd ..\frontend
npm install
```

Optional `.env` additions (all have defaults; see `.env.example`):

```
BROWSER_HEADLESS=true          # false shows the browser while workflows run
BROWSER_CHANNEL=               # msedge or chrome to use the installed browser instead of downloaded Chromium
BROWSER_ALLOWED_HOSTS=         # e.g. intranet.local,example.com to restrict web steps
RECORDER_HEADLESS=false
DESKTOP_DRIVER=auto            # auto = windows on Windows
DESKTOP_POWERSHELL=powershell.exe
OCR_LANG_PATH=                 # folder with eng.traineddata for offline OCR
ROBOT_WORK_DIR=
```

Notes:

- **OCR** downloads `eng` language data (about 10 MB) into `data\ocr-cache` the first time it runs, so it needs internet access once, or set `OCR_LANG_PATH`.
- **Desktop steps** need the worker or robot to run in your signed-in, unlocked Windows session, not as a service. Elevated applications need an elevated worker.
- **Desktop first check:** a workflow with Open Application `notepad.exe` (window title `Notepad`), then Type Into (desktop) with selector `{ "controlType": "Document" }` (Windows 11) or `{ "controlType": "Edit" }` (Windows 10). See `docs\desktop-automation.md`.
- **Recorder:** Designer → Record web opens Chromium on the machine running the API, which is your PC when you run locally. To record without the API, run `cd backend; npm run record -- https://site --out recorded.json`, then paste the JSON under Record web → Import.
- **Robot agent:** `npm run robot` with `ROBOT_TOKEN` in `.env`. `scripts\dev.ps1 -Robot` now starts it.

Run the tests (backend tests need Chromium installed):

```powershell
cd "C:\Users\Shravan\Desktop\UI Path\universal-rpa\backend"; npm test     # expect 60 passed
cd ..\frontend; npm test                                                    # expect 14 passed
# with API, worker and Vite running:
cd ..; node scripts\e2e-smoke.mjs                                          # expect 35 checks
```

Set `E2E_AUTOMATION=0` to run only the original 22 e2e checks.

### Verified on the box (Linux, Node 22.23, MariaDB 11.4.13, Chromium from Playwright)

- **Backend: 60/60 passed.** That is the 33 existing tests plus 19 automation unit tests and 8 integration tests. The integration tests use real Chromium, real OCR, Action Center resume, and robot runs.
- **Frontend: 14/14 passed.** `npm run build` succeeds.
- **e2e-smoke: 35/35 checks passed** against the `urap` database with the API, worker, and Vite running. That is the 22 existing checks plus 13 new ones:
  - a web workflow (type, select, XPath click, wait, get text, table scrape, screenshot artifact) run by the worker and by the robot agent
  - OCR of a PNG (confidence 94) and of a scanned PDF, with invoice field extraction (field confidence 0.86–0.87, no review needed)
  - Action Center suspend → complete → resume
  - a headless recorder session
- **Browser walkthrough of the UI:** property panel ↔ JSON sync, recorder insert, Action Center badge, approving a task in the UI completes the job, no console errors.

### Not done, or not verifiable here

- **Desktop automation was not run against real Windows applications.** The box is Linux. The adapter and driver are unit-tested with mocks, and the real PowerShell helper is parse-tested and ping-tested with PowerShell 7. The UI Automation calls themselves (finding elements, clicking, typing) still need a first run on Windows; the steps are in `docs\desktop-automation.md`.
- **Google Sheets was tested against a local mock of the Sheets API**, not against Google, because there were no Google credentials on the box.
- **The recorder needs a screen** on the API machine. Headless sessions only work for tests. On a headless server use `npm run record` or codegen import.
- **Robot jobs cannot use server-only steps** (HTTP, database, queues, Action Center, Sheets, notifications). They fail with `ROBOT_UNSUPPORTED`. A robot in file mode (no `ROBOT_TOKEN`) cannot upload screenshots.
- **MySQL `run_query`** has no dedicated MySQL integration test. The policy is unit-tested, and PostgreSQL `run_query` is tested through PGlite.
- **Not built:** image or computer-vision targeting (click on an image), a full UiPath Orchestrator-compatible Action Center API, and a handwriting or ML document model. Extraction uses rules and templates.

---

# Update 1: completion changes

Date: 18 Oct 2026. All work was done on the Grok Bot box against MariaDB 11.4.13 (the same version as your portable server). Nothing on your laptop was touched.

## Stack (unchanged)

- Backend: Node.js 22 (ESM), Express 4, mysql2, zod, JWT + bcrypt, AES-256-GCM connection secrets, exceljs, csv-parse/stringify, nodemailer, multer, vitest + supertest
- Frontend: React 18, Vite 6, Tailwind 3, React Router 6, react-hook-form, zod, vitest
- Database: MySQL 8 / MariaDB (`database/schema.sql`, `seed.sql`, `migrations/`)
- UiPath Studio project in `uipath/` (file handoff contract)

## Where it started

The project was further along than a skeleton. The backend API, native workflow engine, worker, job state machine, schedules, reports, and audit already existed. The original 19 backend tests and 1 frontend test passed, and the frontend built. The gaps were:

1. `npm run robot-simulator` pointed to `backend/src/robotSimulator.js`, which did not exist.
2. Migrations only knew `001_init`. There was no way to upgrade an existing `urap` database.
3. No Orchestrator-style work queues (Add Queue Item / Get Transaction Item / Set Transaction Status, queue triggers, retries).
4. Worker problems:
   - The SIGINT/SIGTERM handlers sat after an infinite loop, so they were never registered.
   - A job whose worker crashed stayed `RUNNING` forever.
   - Robot jobs could not be claimed, so two robots could take the same job.
5. Robot result bugs:
   - The wrong attempt number was used when a robot result came in after a retry.
   - Retrying a robot job did not rewrite the inbox file.
   - `syncRobotOutbox` picked up any file name.
6. Missing API features:
   - No workflow rename (PATCH).
   - No user edit/disable.
   - No robot list or token rotation.
   - No schedule enable/disable or history.
   - No notifications list or project file list.
   - Exports had no filters.
   - Invalid cron, time zone, or dates crashed with a 500 instead of returning 400.
   - Non-administrators could see every audit row.
7. Validation gaps:
   - File steps accepted absolute paths.
   - No `write_csv` or `log_message` activities.
8. Frontend gaps:
   - The designer could not set the retry policy, loop/branch targets, or timeouts.
   - Creating a workflow remounted the designer and lost unsaved steps.
   - Publish used stale state.
   - No project members/files UI, no queues page, no schedule controls, no robot/user administration, and no report filters.
9. `.env.example` pointed storage at `backend/data` (`./data/...`) and the DB at port 3306 with a placeholder password.

## What I did

### Backend

- **`db/migrate.js`**: applies `schema.sql` once as `001_init`, then every `database/migrations/NNN_*.sql` that is not yet recorded in `schema_migrations`. Your existing `urap` database upgrades in place with `npm run setup`. A test proves this on a 001-only database.
- **`database/migrations/002_work_queues.sql`**:
  - New tables `work_queues` and `queue_items`.
  - Item statuses NEW / IN_PROGRESS / SUCCESSFUL / FAILED / ABANDONED / DELETED.
  - Priorities, unique references, retry count, business vs application errors, defer/due dates, and locking by job or robot.
  - Adds the `queue` job trigger.
- **`services/queueService.js`**:
  - Add items, single or bulk up to 500. Duplicate references return 409.
  - Get next items with `FOR UPDATE SKIP LOCKED`, high priority first.
  - Set result: application errors retry up to the queue's limit; business errors are final.
  - Retry and delete items.
  - Release items left open when a job ends.
  - Mark items older than `QUEUE_ITEM_ABANDON_HOURS` as ABANDONED.
  - Queue triggers start the trigger workflow when NEW items exist and no trigger job is active.
- **New workflow activities**: `add_queue_item`, `get_queue_item`, `set_queue_item_status`, `write_csv` (with spreadsheet formula protection), `log_message`. All are validated.
- **Jobs**:
  - Step heartbeats.
  - `recoverStaleJobs` fails jobs with no heartbeat for `JOB_STALE_MINUTES` with a `WORKER_LOST` attempt, which can be retried.
  - Robot claim (`POST /api/robot/jobs/:id/claim`, 409 for a second claimant).
  - Fixed robot attempt numbering. Retrying a robot job rewrites the inbox file. MIME types on artifacts.
- **`worker.js`**:
  - Each tick: retries → schedules → queue triggers → robot outbox → native jobs.
  - Stale recovery and abandoned items run every 60 s.
  - Graceful shutdown.
- **`robotSimulator.js`** (new): a contract robot that is explicitly not UiPath.
  - Watches the inbox, sends a heartbeat, claims the job through the API, writes a report, and posts the result.
  - Without a token it writes to the outbox instead.
  - `ROBOT_FAIL_TASKS` makes chosen tasks fail on purpose. `--once` handles the inbox once and exits.
- **API additions**:
  - `PATCH /api/workflows/:id`, `PATCH /api/users/:id` (self-lockout protection; tokens revoked on disable or password change).
  - `GET /api/notifications`, `GET /api/projects/:id/files`.
  - `GET /api/robots`, `POST /api/robots/:id/rotate-token`.
  - Schedules: `/runs`, `/enable`, `/disable`.
  - Queues: CRUD and items, plus the robot queue API (`/api/robot/queues/:id/items`, `/next`, `/api/robot/queue-items/:id/result`).
  - Filtered CSV/XLSX exports.
  - Audit: scoping, filters, and new entries for workflow create, update, enable, and disable.
  - 400 errors for bad cron, time zone, and dates.
  - `executionType` defaults to `native`.
- **Security updates**:
  - nodemailer 6 → 10 (fixes the high-severity advisories); csv-parse 5 → 7. multer had already been moved to 2.x.
  - Remaining moderate advisories: exceljs → uuid (the only "fix" is a downgrade to exceljs 3), and react-router 6 (fixed only in v7, which would change the stack).

### Frontend

- **Workflow designer** (`WorkflowsPage.jsx`, new `lib/workflowGraph.js`):
  - Activity palette grouped Control / Data / Orchestrator / Integration / Robot.
  - Branch and loop target selectors, labelled coloured edges, per-step timeout and error policy, workflow retry policy.
  - Validation list and versions list.
  - Save keeps your steps (no remount). Publish uses the saved id. Run is enabled once the workflow is published.
  - Rename uses PATCH. The library has filters, Run, Clone, Enable, and Disable.
- **Projects**: category filter, edit, members (pick users), files (upload, list, download), archive.
- **Operations**:
  - Jobs: filters and auto refresh.
  - Job detail: live polling, attempts, step timeline with outputs, artifacts, retry/cancel by role.
  - Schedules: once or recurring, time zone (default Asia/Kolkata), overlap, input JSON, history, enable/disable.
  - Reports with filters and CSV/XLSX download.
  - Audit with action filter and paging.
  - Settings: robots (register, token shown once, rotate) and users (create, change role, enable/disable).
  - Connections hints.
- **New Queues page**: create queues, set retries, unique references, and trigger workflow; see counts; filter items; add items; retry/delete; pause or start the trigger.
- **Dashboard**: executions by day, links from recent errors to their jobs, in-app notifications.
- Status badges for the new statuses, and a favicon.

### Tests, scripts, docs

- **Backend: 33 tests** (19 original + 14 new).
  - New `test/platform.test.js` (11 tests): migrations and in-place upgrade, queues, triggers, robot queue API, robot claim with simulator and retry attempts, hybrid robot step, schedules, audit scope and user admin, upload → CSV → notification, stale-job recovery and filtered export, workflow rename and audit.
  - 3 more unit tests.
  - The original dashboard test was fixed so it no longer depends on test order.
- **Frontend: 8 tests**: graph helpers, every page renders for an administrator, API client.
- **`scripts/e2e-smoke.mjs`**: 22 end-to-end checks against a running stack.
- **`scripts/dev.ps1`**: starts the API, worker, and Vite (plus the robot with `-Robot`).
- **`.env.example`**: fixed paths (`../data/...`), the port 3307 URL, and the new settings documented.
- **Docs updated**: README, api-documentation, openapi.yaml, workflow-format, database-schema, testing-guide, installation-guide, uipath-setup.
- **Line endings**: all text files use CRLF, the same as your originals (some had become mixed).

## Verified on the box

- `npm install`, `npm run build` (frontend), `npm test`: backend 33/33 and frontend 8/8.
- `npm run setup` on an empty `urap` database, then again (idempotent). `schema_migrations` shows `001_init` and `002_work_queues`.
- API, worker, and Vite dev server running together, then `node scripts/e2e-smoke.mjs`: **22/22 passed**:
  - health and login;
  - project creation and CSV upload;
  - workflow create → draft → publish → run, executed by the real worker;
  - step log, and download of the Excel output;
  - a failed run with its error, then a manual retry (attempt 2);
  - a queue trigger running a performer workflow, with both items SUCCESSFUL;
  - a one-time schedule firing;
  - a `uipath` job claimed and completed by the contract robot;
  - CSV/XLSX export, dashboard, audit, notifications;
  - the frontend serving the app and proxying `/api`.
- Headless Chrome walkthrough of every page with no JavaScript errors. In the designer, adding a Log Message activity, then Publish, then Run, opened the job page showing a SUCCEEDED step timeline.

## Not done or not possible here

- No real UiPath Robot, Studio, or Orchestrator, and no SMTP server on the box. The UiPath XAML project was not executed. The robot path was tested with the contract simulator, which uses the same inbox/outbox and robot API contract.
- Docker was not run. `docker-compose.yml` is unchanged.
- Nothing was run on your Windows laptop. The PowerShell steps below were not executed on Windows.

## Run on Windows (PowerShell)

The paths assume the project lives at `C:\Users\Shravan\Desktop\UI Path\universal-rpa` and the portable MariaDB at `C:\Users\Shravan\Desktop\UI Path\.tools`.

### 1. Put the new code in place (keep your old folder as a backup)

```powershell
cd "C:\Users\Shravan\Desktop\UI Path"
Rename-Item universal-rpa universal-rpa-old
Expand-Archive -Path "$HOME\Downloads\universal-rpa-complete.zip" -DestinationPath "C:\Users\Shravan\Desktop\UI Path"
# If you already had a .env, bring it across:
Copy-Item .\universal-rpa-old\.env .\universal-rpa\.env -ErrorAction SilentlyContinue
```

### 2. Start MariaDB (leave this window open)

```powershell
cd "C:\Users\Shravan\Desktop\UI Path\universal-rpa"
powershell -ExecutionPolicy Bypass -File .\scripts\start-database.ps1
# same as:
# & "C:\Users\Shravan\Desktop\UI Path\.tools\mariadb-11.4.13-winx64\bin\mysqld.exe" --defaults-file="C:\Users\Shravan\Desktop\UI Path\.tools\mariadb-data\my.ini" --console
```

If the `urap` user does not exist yet (first-time setup only), run this in a new window:

```powershell
& "C:\Users\Shravan\Desktop\UI Path\.tools\mariadb-11.4.13-winx64\bin\mysql.exe" -u root -p -P 3307 -h 127.0.0.1 -e "CREATE USER IF NOT EXISTS 'urap'@'127.0.0.1' IDENTIFIED BY 'urap_dev_password'; GRANT ALL PRIVILEGES ON *.* TO 'urap'@'127.0.0.1'; FLUSH PRIVILEGES;"
```

### 3. Configure `.env` (in the project root, next to README.md)

```powershell
cd "C:\Users\Shravan\Desktop\UI Path\universal-rpa"
if (-not (Test-Path .env)) { Copy-Item .env.example .env }
node -e "console.log('CREDENTIALS_KEY=' + require('crypto').randomBytes(32).toString('base64'))"
node -e "console.log('JWT_SECRET=' + require('crypto').randomBytes(32).toString('hex'))"
notepad .env
```

In `.env`, set at least:

```
DATABASE_URL=mysql://urap:urap_dev_password@127.0.0.1:3307/urap
TEST_DATABASE_URL=mysql://urap:urap_dev_password@127.0.0.1:3307/urap_test
JWT_SECRET=<value printed above>
CREDENTIALS_KEY=<value printed above>   # keep your old key if you already stored connections
STORAGE_ROOT=../data/storage
ROBOT_ROOT=../data/robot
ADMIN_EMAIL=you@example.com
ADMIN_PASSWORD=<a strong password, 12+ characters>
```

### 4. Install and set up the database (applies migration 002 to your existing `urap` database)

```powershell
cd "C:\Users\Shravan\Desktop\UI Path\universal-rpa\backend"
npm install
npm run setup
cd ..\frontend
npm install
```

### 5. Run (three windows, or `scripts\dev.ps1`)

```powershell
# window 1
cd "C:\Users\Shravan\Desktop\UI Path\universal-rpa\backend"; npm start
# window 2
cd "C:\Users\Shravan\Desktop\UI Path\universal-rpa\backend"; npm run worker
# window 3
cd "C:\Users\Shravan\Desktop\UI Path\universal-rpa\frontend"; npm run dev
```

Or, in one step: `powershell -ExecutionPolicy Bypass -File .\scripts\dev.ps1` from the project root.

Open http://localhost:5173 and sign in with `ADMIN_EMAIL` / `ADMIN_PASSWORD`.

Optional contract robot (for `uipath` / hybrid workflows without UiPath):

1. Go to Settings → Register robot, choose the projects, and copy the token.
2. Put `ROBOT_TOKEN=<token>` in `.env`.
3. Run:

```powershell
cd "C:\Users\Shravan\Desktop\UI Path\universal-rpa\backend"; npm run robot   # robot-simulator still works
```

### 6. Tests

```powershell
cd "C:\Users\Shravan\Desktop\UI Path\universal-rpa\backend"
npm test            # uses and resets the urap_test database only
cd ..\frontend
npm test
npm run build
# With API, worker and Vite running:
cd ..
node scripts\e2e-smoke.mjs
```
