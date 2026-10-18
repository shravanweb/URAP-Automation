# Database schema

The canonical script is `database/schema.sql`. `database/seed.sql` inserts the default tenant, use-case categories, and connector catalog. It does not insert users, passwords, tokens, or job history.

`backend/src/db/migrate.js` creates the database, applies `schema.sql` once (recorded as `001_init` in `schema_migrations`), then applies each `database/migrations/NNN_*.sql` file that is not yet recorded, and reapplies the reference seed. An existing database upgrades in place with `npm run setup` or `npm run migrate`.

`002_work_queues.sql` adds `work_queues` and `queue_items` and allows the `queue` job trigger.

`003_action_center.sql` adds `action_tasks` (type approval, form, or validation; status `pending`, `completed`, `cancelled`; form and data JSON, outcomes, assignee or role, due time, result and completer), adds `resume_state_json` to `automation_jobs`, and allows the `SUSPENDED` job and attempt status. The reference seed, reapplied by `npm run setup`, adds the `postgres`, `google_sheets`, and `credential` connectors.

Timestamps are `DATETIME(3)` written with `UTC_TIMESTAMP(3)`.

## Tables

- `tenants`, `users`, `refresh_tokens`
- `use_case_categories` reference labels. A project may still store a custom category.
- `projects`, `project_members`
- `connectors`, `connections` with AES-256-GCM secret columns
- `workflows`, `workflow_versions`, `workflow_steps`
- `schedules`, `schedule_runs`
- `automation_robots`, `robot_project_access`
- `automation_jobs`, `job_attempts`, `job_step_runs`
- `artifacts`, `notifications`, `audit_logs`
- `action_tasks` linked to a job, the step id, and the project
- `work_queues` (retry limit, unique references, trigger workflow) and `queue_items` (status `NEW`, `IN_PROGRESS`, `SUCCESSFUL`, `FAILED`, `ABANDONED`, `DELETED`; priority; retry count; error type; locking job or robot)

Foreign keys link jobs to a project and a workflow version. Unique keys cover tenant email, workflow version number, job attempt number, and the tenant idempotency key. Queue lookups use `(execution_target, status, available_at, priority, queued_at)`.

Status values are checked by the table constraints and again by `workflow/stateMachine.js` before an update. The update also includes the previous status in the `WHERE` clause.

## Backup

```powershell
& "C:\Users\Shravan\Desktop\UI Path\.tools\mariadb-11.4.13-winx64\bin\mysqldump.exe" -u urap -p -P 3307 -h 127.0.0.1 --routines --triggers urap > urap-backup.sql
```

Restore by creating an empty database and running:

```powershell
& "C:\Users\Shravan\Desktop\UI Path\.tools\mariadb-11.4.13-winx64\bin\mysql.exe" -u urap -p -P 3307 -h 127.0.0.1 urap < urap-backup.sql
```

Back up `data/storage` with the database. The dump does not include encryption keys. Restoring without the same `CREDENTIALS_KEY` makes stored connection secrets unreadable. Do not put that key in the backup file.
