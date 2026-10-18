# URAP UiPath package

This folder is a UiPath Studio project. It implements the platform file contract. It does not connect to Orchestrator unless you configure that separately.

## Contract

The platform writes `data/robot/inbox/{jobId}.json` when a workflow with execution type `uipath` is queued. The file contains `jobId`, `projectId`, `workflowId`, `workflowVersionId`, `correlationId`, `task`, `input`, `connectionRefs`, and `reportPath`.

The robot writes `data/robot/outbox/{jobId}.json`:

```json
{
  "jobId": "",
  "correlationId": "",
  "executionStatus": "SUCCEEDED",
  "output": { "reportPath": "", "task": "ExecuteSupportedTask" },
  "startedAt": "",
  "completedAt": "",
  "errorCode": null,
  "errorMessage": null,
  "retryable": false
}
```

`executionStatus` must be `SUCCEEDED` or `FAILED`. The platform worker moves a valid file to `processed` and only then marks the job. Writing the inbox file does not mark the job successful.

## Workflows

- `Workflows/Initialize.xaml` records the UTC start.
- `Workflows/RetrieveWork.xaml` reads the assigned inbox file.
- `Workflows/ValidateInputs.xaml` checks `jobId`, `projectId`, `workflowId`, and `correlationId`.
- `Workflows/ExecuteTask.xaml` builds the supported-task report text.
- `Workflows/GenerateReport.xaml` formats the output report.
- `Workflows/ReportResults.xaml` builds the success result.
- `Workflows/HandleException.xaml` builds a failed result.
- `Workflows/Finalize.xaml` writes the result file.
- `Main.xaml` calls these workflows.

## Run with the installed robot

UiPath Robot was not installed on the machine used to build this repository, so this package was not executed here. After Studio restores the dependencies for your installation:

```text
UiRobot.exe execute --file "C:\path\to\uipath\Main.xaml" --input "{'in_InboxFile':'C:\\path\\inbox.json','in_ReportPath':'C:\\path\\report.txt','in_ResultPath':'C:\\path\\outbox.json'}"
```

Confirm the exact arguments with `UiRobot.exe --help` for the installed version. Copy the result file into the platform outbox if the robot did not write it there directly. Register the robot in Settings only after you have a token, and treat it as available only when the heartbeat endpoint has been called in the last minute.

The Node contract processor in `backend/src/robotContract.js` checks the same required fields for automated tests. It is not UiPath.
