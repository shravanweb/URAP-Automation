# Requirements

URAP is a multi-project automation platform. Categories such as ERP, CRM, HR, finance, files, web, API, email, testing, and reporting describe a project. They do not imply that every business task runs without its own workflow configuration.

## Functional

- Register, edit, search, sort, filter, and archive projects.
- Store project connections, workflows, versions, schedules, jobs, and activity.
- Build a versioned JSON workflow, validate it, publish it, clone it, and enable or disable it.
- Execute supported native steps in a worker and persist each attempt and step.
- Retry a failed job without deleting the failed attempt.
- Cancel a queued job, or request cancellation of a running job between steps.
- Schedule a one-time or recurring run in a time zone and skip overlap when configured.
- Export execution reports as CSV and Excel.
- Download artifacts only for users who can access the project.
- Hand UiPath work to a robot through the documented file contract or robot API.

## Security

- Bcrypt password hashes and hashed refresh tokens.
- Role checks for administrator, project manager, automation developer, operator, and viewer.
- Non-administrators only see projects where they are members.
- Robot tokens are shown once and stored as SHA-256 hashes. A robot only reads jobs for its projects.
- Connection secrets use AES-256-GCM with `CREDENTIALS_KEY` outside the database.
- Logs and API connection responses redact secret-like fields.
- Ordinary users cannot submit arbitrary JavaScript, shell commands, or SQL.

## Out of scope for an unattended run

Browser steps and UiPath steps do not succeed unless a robot heartbeat is current and a result is returned. Email sending requires a mailbox that accepts the configured SMTP connection. PDF extraction reads literal text, not scanned images.
