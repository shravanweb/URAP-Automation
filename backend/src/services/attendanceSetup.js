// Creates the RewaHR attendance automation for a user: a Credential connection for the password
// (left empty: the user enters it in the UI), two published workflows (Punch In, Punch Out), and
// two recurring schedules. Running it again updates the workflows and keeps what already exists.
// It never sets, reads, or prints a password.
import crypto from 'node:crypto';
import { writeAudit } from '../db/audit.js';
import { nextRun } from '../scheduler/cron.js';
import { validateDefinition } from '../workflow/validate.js';
import { MISSING_PASSWORD_MESSAGE, PUNCH_PAGE_HASH } from '../automation/web/flutterAttendance.js';

export const REWAHR_URL = 'https://d3eindia.rewahr.com/#login%20page';
export const CREDENTIAL_NAME = 'REWAHR_PASSWORD';
export const TIMEZONE = 'Asia/Kolkata';
export const PROJECT_NAME = 'RewaHR Attendance';
export const PUNCHES = [
  { action: 'in', workflow: 'RewaHR Punch In', schedule: 'RewaHR Punch In 09:10 (Mon-Fri)', cron: '10 9 * * 1-5' },
  { action: 'out', workflow: 'RewaHR Punch Out', schedule: 'RewaHR Punch Out 17:45 (Mon-Fri)', cron: '45 17 * * 1-5' },
];

const sqlDate = (date) => new Date(date).toISOString().slice(0, 23).replace('T', ' ');

/**
 * The workflow definition, one designer activity per stage. The email is a run argument; the
 * password comes from the credential and is only used by the Log in step.
 */
export function attendanceDefinition({ action, credentialId, url = REWAHR_URL }) {
  const button = action === 'in' ? 'IN' : 'OUT';
  const label = action === 'in' ? 'Punch In' : 'Punch Out';
  const common = { action, punchInText: 'IN', punchOutText: 'OUT', screenshotFolder: `screenshots/rewahr/punch-${action}`, timeoutMs: 45000 };
  return {
    schemaVersion: '1.0',
    retryPolicy: { maxAttempts: 1, backoffSeconds: 0 },
    timeoutMs: 300000,
    steps: [
      { id: 'start', type: 'start', name: 'Start', next: 'open' },
      { id: 'open', type: 'browser_open', name: 'Open RewaHR', config: { url, browser: 'chromium', headless: true, width: 1366, height: 768, timeoutMs: 30000 }, next: 'login' },
      {
        id: 'login', type: 'browser_flutter_attendance', name: 'Log in', timeoutMs: 120000,
        config: { ...common, phase: 'login', email: '{{input.email}}', credentialId, credentialField: 'password', missingCredentialMessage: MISSING_PASSWORD_MESSAGE, emailLabel: 'Email', passwordLabel: 'Password', loginTexts: ['Login'] },
        next: 'attendance',
      },
      {
        id: 'attendance', type: 'browser_flutter_attendance', name: 'Go to Attendance', timeoutMs: 90000,
        config: { ...common, phase: 'attendance', menuTexts: ['Attendance'], punchPageUrl: PUNCH_PAGE_HASH, tabTexts: ['Punch In/Out'] },
        next: 'punch',
      },
      { id: 'punch', type: 'browser_flutter_attendance', name: `${label} (click ${button})`, timeoutMs: 90000, config: { ...common, phase: 'punch' }, next: 'verify' },
      { id: 'verify', type: 'browser_flutter_attendance', name: 'Verify', timeoutMs: 60000, config: { ...common, phase: 'verify', previousStatus: '{{steps.punch.status}}', successTimeoutMs: 20000 }, next: 'close' },
      { id: 'close', type: 'browser_close', name: 'Close browser', next: 'record' },
      { id: 'record', type: 'log_message', name: 'Record result', config: { level: 'info', message: `RewaHR ${label}: {{steps.verify.status}} (punch step {{steps.punch.status}}, confirmed {{steps.verify.confirmed}})` }, next: 'end' },
      { id: 'end', type: 'end', name: 'End' },
    ],
  };
}

/** Run input stored on each schedule. */
export function scheduleInput(email) {
  return { email };
}

async function materialize(pool, versionId, definition) {
  await pool.query(`DELETE FROM workflow_steps WHERE workflow_version_id = ?`, [versionId]);
  for (let index = 0; index < definition.steps.length; index += 1) {
    const step = definition.steps[index];
    await pool.query(
      `INSERT INTO workflow_steps (id, workflow_version_id, step_key, step_type, name, position, config_json, timeout_ms, error_policy)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [crypto.randomUUID(), versionId, step.id, step.type, step.name, index, JSON.stringify(step.config || {}), step.timeoutMs || null, step.errorPolicy || 'fail'],
    );
  }
}

async function publish(pool, workflow, definition, userId, connectionIds, connectionTypes) {
  const validation = validateDefinition(definition, { connectionIds, connectionTypes });
  if (!validation.valid) throw new Error(`Attendance workflow is invalid: ${JSON.stringify(validation.errors)}`);
  const [current] = workflow.current_version_id ? await pool.query(`SELECT definition_json FROM workflow_versions WHERE id = ?`, [workflow.current_version_id]) : [[]];
  if (current[0] && JSON.stringify(current[0].definition_json) === JSON.stringify(validation.definition)) return false;
  const [maxRows] = await pool.query(`SELECT COALESCE(MAX(version_number), 0) AS n FROM workflow_versions WHERE workflow_id = ?`, [workflow.id]);
  const versionId = crypto.randomUUID();
  await pool.query(`UPDATE workflow_versions SET status = 'retired' WHERE workflow_id = ? AND status IN ('published', 'draft')`, [workflow.id]);
  await pool.query(
    `INSERT INTO workflow_versions (id, workflow_id, version_number, status, definition_json, validation_json, published_at, created_by, created_at)
     VALUES (?, ?, ?, 'published', ?, ?, UTC_TIMESTAMP(3), ?, UTC_TIMESTAMP(3))`,
    [versionId, workflow.id, Number(maxRows[0].n) + 1, JSON.stringify(validation.definition), JSON.stringify(validation), userId],
  );
  await materialize(pool, versionId, validation.definition);
  await pool.query(`UPDATE workflows SET status = 'published', current_version_id = ?, updated_at = UTC_TIMESTAMP(3) WHERE id = ?`, [versionId, workflow.id]);
  await writeAudit(pool, { tenantId: workflow.tenant_id, userId, action: 'workflow.publish', entityType: 'workflow', entityId: workflow.id, projectId: workflow.project_id, metadata: { versionId, source: 'setup:rewahr' } });
  return true;
}

/**
 * Sets up the automation in the owner's project. Options: ownerEmail (the project owner and run
 * argument email), tenantId (default: the owner's tenant), projectId (default: the owner's first
 * active project; when they have none, a "RewaHR Attendance" project is created for them).
 */
export async function ensureRewahrAttendance(pool, { ownerEmail, email = ownerEmail, tenantId, projectId } = {}) {
  const [users] = await pool.query(`SELECT * FROM users WHERE email = ?${tenantId ? ' AND tenant_id = ?' : ''} ORDER BY created_at LIMIT 1`, tenantId ? [ownerEmail, tenantId] : [ownerEmail]);
  const owner = users[0];
  if (!owner) throw new Error(`No user ${ownerEmail}`);
  const [projects] = projectId
    ? await pool.query(`SELECT * FROM projects WHERE id = ? AND tenant_id = ?`, [projectId, owner.tenant_id])
    : await pool.query(`SELECT * FROM projects WHERE tenant_id = ? AND created_by = ? AND status = 'active' ORDER BY created_at LIMIT 1`, [owner.tenant_id, owner.id]);
  let project = projects[0];
  if (!project && projectId) throw new Error(`Project ${projectId} was not found in the owner's tenant`);
  const created = [];
  if (!project) {
    // The owner has no project yet: make one for the automation, owned by them.
    const [named] = await pool.query(`SELECT * FROM projects WHERE tenant_id = ? AND name = ? AND status = 'active' LIMIT 1`, [owner.tenant_id, PROJECT_NAME]);
    project = named[0];
    if (!project) {
      const id = crypto.randomUUID();
      await pool.query(
        `INSERT INTO projects (id, tenant_id, name, description, category, status, settings_json, created_by, created_at, updated_at)
         VALUES (?, ?, ?, ?, 'general', 'active', '{}', ?, UTC_TIMESTAMP(3), UTC_TIMESTAMP(3))`,
        [id, owner.tenant_id, PROJECT_NAME, 'Daily RewaHR Punch In / Punch Out.', owner.id],
      );
      await pool.query(
        `INSERT INTO project_members (id, project_id, user_id, role, created_at) VALUES (?, ?, ?, ?, UTC_TIMESTAMP(3))`,
        [crypto.randomUUID(), id, owner.id, owner.role === 'administrator' ? 'project_manager' : owner.role],
      );
      await writeAudit(pool, { tenantId: owner.tenant_id, userId: owner.id, action: 'project.create', entityType: 'project', entityId: id, projectId: id, metadata: { source: 'setup:rewahr' } });
      created.push(`project ${PROJECT_NAME}`);
      [[project]] = await pool.query(`SELECT * FROM projects WHERE id = ?`, [id]);
    }
  }
  const summary = { tenantId: owner.tenant_id, projectId: project.id, projectName: project.name, created, workflows: [], schedules: [] };

  let [connections] = await pool.query(`SELECT * FROM connections WHERE project_id = ? AND name = ? AND connector_type = 'credential'`, [project.id, CREDENTIAL_NAME]);
  if (!connections[0]) {
    const id = crypto.randomUUID();
    await pool.query(
      `INSERT INTO connections (id, tenant_id, project_id, connector_type, name, config_json, status, created_by, created_at, updated_at)
       VALUES (?, ?, ?, 'credential', ?, ?, 'untested', ?, UTC_TIMESTAMP(3), UTC_TIMESTAMP(3))`,
      [id, project.tenant_id, project.id, CREDENTIAL_NAME, JSON.stringify({ description: 'RewaHR login password (enter it with Set password)', username: email }), owner.id],
    );
    await writeAudit(pool, { tenantId: project.tenant_id, userId: owner.id, action: 'connection.create', entityType: 'connection', entityId: id, projectId: project.id, metadata: { name: CREDENTIAL_NAME, source: 'setup:rewahr' } });
    summary.created.push(`connection ${CREDENTIAL_NAME}`);
    [connections] = await pool.query(`SELECT * FROM connections WHERE id = ?`, [id]);
  }
  const credential = connections[0];
  summary.credentialId = credential.id;
  summary.passwordSet = Boolean(credential.secret_ciphertext);
  const [all] = await pool.query(`SELECT id, connector_type FROM connections WHERE project_id = ?`, [project.id]);
  const connectionIds = new Set(all.map((row) => row.id));
  const connectionTypes = new Map(all.map((row) => [row.id, row.connector_type]));

  for (const punch of PUNCHES) {
    let [workflows] = await pool.query(`SELECT * FROM workflows WHERE project_id = ? AND name = ? AND status <> 'archived' ORDER BY created_at LIMIT 1`, [project.id, punch.workflow]);
    if (!workflows[0]) {
      const id = crypto.randomUUID();
      await pool.query(
        `INSERT INTO workflows (id, tenant_id, project_id, name, description, execution_type, status, created_by, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, 'native', 'draft', ?, UTC_TIMESTAMP(3), UTC_TIMESTAMP(3))`,
        [id, project.tenant_id, project.id, punch.workflow, `Logs in to RewaHR (${REWAHR_URL.split('#')[0]}) as the email argument and clicks ${punch.action === 'in' ? 'Punch In' : 'Punch Out'}. Password: the ${CREDENTIAL_NAME} credential. Screenshots after each step are kept with the job.`, owner.id],
      );
      await writeAudit(pool, { tenantId: project.tenant_id, userId: owner.id, action: 'workflow.create', entityType: 'workflow', entityId: id, projectId: project.id, metadata: { source: 'setup:rewahr' } });
      summary.created.push(`workflow ${punch.workflow}`);
      [workflows] = await pool.query(`SELECT * FROM workflows WHERE id = ?`, [id]);
    }
    const workflow = workflows[0];
    const published = await publish(pool, workflow, attendanceDefinition({ action: punch.action, credentialId: credential.id }), owner.id, connectionIds, connectionTypes);
    summary.workflows.push({ id: workflow.id, name: punch.workflow, published });

    const [schedules] = await pool.query(`SELECT * FROM schedules WHERE workflow_id = ? ORDER BY created_at LIMIT 1`, [workflow.id]);
    if (!schedules[0]) {
      const id = crypto.randomUUID();
      const next = sqlDate(nextRun(punch.cron, new Date(), TIMEZONE));
      await pool.query(
        `INSERT INTO schedules (id, tenant_id, project_id, workflow_id, name, schedule_type, cron_expression, run_at, timezone, enabled, overlap_policy, input_json, next_run_at, created_by, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, 'recurring', ?, NULL, ?, 1, 'skip', ?, ?, ?, UTC_TIMESTAMP(3), UTC_TIMESTAMP(3))`,
        [id, project.tenant_id, project.id, workflow.id, punch.schedule, punch.cron, TIMEZONE, JSON.stringify(scheduleInput(email)), next, owner.id],
      );
      await writeAudit(pool, { tenantId: project.tenant_id, userId: owner.id, action: 'schedule.create', entityType: 'schedule', entityId: id, projectId: project.id, metadata: { cron: punch.cron, timezone: TIMEZONE, source: 'setup:rewahr' } });
      summary.created.push(`schedule ${punch.schedule}`);
      summary.schedules.push({ id, name: punch.schedule, cron: punch.cron, timezone: TIMEZONE, nextRunAtUtc: next });
    } else {
      // Keep the schedule (id, time, enabled) and its email; drop inputs the workflow no longer uses.
      const stored = schedules[0].input_json || {};
      const wanted = scheduleInput(stored.email || email);
      if (JSON.stringify(stored) !== JSON.stringify(wanted)) {
        await pool.query(`UPDATE schedules SET input_json = ?, updated_at = UTC_TIMESTAMP(3) WHERE id = ?`, [JSON.stringify(wanted), schedules[0].id]);
        summary.created.push(`schedule input ${schedules[0].name}`);
      }
      summary.schedules.push({ id: schedules[0].id, name: schedules[0].name, cron: schedules[0].cron_expression, timezone: schedules[0].timezone, nextRunAtUtc: schedules[0].next_run_at, enabled: Boolean(schedules[0].enabled) });
    }
  }
  return summary;
}
