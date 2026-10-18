# User manual

Open `http://localhost:5173`. The homepage describes the platform. **Try URAP free** opens the sign-up page.

## Accounts

- **Sign up**: full name, work email, organization name, a password of at least 12 characters with letters and numbers (the strength meter is a guide), and acceptance of the terms. The account is created as a project manager (configurable with `SIGNUP_ROLE`) with a starter project called "<organization> workspace", and you are signed in. Administrators can turn sign-up off with `ALLOW_SIGNUP=false`.
- **Sign in**: email and password. *Keep me signed in on this device* keeps the session after the browser closes; otherwise it ends with the tab. Show the password with the eye button.
- **Forgot password**: there is no reset email. Ask an administrator, who uses Settings → Users → **Reset password** and shares the temporary password shown once. A locked-out administrator runs `npm run reset-password -- you@company.com` in `backend` on the server.

## Projects

Create a project with a name, description, and category. Categories loaded from the database are suggestions. Archive asks for confirmation. Archived projects cannot run jobs.

Search, status, sort, and order apply to the project list.

## Workflows

Open Workflow Builder, choose the project, name the workflow, and choose Native, UiPath, or Hybrid execution.

Add steps from the activity palette (search box at the top; groups for Web, Desktop, Documents, Action Center, Integration, data, and queues), reorder them, and set arguments in the property panel of the selected step. The panel and the "All arguments (JSON)" editor stay in sync. Target element fields take a selector, a selector type (Auto, CSS, XPath, Text, Role, Label, Placeholder, Test id), a match number, and an optional frame.

**Record web** opens a browser on the API machine. Click and type through the site, then Stop and Insert steps. Pick an element returns ranked selectors for the selected step's target. On a server without a screen use `npm run record -- <url>` on your PC, or record with `npx playwright codegen` and paste the code under Import Playwright codegen. Passwords are not recorded; choose a Credential connection on the generated Type Into step. `Start` must reach `End`. Save a draft, validate, then publish. Queue test run sends the input JSON and opens the job. The page does not mark the job successful.

A native example that checks rows:

```json
{
  "rows": [{ "sku": "A" }, { "sku": "A" }]
}
```

Use a `validate_data` step whose source is `{{input.rows}}` and a `write_excel` step whose path is `out/orders.xlsx`.

## Connections

Create a connection with non-secret config and, when needed, a secret JSON object. Test it. The secret is not shown again. A failed test leaves the connection unavailable.

Credential connections hold a username and password for Type Into steps. PostgreSQL connections take host, port, database, and user, with the password as the secret. Google Sheets connections take the spreadsheet id and the service-account JSON key as the secret.

## Action Center

Workflows with a Create Task step pause as `SUSPENDED` until someone acts. Action Center (the count in the navigation is the pending number) lists tasks with filters for status, type, and Assigned to me. Open a task to see its data, fill in the form, add a comment, and press an outcome such as Approve or Reject. The job continues from the next step. Assign to me and Release change who owns the task.

## Jobs

The list shows the status stored for each job. Open a job for attempts, the step timeline, errors, and artifact downloads. Retry and cancel are sent to the server, which applies the state machine. Retrying a job that is already queued returns that same job.

## Schedules

Choose a published workflow, a name, once or recurring, a cron expression such as `*/15 * * * *`, and a time zone such as `UTC` or `Asia/Kolkata`. The next run is stored in the database. Overlap is skipped while an earlier job for that schedule is still active.

## Reports and audit

Reports list executions and download CSV or Excel. Audit lists recorded actions for the tenant.

## Settings

Settings shows the tenant and whether each robot has a heartbeat from the last minute. Creating a robot record does not make it connected. Administrators can create users. New passwords must be at least 12 characters.

## Roles

Administrators see every project in the tenant. Other roles only see projects they belong to. Viewers cannot create projects or run jobs. Operators can run, retry, and cancel. Automation developers can edit workflows and connections. Project managers can manage projects, members, and schedules.
