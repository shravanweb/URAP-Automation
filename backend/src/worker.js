import fs from 'node:fs/promises';
import { config } from './config.js';
import { createPool } from './db/pool.js';
import {
  processNextNativeJob, promoteRetries, recoverStaleJobs, syncRobotOutbox,
} from './services/jobService.js';
import { abandonStaleItems, runQueueTriggers } from './services/queueService.js';
import { runDueSchedules } from './services/schedulerService.js';
import { stopOcrWorkers } from './automation/documents/ocr.js';
import { advanceFlows } from './flow/engine.js';
import { advanceAgents } from './agent/runtime.js';
import { advanceCases, notifyCase } from './case/engine.js';

const cfg = config();
await fs.mkdir(cfg.storageRoot, { recursive: true });
await fs.mkdir(cfg.robotRoot, { recursive: true });
const pool = createPool(cfg.databaseUrl);

let lastMaintenance = 0;

export async function tick() {
  if (Date.now() - lastMaintenance > 60000) {
    lastMaintenance = Date.now();
    await recoverStaleJobs(pool, cfg.jobStaleMinutes);
    await abandonStaleItems(pool, cfg.queueItemAbandonHours);
  }
  await promoteRetries(pool);
  await runDueSchedules(pool, cfg);
  await runQueueTriggers(pool, cfg);
  await syncRobotOutbox(pool, cfg);
  await advanceFlows(pool, cfg);
  await advanceAgents(pool, cfg);
  await advanceCases(pool, cfg);
  const job = await processNextNativeJob(pool, cfg, cfg.workerId);
  // A job started by a case task: move the case on right away.
  if (job?.case_id) await notifyCase(pool, cfg, job.case_id);
  return job;
}

let running = true;
let sleepTimer = null;
let wake = null;

async function shutdown(signal) {
  if (!running) return;
  running = false;
  console.log(`URAP worker ${cfg.workerId} stopping after ${signal}`);
  if (sleepTimer) clearTimeout(sleepTimer);
  wake?.();
}
process.on('SIGINT', () => shutdown('SIGINT'));
process.on('SIGTERM', () => shutdown('SIGTERM'));

function sleep(ms) {
  return new Promise((resolve) => {
    wake = resolve;
    sleepTimer = setTimeout(resolve, ms);
  });
}

console.log(`URAP worker ${cfg.workerId} started (poll ${cfg.workerPollMs} ms)`);
while (running) {
  try {
    const job = await tick();
    if (job) console.log(JSON.stringify({ event: 'job.finished', jobId: job.id, status: job.status }));
    else await sleep(cfg.workerPollMs);
  } catch (error) {
    console.error(JSON.stringify({ message: error.message, code: error.code || 'WORKER' }));
    await sleep(cfg.workerPollMs);
  }
}
await stopOcrWorkers();
await pool.end();
console.log(`URAP worker ${cfg.workerId} stopped`);
