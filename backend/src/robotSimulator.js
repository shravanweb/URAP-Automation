// URAP robot agent (formerly "robot simulator").
//
// This is NOT UiPath. It is a small Node agent that honours the same file and HTTP contract as
// uipath/Main.xaml, and it can also execute workflow steps on the robot machine:
//   - reads data/robot/inbox/*.json written by the platform,
//   - claims the job through the robot API when ROBOT_TOKEN is set,
//   - when the workflow has real steps (browser, desktop, OCR, document, data), downloads the
//     package (GET /api/robot/jobs/:id/package) and runs it locally with Playwright / the desktop
//     driver / tesseract, uploads produced files as job artifacts, and posts the step log,
//   - otherwise (start -> end) writes the report file exactly as before,
//   - writes the result (robot API or data/robot/outbox),
//   - sends a heartbeat every loop when ROBOT_TOKEN is set.
//
// Usage:  npm run robot                      (loop; same as npm run robot-simulator)
//         npm run robot -- --once            (process the inbox once and exit)
// Env:    ROBOT_TOKEN  token returned by POST /api/robots (optional; without it only files are used)
//         API_URL      default http://127.0.0.1:${PORT || 4000}
//         ROBOT_ROOT   same value as the API (default ../data/robot relative to backend)
//         ROBOT_FAIL_TASKS  comma-separated task names to report as FAILED (for demos)
//         ROBOT_WORK_DIR    folder for files produced by steps (default ROBOT_ROOT/work)
//         BROWSER_*, DESKTOP_*, OCR_*  same meaning as for the worker (see .env.example)
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import dotenv from 'dotenv';
import { processHandoffFile } from './robotContract.js';
import { automationConfig } from './config.js';
import { packageNeedsExecution, runRobotPackage } from './robot/robotRuntime.js';

const backendRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
dotenv.config({ path: path.resolve(backendRoot, '../.env') });
dotenv.config({ path: path.resolve(backendRoot, '.env') });

const robotRoot = path.resolve(backendRoot, process.env.ROBOT_ROOT || '../data/robot');
const apiUrl = (process.env.API_URL || `http://127.0.0.1:${process.env.PORT || 4000}`).replace(/\/$/, '');
const token = process.env.ROBOT_TOKEN || '';
const pollMs = Number(process.env.ROBOT_POLL_MS || 2000);
const failTasks = new Set(String(process.env.ROBOT_FAIL_TASKS || '').split(',').map((item) => item.trim()).filter(Boolean));
const workRoot = path.resolve(backendRoot, process.env.ROBOT_WORK_DIR || path.join(robotRoot, 'work'));
const JOB_FILE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\.json$/i;

async function robotApi(method, route, body) {
  const response = await fetch(`${apiUrl}${route}`, {
    method,
    headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    const error = new Error(payload.error?.message || `HTTP ${response.status}`);
    error.code = payload.error?.code;
    error.status = response.status;
    throw error;
  }
  return payload.data;
}

async function writeAtomic(file, content) {
  await fs.mkdir(path.dirname(file), { recursive: true });
  const temp = `${file}.tmp`;
  await fs.writeFile(temp, content);
  await fs.rename(temp, file);
}

async function moveHandled(file) {
  const handled = path.join(robotRoot, 'handled');
  await fs.mkdir(handled, { recursive: true });
  await fs.rename(file, path.join(handled, `${Date.now()}-${path.basename(file)}`));
}

async function uploadArtifact(jobId, item) {
  const form = new FormData();
  form.append('file', new Blob([await fs.readFile(item.absolute)]), item.name);
  const response = await fetch(`${apiUrl}/api/robot/jobs/${jobId}/artifacts`, {
    method: 'POST',
    headers: { authorization: `Bearer ${token}` },
    body: form,
  });
  if (!response.ok) {
    const payload = await response.json().catch(() => ({}));
    const error = new Error(payload.error?.message || `HTTP ${response.status}`);
    error.code = payload.error?.code;
    throw error;
  }
}

export async function processInboxOnce({ log = console.log, overrides = {} } = {}) {
  const inbox = path.join(robotRoot, 'inbox');
  let files = [];
  try {
    files = (await fs.readdir(inbox)).filter((name) => name.endsWith('.json'));
  } catch (error) {
    if (error.code === 'ENOENT') return [];
    throw error;
  }
  const done = [];
  for (const name of files.sort()) {
    const file = path.join(inbox, name);
    let payload;
    try {
      payload = JSON.parse(await fs.readFile(file, 'utf8'));
    } catch {
      log(`skip unreadable ${name}`);
      await moveHandled(file);
      continue;
    }
    const wholeJob = JOB_FILE.test(name);
    if (wholeJob && token) {
      try {
        await robotApi('POST', `/api/robot/jobs/${payload.jobId}/claim`);
      } catch (error) {
        log(`claim ${payload.jobId} refused: ${error.code || error.message}`);
        if (error.status === 409 || error.status === 403 || error.status === 404) await moveHandled(file);
        continue;
      }
    }
    let pkg = null;
    if (wholeJob && token) {
      try {
        pkg = await robotApi('GET', `/api/robot/jobs/${payload.jobId}/package`);
      } catch (error) {
        log(`package ${payload.jobId} unavailable: ${error.code || error.message}`);
      }
    } else if (wholeJob && payload.definition) {
      pkg = { jobId: payload.jobId, correlationId: payload.correlationId, input: payload.input, definition: payload.definition };
    }
    let result;
    if (pkg && packageNeedsExecution(pkg.definition)) {
      const executed = await runRobotPackage(pkg, { cfg: automationConfig(), workRoot, overrides });
      result = executed.result;
      if (token) {
        for (const item of executed.files) {
          try {
            await uploadArtifact(payload.jobId, item);
          } catch (error) {
            log(`artifact ${item.name} upload failed: ${error.code || error.message}`);
          }
        }
      }
    } else {
      result = await processHandoffFile(file, payload.reportPath || null);
    }
    if (failTasks.has(payload.task)) {
      result = { ...result, executionStatus: 'FAILED', errorCode: 'SIMULATED_FAILURE', errorMessage: `Task ${payload.task} is configured to fail`, retryable: false };
    }
    if (wholeJob && token) {
      await robotApi('POST', `/api/robot/jobs/${payload.jobId}/result`, result);
    } else {
      await writeAtomic(path.join(robotRoot, 'outbox', name), JSON.stringify(result, null, 2));
    }
    await moveHandled(file);
    log(`${name}: ${result.executionStatus}`);
    done.push({ file: name, status: result.executionStatus });
  }
  return done;
}

async function main() {
  const once = process.argv.includes('--once');
  console.log(`URAP robot agent (not UiPath) watching ${path.join(robotRoot, 'inbox')}${token ? ` with API ${apiUrl}` : ' (file mode, no token)'}`);
  let running = true;
  process.on('SIGINT', () => { running = false; });
  process.on('SIGTERM', () => { running = false; });
  do {
    try {
      if (token) await robotApi('POST', '/api/robot/heartbeat');
      await processInboxOnce();
    } catch (error) {
      console.error(JSON.stringify({ message: error.message, code: error.code || 'ROBOT' }));
    }
    if (once) break;
    await new Promise((resolve) => setTimeout(resolve, pollMs));
  } while (running);
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  await main();
}
