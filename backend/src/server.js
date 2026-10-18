import fs from 'node:fs/promises';
import { config } from './config.js';
import { createPool } from './db/pool.js';
import { createApp } from './http/createApp.js';

const cfg = config();
await fs.mkdir(cfg.storageRoot, { recursive: true });
await fs.mkdir(cfg.robotRoot, { recursive: true });
const pool = createPool(cfg.databaseUrl);
const app = createApp({ pool, config: cfg });
const server = app.listen(cfg.port, () => {
  console.log(`URAP API listening on ${cfg.port}`);
});

async function shutdown() {
  server.close();
  await app.locals.recorder?.closeAll();
  await pool.end();
}
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
