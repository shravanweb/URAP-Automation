// Tiny global "network activity" counter that drives the top progress bar. No React dependency so
// services/api.js can use it and it stays testable in node.
let inflight = 0;
const listeners = new Set();

function emit() { for (const fn of listeners) fn(inflight); }

export function beginActivity() {
  inflight += 1; emit();
  let done = false;
  return () => { if (done) return; done = true; inflight = Math.max(0, inflight - 1); emit(); };
}

export async function trackActivity(promise) {
  const end = beginActivity();
  try { return await promise; } finally { end(); }
}

export function activityCount() { return inflight; }

export function subscribeActivity(fn) { listeners.add(fn); return () => listeners.delete(fn); }
