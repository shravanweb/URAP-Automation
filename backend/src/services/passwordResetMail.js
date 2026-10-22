// Email password reset. Used only when SMTP is configured (SMTP_HOST, or a test json transport).
// The raw token is emailed once and stored as a SHA-256 hash. Requests for unknown emails do nothing.
import crypto from 'node:crypto';
import nodemailer from 'nodemailer';
import { AppError } from '../lib/errors.js';
import { sha256 } from '../lib/cryptoSecrets.js';
import { hashPassword } from '../lib/passwords.js';
import { writeAudit } from '../db/audit.js';

const TOKEN_MINUTES = 30;
let lastJsonMail = null;

/** Test hook: returns and clears the last message captured by the json transport. */
export function takeLastResetMail() {
  const value = lastJsonMail;
  lastJsonMail = null;
  return value;
}

export function mailerFor(smtp) {
  if (!smtp || (!smtp.host && !smtp.jsonTransport)) return null;
  if (smtp.jsonTransport) return nodemailer.createTransport({ jsonTransport: true });
  return nodemailer.createTransport({
    host: smtp.host,
    port: Number(smtp.port || 587),
    secure: Boolean(smtp.secure),
    auth: smtp.user ? { user: smtp.user, pass: smtp.password } : undefined,
  });
}

export function emailConfigured(cfg) {
  return Boolean(cfg?.smtp?.host || cfg?.smtp?.jsonTransport);
}

export async function requestPasswordReset(pool, cfg, email) {
  const transport = mailerFor(cfg.smtp);
  if (!transport) return { sent: false };
  const [rows] = await pool.query(`SELECT id, tenant_id, email, display_name, status FROM users WHERE email = ?`, [email.toLowerCase()]);
  const user = rows[0];
  if (!user || user.status !== 'active') return { sent: false };
  const token = crypto.randomBytes(32).toString('base64url');
  await pool.query(`UPDATE password_reset_tokens SET used_at = UTC_TIMESTAMP(3) WHERE user_id = ? AND used_at IS NULL`, [user.id]);
  await pool.query(
    `INSERT INTO password_reset_tokens (id, user_id, token_hash, expires_at, created_at) VALUES (?, ?, ?, DATE_ADD(UTC_TIMESTAMP(3), INTERVAL ${TOKEN_MINUTES} MINUTE), UTC_TIMESTAMP(3))`,
    [crypto.randomUUID(), user.id, sha256(token)],
  );
  const link = `${cfg.publicUrl || 'http://localhost:5173'}/reset-password?token=${encodeURIComponent(token)}`;
  const info = await transport.sendMail({
    from: cfg.smtp.from || 'urap@localhost',
    to: user.email,
    subject: 'Reset your URAP password',
    text: `Hello ${user.display_name},\n\nA password reset was requested for this URAP account. Open this link within ${TOKEN_MINUTES} minutes:\n\n${link}\n\nIf you did not ask for this, ignore this message. Your password will not change.`,
  });
  if (cfg.smtp.jsonTransport) {
    lastJsonMail = typeof info.message === 'string' ? JSON.parse(info.message) : info.message;
  }
  await writeAudit(pool, { tenantId: user.tenant_id, userId: user.id, action: 'auth.password_reset_requested', entityType: 'user', entityId: user.id });
  return { sent: true };
}

export async function applyPasswordReset(pool, cfg, token, password) {
  if (password.length < 12 || !/[A-Za-z]/.test(password) || !/\d/.test(password)) {
    throw new AppError(400, 'VALIDATION', 'Password must be at least 12 characters and contain letters and numbers');
  }
  const [rows] = await pool.query(
    `SELECT t.id, t.user_id, u.tenant_id, u.email FROM password_reset_tokens t
     JOIN users u ON u.id = t.user_id
     WHERE t.token_hash = ? AND t.used_at IS NULL AND t.expires_at > UTC_TIMESTAMP(3)`,
    [sha256(String(token || ''))],
  );
  const row = rows[0];
  if (!row) throw new AppError(400, 'RESET_TOKEN_INVALID', 'This reset link is invalid or has expired. Request a new one.');
  await pool.query(`UPDATE users SET password_hash = ?, updated_at = UTC_TIMESTAMP(3) WHERE id = ?`, [await hashPassword(password, cfg.bcryptRounds), row.user_id]);
  await pool.query(`UPDATE password_reset_tokens SET used_at = UTC_TIMESTAMP(3) WHERE id = ?`, [row.id]);
  await pool.query(`UPDATE refresh_tokens SET revoked_at = UTC_TIMESTAMP(3) WHERE user_id = ? AND revoked_at IS NULL`, [row.user_id]);
  await writeAudit(pool, { tenantId: row.tenant_id, userId: row.user_id, action: 'auth.password_reset', entityType: 'user', entityId: row.user_id });
  return { email: row.email };
}
