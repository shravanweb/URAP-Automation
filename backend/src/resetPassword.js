// Sets a new temporary password for a user from the server console, for an administrator who is
// locked out (there is no outgoing email for reset links). Usage:
//   npm run reset-password -- user@company.com
// Set URAP_NEW_PASSWORD to choose the password instead of generating one. Existing sessions
// (refresh tokens) of that user are revoked.
import crypto from 'node:crypto';
import { config } from './config.js';
import { createPool } from './db/pool.js';
import { hashPassword } from './lib/passwords.js';
import { writeAudit } from './db/audit.js';

export function generatePassword() {
  const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789';
  const bytes = crypto.randomBytes(16);
  const body = Array.from(bytes, (byte) => alphabet[byte % alphabet.length]).join('');
  return `${body.slice(0, 4)}-${body.slice(4, 8)}-${body.slice(8, 12)}-${body.slice(12, 16)}7`;
}

export async function resetPassword(pool, email, password, rounds = 10) {
  if (password.length < 12 || !/[A-Za-z]/.test(password) || !/\d/.test(password)) {
    throw new Error('The password must be at least 12 characters with letters and numbers');
  }
  const [rows] = await pool.query(`SELECT id, tenant_id FROM users WHERE email = ?`, [email.toLowerCase()]);
  if (!rows[0]) throw new Error(`No user with email ${email}`);
  await pool.query(`UPDATE users SET password_hash = ?, status = 'active', updated_at = UTC_TIMESTAMP(3) WHERE id = ?`, [await hashPassword(password, rounds), rows[0].id]);
  await pool.query(`UPDATE refresh_tokens SET revoked_at = UTC_TIMESTAMP(3) WHERE user_id = ? AND revoked_at IS NULL`, [rows[0].id]);
  await writeAudit(pool, { tenantId: rows[0].tenant_id, userId: null, action: 'user.password_reset_cli', entityType: 'user', entityId: rows[0].id, metadata: { source: 'console' } });
  return rows[0].id;
}

const isMain = process.argv[1] && import.meta.url.endsWith(process.argv[1].replaceAll('\\', '/').split('/').pop());
if (isMain) {
  const email = process.argv[2];
  if (!email) {
    console.error('Usage: npm run reset-password -- user@company.com');
    process.exit(1);
  }
  const cfg = config();
  const pool = createPool(cfg.databaseUrl);
  try {
    const password = process.env.URAP_NEW_PASSWORD || generatePassword();
    await resetPassword(pool, email, password, cfg.bcryptRounds);
    console.log(`Password reset for ${email}. Temporary password: ${password}`);
    console.log('Share it securely; the user can sign in with it now. Their other sessions were signed out.');
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  } finally {
    await pool.end();
  }
}
