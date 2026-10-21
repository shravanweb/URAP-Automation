import crypto from 'node:crypto';
import { AsyncLocalStorage } from 'node:async_hooks';

// Per-request context so audit rows can record where an action came from without threading
// req through every service. Only non-secret request facts are kept.
const storage = new AsyncLocalStorage();

export function requestContextMiddleware(req, res, next) {
  const incoming = String(req.get('X-Request-Id') || '');
  const requestId = /^[A-Za-z0-9._-]{8,64}$/.test(incoming) ? incoming : crypto.randomUUID();
  res.set('X-Request-Id', requestId);
  const ctx = { requestId, ip: req.ip || null, userAgent: String(req.get('User-Agent') || '').slice(0, 255) || null };
  storage.run(ctx, next);
}

export function currentRequest() {
  return storage.getStore() || null;
}
