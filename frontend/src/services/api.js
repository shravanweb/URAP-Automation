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

async function refresh() {
  const refreshToken = getRefreshToken();
  if (!refreshToken) return false;
  const response = await fetch('/api/auth/refresh', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ refreshToken }),
  });
  if (!response.ok) {
    clearSession();
    return false;
  }
  saveSession((await response.json()).data);
  return true;
}

export async function download(path, filename) {
  const headers = {};
  const token = getAccessToken();
  if (token) headers.Authorization = `Bearer ${token}`;
  const response = await fetch(path, { headers });
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
  const token = getAccessToken();
  if (token) headers.Authorization = `Bearer ${token}`;
  const request = () => fetch(path, {
    ...options,
    headers,
    body: options.body && !(options.body instanceof FormData) ? JSON.stringify(options.body) : options.body,
  });
  let response = await request();
  if (response.status === 401 && !path.startsWith('/api/auth/') && await refresh()) {
    headers.Authorization = `Bearer ${getAccessToken()}`;
    response = await request();
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
