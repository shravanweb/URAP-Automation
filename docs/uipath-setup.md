# UiPath setup

Read `uipath/README.md` for the input and result contract.

1. Open `uipath/project.json` in UiPath Studio.
2. Restore the System, Excel, and UI Automation packages that match the installed Studio version. The versions in `project.json` are a starting point, not a claim that they were restored here.
3. Run `Main.xaml` with `in_InboxFile`, `in_ReportPath`, and `in_ResultPath`.
4. Confirm `UiRobot.exe --help` before relying on a command line. A typical recent form is `UiRobot.exe execute --file Main.xaml --input "{...}"`.
5. Register a platform robot with adapter `local_file_handoff` and the project ids it may process. Store the returned token in a Studio asset or an Orchestrator asset. Do not put it in the XAML file.
6. Call `POST /api/robot/heartbeat` with that token on a schedule if you want the platform to show the robot as available. Without a heartbeat in the last 60 seconds, Settings shows that there is no recent heartbeat.
7. Claim the job with `POST /api/robot/jobs/{id}/claim` so no other robot takes it.
8. Either post the result to `POST /api/robot/jobs/{id}/result` or write the result JSON into `data/robot/outbox`. The worker accepts `SUCCEEDED` or `FAILED`.

Orchestrator is optional. Set `ORCHESTRATOR_BASE_URL`, `ORCHESTRATOR_TOKEN`, `ORCHESTRATOR_RELEASE_KEY`, and `ORCHESTRATOR_ORGANIZATION_UNIT_ID` only when you have a real tenant. This installation did not have Orchestrator, and the platform does not invent a connected robot.

UiPath Robot was not installed during development. The automated test checks that the XAML files exist and that the Node contract processor, which is not UiPath, validates the same fields and writes a report. A real robot run is a separate manual test after Studio is installed.

## URAP robot agent

`npm run robot` in `backend` (the same program as `npm run robot-simulator`) is the URAP robot agent. After it claims a job it downloads `GET /api/robot/jobs/{id}/package`.

- When the definition has real steps (anything besides Start and End), the agent runs browser, desktop, OCR, document, and data steps on its own machine with the same engine as the worker, uploads produced files (screenshots) to `POST /api/robot/jobs/{id}/artifacts`, and posts the result with the step log. Install Chromium on the robot machine (`npx playwright install chromium`). Desktop steps need a signed-in, unlocked Windows session (see `desktop-automation.md`).
- Server-only steps (HTTP, database, file connections, queues, notifications, sub-workflows, Action Center, Google Sheets) fail the job with `ROBOT_UNSUPPORTED` before anything runs.
- A Start → End definition keeps the report-file contract below.

Without `ROBOT_TOKEN` (file mode) the agent can run the steps from the inbox file but cannot upload artifacts.

## Contract robot simulator

`npm run robot-simulator` in `backend` watches `data/robot/inbox`, claims each job through the API when `ROBOT_TOKEN` is set, writes a report, and posts the result (or writes `data/robot/outbox` without a token). `ROBOT_FAIL_TASKS=TaskA,TaskB` makes those tasks fail. Use it to test the platform without UiPath. It is not UiPath and does not automate any user interface.
