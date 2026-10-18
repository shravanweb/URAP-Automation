# Demonstration script

Expected result: a published native workflow runs in the worker, a failed attempt is kept, a corrected retry succeeds, and the dashboard counts change because the database changed.

1. Start MariaDB, `npm run setup`, `npm start`, `npm run worker`, and `npm run dev` as written in `docs/installation-guide.md`.
2. Sign in as `admin@example.com` with the password in `.env`.
3. Open Dashboard. With no projects, the project count is 0. This is the database count, including an empty installation.
4. Create project `Order quality`, category `ecommerce`.
5. Refresh Dashboard. Total projects and active projects increase by one. Successful executions stay at the previous database value.
6. Open Workflow Builder. Select the project, name the workflow `Validate orders`, and keep Native execution.
7. Add `validate_data` between Start and End. Set Start's next step to the validation step and the validation step's next step to End. Use this config:

```json
{
  "source": "{{input.rows}}",
  "mode": "fail_workflow",
  "rules": [{ "field": "sku", "checks": ["required"] }]
}
```

8. Publish. Queue a test run with `{ "rows": [{ "sku": "" }] }`.
9. Open the job. Wait for the worker. Status becomes `FAILED`. The attempt list has one failed attempt. The job is not successful.
10. An operator can retry after the input is corrected through the API. The UI retry reuses the same input, so a second run with an empty SKU fails again. Use the API for the corrected input:

```powershell
$login = Invoke-RestMethod -Method Post -Uri http://127.0.0.1:4000/api/auth/login -ContentType 'application/json' -Body '{"email":"admin@example.com","password":"ChangeMe-Admin-1"}'
$headers = @{ Authorization = "Bearer $($login.data.accessToken)" }
Invoke-RestMethod -Method Post -Uri http://127.0.0.1:4000/api/jobs/<jobId>/retry -Headers $headers
```

Update the queued input only in a maintenance console if you need to demonstrate the corrected row. The automated test does this and then observes `SUCCEEDED`, two attempts, and an Excel artifact.

11. Return to Dashboard and refresh. Failed and successful execution counts match the jobs stored for the tenant.
12. For the robot portion, publish a workflow with execution type UiPath and queue it. Show that the status remains `QUEUED` and that `data/robot/inbox/<jobId>.json` exists. Do not describe the robot as connected. Completing that job requires the result contract in `uipath/README.md`.
