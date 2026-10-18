# Universal RPA Automation Platform

URAP registers projects, versions workflow definitions, queues jobs, executes supported native steps in a worker, and records attempts, step results, artifacts, schedules, and audit events in MySQL. A workflow is not successful because it was saved or queued.

## Verified on this machine

- Node.js 22.23 and npm 10.9
- MariaDB 11.4.13 on `127.0.0.1:3307` for local development
- Docker and UiPath Robot are not installed here. Compose files are included. The UiPath package was not executed by a real robot; `npm run robot-simulator` is a contract robot that speaks the same file and API contract and is clearly not UiPath.

Tests: **backend 68 passed**, **frontend 22 passed** (`npm test` in each folder). `node scripts/e2e-smoke.mjs` runs 38 end-to-end checks against a running API, worker, and Vite server, including real Chromium runs and OCR. Desktop (Windows UI Automation) activities are unit-tested with mocks only; they were not run against real Windows applications here.

## Features

- Public site: landing page, self sign-up (`ALLOW_SIGNUP`, default on), sign-in with remember me, and an administrator-assisted password reset (`npm run reset-password -- <email>` for a locked-out administrator)
- Projects with members, files (upload, list, download), categories, archive
- Visual workflow designer: activity palette, branches, loops, retry policy, timeouts, error policy, validation, versions, publish, run
- Native activities: Excel/CSV/PDF read, Excel/CSV write, transform, validate, duplicates, if/else, for each, HTTP, database, file operations, notifications, sub-workflows, log message
- Orchestrator-style work queues: Add Queue Item, Get Transaction Item, Set Transaction Status, priorities, unique references, automatic retry of application errors, abandoned item detection, queue triggers
- Jobs with attempts, step timeline, artifacts, retry and cancel; stale-job recovery when a worker dies
- Schedules (once, recurring cron with time zone, overlap policy) with history and enable/disable
- Robots: registration, token rotation, heartbeat, job claim, queue API, file handoff for UiPath
- Web UI automation with Playwright: Open Browser, Navigate, Click, Type Into, Select Item, Get Text, Extract Table Data (with pagination), Wait For Element, Take Screenshot, Close Browser; CSS, XPath, text, role, label, placeholder, and test-id selectors; a recorder and selector picker in the designer, `npm run record`, and Playwright codegen import
- Windows desktop automation through UI Automation (Open Application, Attach Window, Click, Type Into, Send Hotkey, Get Text, Close Window) behind a driver adapter; see `docs/desktop-automation.md`
- OCR (tesseract.js, PDF text layer first) and document understanding with invoice, receipt, and purchase-order templates, custom regex fields, and confidence scores
- Action Center: approval, form, and validation tasks that suspend a job until a person completes them, then resume it
- Connectors: HTTP/REST (query, headers, Basic/Bearer/API key), MySQL and PostgreSQL queries (approved operations or read-only SQL), Google Sheets (service account), Credential connections for passwords
- URAP robot agent (`npm run robot`) that runs web, desktop, OCR, and data steps on the robot machine
- Reports with filters and CSV/Excel export, scoped audit log, in-app notifications, user administration

## Install

```powershell
cd backend
npm install
cd ..\frontend
npm install
```

Create `.env` from `.env.example`. Generate a real credentials key:

```powershell
node -e "console.log(require('crypto').randomBytes(32).toString('base64'))"
```

Install the browser for web automation once:

```powershell
cd backend
npx playwright install chromium
```

Start MariaDB with `scripts\start-database.ps1` (see `docs/installation-guide.md`), then:

```powershell
cd backend
npm run setup
npm start
```

In a second terminal:

```powershell
cd backend
npm run worker
```

In a third terminal:

```powershell
cd frontend
npm run dev
```

Open `http://localhost:5173`. The setup administrator is the `ADMIN_EMAIL` account. Seed data does not contain a password.

`scripts\dev.ps1` opens the API, worker, and Vite windows in one step (`-Robot` also starts the robot agent).

## Layout

- `frontend` React, Vite, Tailwind, React Router, React Hook Form, and Zod
- `backend` Express API, worker, native workflow engine, connectors, and scheduler
- `database` schema, seed reference data, and incremental migrations (`database/migrations`)
- `uipath` Studio project for the file handoff contract
- `docs` architecture, API, automation activities (`automation-activities.md`), desktop automation, database, operations, and the demonstration script

## Queue

Jobs are stored in `automation_jobs`. The worker claims a native job with a conditional update so two workers cannot own the same row, then executes the published definition outside the HTTP request. Robot jobs stay `QUEUED` until a robot claims them (`POST /api/robot/jobs/{id}/claim`) and a result file or the robot API reports `SUCCEEDED` or `FAILED`. A job whose worker stops sending step heartbeats for `JOB_STALE_MINUTES` is failed with `WORKER_LOST` and can be retried.
