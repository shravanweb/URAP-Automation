# API

The machine-readable list is `docs/openapi.yaml`. Responses use `{ "data": ..., "meta": ... }` or `{ "error": { "code", "message", "details" } }`.

Send `Authorization: Bearer <accessToken>` for user routes and the robot token for `/api/robot/*`.

| Method | Path | Purpose |
| --- | --- | --- |
| POST | `/api/auth/login` | Email and password |
| GET | `/api/auth/options` | Public: `{ allowSignup, passwordReset, passwordMinLength }` for the sign-in and sign-up pages |
| POST | `/api/auth/signup` | Public self sign-up `{ displayName, email, password, organization, acceptTerms: true }`. Returns the same session as login plus `projectId` (HTTP 201). 403 `SIGNUP_DISABLED` when `ALLOW_SIGNUP=false`, 409 `EMAIL_IN_USE`, 429 `RATE_LIMITED` after `SIGNUP_RATE_LIMIT_MAX` attempts per window and client |
| POST | `/api/auth/refresh` | Rotate a refresh token |
| POST | `/api/auth/logout` | Revoke a refresh token |
| GET | `/api/auth/me` | Current user |
| GET, POST | `/api/users` | Administrator user management |
| PATCH | `/api/users/{id}` | Change name, role, status, or password (tokens are revoked on disable or password change) |
| GET | `/api/categories` | Suggested categories |
| GET | `/api/connectors` | Connector catalog |
| GET | `/api/dashboard` | Database metrics, including `suspendedJobs` |
| GET, POST | `/api/projects` | List and create |
| GET, PATCH | `/api/projects/{id}` | Read and update |
| POST | `/api/projects/{id}/archive` | Archive |
| GET, POST, DELETE | `/api/projects/{id}/members` | Membership |
| GET | `/api/projects/{id}/activity` | Project audit |
| GET, POST | `/api/projects/{id}/files` | List and upload project files |
| GET, POST | `/api/projects/{id}/connections` | Connections |
| POST | `/api/connections/{id}/test` | Connection test |
| GET, POST | `/api/workflows` | List and create |
| GET, PATCH | `/api/workflows/{id}` | Read; rename or change description and execution type |
| POST | `/api/workflows/{id}/draft` | Save a draft |
| POST | `/api/workflows/{id}/validate` | Validate without publishing |
| POST | `/api/workflows/{id}/publish` | Publish the current draft |
| POST | `/api/workflows/{id}/clone` | Clone |
| POST | `/api/workflows/{id}/enable` and `/disable` | Availability |
| POST | `/api/workflows/{id}/run` | Queue a job, HTTP 202 |
| GET | `/api/jobs` and `/api/jobs/{id}` | Monitoring |
| POST | `/api/jobs/{id}/retry` and `/cancel` | Control |
| GET, POST | `/api/schedules` | Schedules (cron and time zone are validated) |
| GET | `/api/schedules/{id}/runs` | Schedule history |
| POST | `/api/schedules/{id}/enable` and `/disable` | Enabling recomputes the next run |
| GET, POST | `/api/queues` | Work queues |
| GET, PATCH | `/api/queues/{id}` | Queue with item counts; update retries, trigger, status |
| GET, POST | `/api/queues/{id}/items` | List items (`status`, `reference`); add one item or `{ "items": [...] }` (up to 500) |
| POST | `/api/queue-items/{id}/retry` and `/delete` | Requeue a failed or abandoned item; delete a new item |
| GET | `/api/notifications` | In-app notifications for accessible projects |
| GET | `/api/reports/executions` | Execution report |
| GET | `/api/reports/export.csv` and `.xlsx` | Downloads; accept `projectId`, `workflowId`, `status`, `from`, `to` |
| GET | `/api/artifacts/{id}/download` | Authorized file |
| GET | `/api/audit` | Audit log (`action`, `projectId`); non-administrators see their projects and their own actions |
| GET | `/api/settings` | Tenant and robot heartbeat state |
| GET, POST | `/api/robots` | List robots; register a robot, returns the token once |
| POST | `/api/robots/{id}/rotate-token` | New token; the old one stops working |
| POST | `/api/robot/heartbeat` | Robot availability |
| GET | `/api/robot/queue` | Jobs the robot may see |
| POST | `/api/robot/jobs/{id}/claim` | Take a queued robot job (409 if another robot has it) |
| POST | `/api/robot/queues/{id}/items` | Add queue items |
| POST | `/api/robot/queues/{id}/next` | Get the next transaction item, or `null` |
| POST | `/api/robot/queue-items/{id}/result` | `SUCCESSFUL` or `FAILED` with `errorType` `business` or `application` |
| POST | `/api/robot/jobs/{id}/result` | `SUCCEEDED` or `FAILED` only; optional `steps` log is stored in the job timeline |
| GET | `/api/robot/jobs/{id}/package` | Workflow definition and input for a claimed job (the robot agent runs it) |
| POST | `/api/robot/jobs/{id}/artifacts` | Multipart upload of a file the robot produced (job must be `RUNNING`) |
| GET | `/api/tasks` | Action Center tasks (`status` pending, completed, cancelled, all; `projectId`, `type`, `jobId`, `mine=true`) |
| GET | `/api/tasks/summary` | `{ pending, mine, overdue }` |
| GET | `/api/tasks/{id}` | One task with form, data, and `canComplete` |
| POST | `/api/tasks/{id}/complete` | `{ outcome, data, comment }`; resumes the suspended job, returns `resumedJobId` |
| POST | `/api/tasks/{id}/assign` | `{ userId }`; omit to assign yourself, `null` to release |
| POST | `/api/recorder/sessions` | Start a web recorder session `{ url, headless? }` |
| GET | `/api/recorder/sessions/{id}` | Recorded events, picked selectors, and generated steps |
| POST | `/api/recorder/sessions/{id}/mode` | `{ mode: "record" \| "pick" }` |
| POST | `/api/recorder/sessions/{id}/stop` | Close the browser |
| GET | `/api/health` | Database ping |

List endpoints accept `limit` and `offset`. Project lists also accept `search`, `status`, `category`, `sort`, and `order`. `Idempotency-Key` on run returns the original job when the same key is repeated.

Job status `SUSPENDED` means the job waits for an Action Center task. Project file upload also accepts PNG, JPEG, TIFF, and BMP images (signature checked) for OCR.
