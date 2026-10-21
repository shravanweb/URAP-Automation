const ACCESS = 'urap.access';
const REFRESH = 'urap.refresh';
const USER = 'urap.user';

const REMEMBER = 'urap.remember';

// "Remember me" keeps the session in localStorage (survives closing the browser); otherwise it
// lives in sessionStorage and ends with the tab. Either store may be missing (tests, SSR).
function store(kind) {
  try {
    const target = kind === 'local' ? globalThis.localStorage : globalThis.sessionStorage;
    return target && typeof target.getItem === 'function' ? target : null;
  } catch {
    return null;
  }
}

function read(key) {
  return store('session')?.getItem(key) ?? store('local')?.getItem(key) ?? null;
}

export function getAccessToken() { return read(ACCESS); }
export function getRefreshToken() { return read(REFRESH); }

export function currentUser() {
  const raw = read(USER);
  if (!raw) return null;
  try { return JSON.parse(raw); } catch { return null; }
}

export function saveSession(data, options = {}) {
  const remember = options.remember ?? Boolean(store('local')?.getItem(REMEMBER));
  const target = store(remember ? 'local' : 'session');
  const other = store(remember ? 'session' : 'local');
  [ACCESS, REFRESH, USER].forEach((key) => other?.removeItem(key));
  if (remember) store('local')?.setItem(REMEMBER, '1'); else store('local')?.removeItem(REMEMBER);
  target?.setItem(ACCESS, data.accessToken);
  target?.setItem(REFRESH, data.refreshToken);
  target?.setItem(USER, JSON.stringify(data.user));
}

export function clearSession() {
  for (const kind of ['session', 'local']) {
    [ACCESS, REFRESH, USER].forEach((key) => store(kind)?.removeItem(key));
  }
  store('local')?.removeItem(REMEMBER);
}

export const EXPIRED_KEY = 'urap.expired';

// One refresh at a time, shared by every request in this tab (a page that loads five things at
// once after the access token expired must not fire five refreshes: the server rotates the refresh
// token, so all but the first would present a revoked token and sign the user out). Across tabs,
// navigator.locks serialises refreshes; a tab that waited re-reads storage and reuses the tokens
// the other tab just saved instead of refreshing again.
let inflight = null;

async function withRefreshLock(task) {
  const locks = globalThis.navigator?.locks;
  if (locks?.request) return locks.request('urap-refresh', task);
  return task();
}

async function refreshOnce(staleRefresh) {
  const refreshToken = getRefreshToken();
  if (!refreshToken) return 'expired';
  if (staleRefresh && refreshToken !== staleRefresh) return 'ok'; // another tab already refreshed
  let response;
  try {
    response = await fetch('/api/auth/refresh', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ refreshToken }),
    });
  } catch {
    return 'offline'; // network trouble is not an expired session; keep the tokens
  }
  if (response.ok) {
    saveSession((await response.json()).data);
    return 'ok';
  }
  if (response.status === 401 || response.status === 400) {
    // Lost a race with another tab that rotated the same token a moment ago: use its tokens.
    if (getRefreshToken() && getRefreshToken() !== refreshToken) return 'ok';
    return 'expired';
  }
  return 'offline';
}

/** Refreshes the session once for all concurrent callers. Resolves 'ok' | 'expired' | 'offline'. */
export function refreshSession() {
  if (!inflight) {
    const stale = getRefreshToken();
    inflight = withRefreshLock(() => refreshOnce(stale)).finally(() => { inflight = null; });
  }
  return inflight;
}

/** Indirection so tests can observe the redirect (jsdom cannot navigate). */
export const redirect = { to: (url) => globalThis.location.assign(url) };

/** The session is gone: clear it and send the user to sign in, back to this page afterwards. */
export function sessionExpired() {
  clearSession();
  const loc = globalThis.location;
  if (!loc) return;
  const from = `${loc.pathname}${loc.search}${loc.hash || ''}`;
  try { globalThis.sessionStorage?.setItem(EXPIRED_KEY, JSON.stringify({ from })); } catch { /* ignore */ }
  if (!loc.pathname.startsWith('/login')) redirect.to('/login');
}

export function clearExpiredNotice() {
  try { globalThis.sessionStorage?.removeItem(EXPIRED_KEY); } catch { /* ignore */ }
}

/**
 * Every API call that ends in 401 after a failed refresh lands here: sign out, go to sign-in.
 * The error has an empty message so pages never flash a red "Invalid or expired token" banner.
 */
export function expiredError() {
  sessionExpired();
  const error = new Error('');
  error.status = 401;
  error.code = 'SESSION_EXPIRED';
  error.sessionExpired = true;
  return error;
}

/** For the sign-in page: { from } when the last session expired, else null (cleared on sign-in). */
export function readExpiredNotice() {
  try {
    const raw = globalThis.sessionStorage?.getItem(EXPIRED_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    return { from: typeof parsed?.from === 'string' && parsed.from.startsWith('/') && !parsed.from.startsWith('//') ? parsed.from : null };
  } catch { return null; }
}

export async function download(path, filename) {
  const headers = {};
  const go = () => { const token = getAccessToken(); if (token) headers.Authorization = `Bearer ${token}`; return fetch(path, { headers }); };
  let response = await go();
  if (response.status === 401) {
    const outcome = await refreshSession();
    if (outcome === 'offline') throw new Error('The server could not be reached. Check that the API is running.');
    if (outcome === 'ok') response = await go();
    if (outcome === 'expired' || response.status === 401) throw expiredError();
  }
  if (!response.ok) throw new Error('Download failed');
  const blob = await response.blob();
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  link.click();
  URL.revokeObjectURL(url);
}

export async function api(path, options = {}) {
  const headers = { ...(options.headers || {}) };
  if (options.body && !(options.body instanceof FormData)) headers['Content-Type'] = 'application/json';
  const request = () => {
    const token = getAccessToken();
    if (token) headers.Authorization = `Bearer ${token}`;
    return fetch(path, {
      ...options,
      headers,
      body: options.body && !(options.body instanceof FormData) ? JSON.stringify(options.body) : options.body,
    });
  };
  const sentWith = getAccessToken();
  let response = await request();
  // Only a signed-in page is signed out; public pages calling the API without a session are not.
  if (response.status === 401 && !path.startsWith('/api/auth/') && (sentWith || getRefreshToken() || currentUser())) {
    // Another request may already have refreshed while this one was in flight: just retry.
    const outcome = !getRefreshToken() ? 'expired'
      : getAccessToken() && getAccessToken() !== sentWith ? 'ok' : await refreshSession();
    if (outcome === 'offline') {
      const error = new Error('The server could not be reached. Check that the API is running.');
      error.status = 503;
      throw error;
    }
    if (outcome === 'ok') response = await request();
    if (outcome === 'expired' || response.status === 401) throw expiredError();
  }
  const type = response.headers.get('content-type') || '';
  if (!type.includes('json')) {
    if (!response.ok) {
      const error = new Error(response.status === 429 ? 'Too many attempts. Wait a minute and try again.' : response.status >= 500 ? 'The server could not be reached. Check that the API is running.' : 'Request failed');
      error.status = response.status;
      throw error;
    }
    return response;
  }
  const payload = await response.json();
  if (!response.ok) {
    const details = payload.error?.details?.map((item) => item.message).filter(Boolean).join(' ');
    const error = new Error(details || payload.error?.message || 'Request failed');
    error.status = response.status;
    error.code = payload.error?.code;
    error.details = payload.error?.details || null;
    error.fields = Object.fromEntries((payload.error?.details || []).filter((item) => item.path).map((item) => [Array.isArray(item.path) ? item.path[0] : item.path, item.message]));
    throw error;
  }
  return payload;
}
