// npm run setup:rewahr -- [ownerEmail]
// Creates or updates the RewaHR Punch In / Punch Out workflows, schedules, and the empty
// REWAHR_PASSWORD credential. Prints ids only; never a password.
import { config } from './config.js';
import { createPool } from './db/pool.js';
import { ensureRewahrAttendance } from './services/attendanceSetup.js';

const ownerEmail = process.argv[2] || 'shravan@nityainc.com';
const cfg = config();
const pool = createPool(cfg.databaseUrl);
try {
  const summary = await ensureRewahrAttendance(pool, { ownerEmail });
  console.log(JSON.stringify(summary, null, 2));
} catch (error) {
  console.error(error.message);
  process.exitCode = 1;
} finally {
  await pool.end();
}
