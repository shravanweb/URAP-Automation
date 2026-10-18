# Project report

URAP is a modular automation platform for more than one business domain. Projects own workflows, connections, schedules, and jobs. Workflow definitions are versioned JSON. The worker executes published native steps and stores attempts separately from the queue record.

## What was implemented

- MySQL schema with foreign keys, unique keys, indexes, and UTC timestamps.
- JWT authentication, bcrypt passwords, role checks, and project membership.
- Project, workflow, connection, schedule, report, artifact, audit, and robot APIs.
- A native engine for the listed step types, with template substitution rather than JavaScript evaluation.
- A database queue with conditional claims, retries that keep prior attempts, and cancellation.
- Encrypted connection secrets and redacted logs.
- A UiPath Studio package and file/API handoff. The package was not run by UiPath Robot because that product is not installed here.
- A React application for the ten navigation areas.
- Backend and frontend tests. The latest backend run is recorded in the testing guide's command. Re-run `npm test` rather than treating this paragraph as a substitute for the test output.

## Limits

- PDF support extracts literal text, not OCR.
- Browser steps require a live robot heartbeat and a result file.
- Orchestrator calls are not made unless the environment contains a base URL, token, and release key.
- The local MariaDB account used for development has broad privileges. Production should narrow that grant.
- The workflow builder edits step config as JSON rather than a separate form for every step type.

## Acceptance mapping

Users can create multiple projects and multiple workflows. Workflows are validated, versioned, and published. Native steps in the automated test execute and persist step results. Failed jobs retain the failed attempt and can be retried. A local HTTP connector failure is recorded and a later retry can succeed. Schedules skip overlapping runs. Reports export CSV and Excel. Authorization and secret redaction are covered by tests. The UiPath result path is covered by the file contract test, not by a robot process on this machine.
