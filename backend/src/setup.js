import { config } from './config.js';
import { migrate } from './db/migrate.js';
import { createPool } from './db/pool.js';
import { hashPassword } from './lib/passwords.js';
import crypto from 'node:crypto';

const cfg = config();
await migrate(cfg);
const pool = createPool(cfg.databaseUrl);
try {
  if (cfg.adminEmail && cfg.adminPassword) {
    if (cfg.adminPassword.length < 12) {
      throw new Error('ADMIN_PASSWORD must be at least 12 characters');
    }
    const [existing] = await pool.query(`SELECT id FROM users WHERE email = ?`, [cfg.adminEmail.toLowerCase()]);
    if (!existing.length) {
      const [tenants] = await pool.query(`SELECT id FROM tenants WHERE slug = 'default'`);
      await pool.query(
        `INSERT INTO users (id, tenant_id, email, display_name, password_hash, role, status, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, 'administrator', 'active', UTC_TIMESTAMP(3), UTC_TIMESTAMP(3))`,
        [crypto.randomUUID(), tenants[0].id, cfg.adminEmail.toLowerCase(), cfg.adminName, await hashPassword(cfg.adminPassword, cfg.bcryptRounds)],
      );
      console.log(`Created administrator ${cfg.adminEmail}`);
    } else {
      console.log('Administrator already exists');
    }
  } else if (!process.argv.includes('--migrate-only')) {
    console.log('Set ADMIN_EMAIL and ADMIN_PASSWORD to create the first administrator. No password was written to seed data.');
  }
  console.log('Database schema and reference data are ready');
} finally {
  await pool.end();
}
