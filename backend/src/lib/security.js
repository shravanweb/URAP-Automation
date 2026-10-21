// Small, dependency-free security helpers shared by the HTTP layer (and covered by test/security.test.js).
import bcrypt from 'bcryptjs';

export const MIN_BCRYPT_ROUNDS = 12;

// BCRYPT_ROUNDS below 12 is too weak for new hashes; clamp to [12, 15] so a typo can't make login take minutes.
export function effectiveBcryptRounds(value) {
  const n = Number(value);
  if (!Number.isInteger(n) || n < MIN_BCRYPT_ROUNDS) return MIN_BCRYPT_ROUNDS;
  return Math.min(n, 15);
}

export function needsRehash(passwordHash, rounds) {
  try { return bcrypt.getRounds(passwordHash) < rounds; } catch { return false; }
}

// CORS_ORIGIN may be one origin or a comma-separated allowlist. Requests with no Origin header
// (curl, server-to-server, the robot agent) are not browser cross-origin requests and are allowed.
export function parseOrigins(value) {
  return String(value || 'http://localhost:5173').split(',').map((s) => s.trim().replace(/\/+$/, '')).filter(Boolean);
}

export function corsOptions(value) {
  const allowed = new Set(parseOrigins(value));
  return {
    origin(origin, callback) {
      if (!origin || allowed.has(origin)) return callback(null, true);
      return callback(null, false);
    },
    methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
    maxAge: 600,
  };
}

// Maps errors thrown by express/body-parser/multer to safe client responses. Never leaks stacks or messages
// of unexpected errors; returns null for errors the caller should treat as 500.
export function clientError(error) {
  if (error?.type === 'entity.parse.failed') return { status: 400, code: 'BAD_JSON', message: 'Request body is not valid JSON' };
  if (error?.type === 'entity.too.large' || error?.status === 413) return { status: 413, code: 'PAYLOAD_TOO_LARGE', message: 'Request body is too large' };
  if (error?.code === 'LIMIT_FILE_SIZE') return { status: 400, code: 'FILE_TOO_LARGE', message: 'File exceeds the 10 MB limit' };
  if (typeof error?.code === 'string' && error.code.startsWith('LIMIT_')) return { status: 400, code: 'UPLOAD_REJECTED', message: 'Upload rejected' };
  if (error?.code === 'ER_DUP_ENTRY') return { status: 409, code: 'CONFLICT', message: 'A matching record already exists' };
  return null;
}
