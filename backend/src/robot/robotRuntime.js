// Runs a workflow package on the robot machine.
//
// The robot executes browser, desktop, OCR, document, and data steps locally. Steps that need the
// platform database or stored credentials (connectors, queues, Action Center tasks, notifications,
// sub-workflows) only run on the server worker; the robot fails them with ROBOT_UNSUPPORTED.
import fs from 'node:fs/promises';
import path from 'node:path';
import { AppError } from '../lib/errors.js';
import { resolveInside } from '../lib/paths.js';
import { executeWorkflow } from '../workflow/engine.js';
import { createAutomationServices } from '../services/runtime.js';

export const SERVER_ONLY_STEPS = new Set([
  'http_request', 'database_query', 'file_operation', 'browser_ui_action', 'uipath_workflow',
  'add_queue_item', 'get_queue_item', 'set_queue_item_status', 'send_notification', 'call_subworkflow',
  'create_task', 'wait_for_task', 'sheets_read_range', 'sheets_append_rows', 'sheets_update_range',
  // Reads the password from a Credential connection, which only the server worker can decrypt.
  'browser_flutter_attendance',
]);

/** True when the definition has real steps; start → end only keeps the old report-file contract. */
export function packageNeedsExecution(definition) {
  return Array.isArray(definition?.steps) && definition.steps.some((step) => !['start', 'end'].includes(step.type));
}

/** Server-only steps used by the definition, so the robot can refuse before it opens a browser. */
export function unsupportedSteps(definition) {
  const found = [];
  const visit = (steps) => {
    for (const step of steps || []) {
      if (SERVER_ONLY_STEPS.has(step.type)) found.push(`${step.id} (${step.type})`);
      if (Array.isArray(step.steps)) visit(step.steps);
      if (Array.isArray(step.config?.steps)) visit(step.config.steps);
    }
  };
  visit(definition?.steps);
  return found;
}

function unsupported(name) {
  return async () => {
    throw new AppError(400, 'ROBOT_UNSUPPORTED', `${name} steps run on the server worker only; set the workflow to native execution`);
  };
}

export function createRobotServices({ cfg, workDir, overrides = {} }) {
  const automation = createAutomationServices(cfg, workDir, overrides);
  return {
    storageRoot: workDir,
    ...automation,
    httpRequest: unsupported('HTTP request'),
    databaseQuery: unsupported('Database'),
    fileOperation: unsupported('File connection'),
    robotTask: unsupported('UiPath task'),
    queueAdd: unsupported('Queue'),
    queueGet: unsupported('Queue'),
    queueSetStatus: unsupported('Queue'),
    notify: unsupported('Notification'),
    loadSubworkflow: unsupported('Sub-workflow'),
    createTask: unsupported('Action Center'),
    getTask: unsupported('Action Center'),
    sheets: unsupported('Google Sheets'),
  };
}

/**
 * Executes the package and returns the result body for POST /api/robot/jobs/:id/result plus the
 * work-folder paths of files the steps produced (screenshots and so on) for upload.
 */
export async function runRobotPackage(pkg, { cfg, workRoot, overrides = {} }) {
  const startedAt = new Date().toISOString();
  const workDir = path.join(workRoot, pkg.jobId);
  await fs.mkdir(workDir, { recursive: true });
  const base = { jobId: pkg.jobId, correlationId: pkg.correlationId, startedAt };
  const blocked = unsupportedSteps(pkg.definition);
  if (blocked.length) {
    return {
      result: { ...base, executionStatus: 'FAILED', output: {}, steps: [], completedAt: new Date().toISOString(), errorCode: 'ROBOT_UNSUPPORTED', errorMessage: `The robot cannot run: ${blocked.join(', ')}`, retryable: false },
      files: [],
    };
  }
  const services = createRobotServices({ cfg, workDir, overrides });
  const log = [];
  const result = await executeWorkflow(pkg.definition, pkg.input || {}, services, {
    onStep: async (event) => {
      if (event.status === 'RUNNING') return;
      log.push({
        stepId: event.step.id,
        type: event.step.type,
        status: event.status,
        startedAt: event.startedAt,
        finishedAt: event.finishedAt,
        durationMs: event.durationMs,
        input: event.step.config || {},
        output: event.output,
        error: event.error ? String(event.error) : null,
        iteration: event.iteration ?? null,
      });
    },
  }).finally(() => services.dispose());
  const files = [];
  for (const output of Object.values(result.steps || {})) {
    if (!output?.path) continue;
    try {
      const absolute = resolveInside(workDir, output.path);
      await fs.access(absolute);
      files.push({ absolute, name: path.basename(absolute) });
    } catch {
      // Outputs that only mention a path are not uploaded.
    }
  }
  const succeeded = result.status === 'SUCCEEDED';
  return {
    result: {
      ...base,
      executionStatus: succeeded ? 'SUCCEEDED' : 'FAILED',
      output: succeeded ? result.output : {},
      steps: log,
      completedAt: new Date().toISOString(),
      errorCode: succeeded ? null : result.error?.code || 'EXECUTION_FAILED',
      errorMessage: succeeded ? null : result.error?.message || 'Workflow failed',
      retryable: succeeded ? false : Boolean(result.error?.retryable),
    },
    files,
  };
}
