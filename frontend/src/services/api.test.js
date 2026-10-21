import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { api, getAccessToken, getRefreshToken, readExpiredNotice, redirect, saveSession } from './api.js';

const json = (status, body) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
const user = { id: 'u1', role: 'administrator' };
function memoryStorage() {
  const map = new Map();
  return { getItem: (k) => (map.has(k) ? map.get(k) : null), setItem: (k, v) => map.set(k, String(v)), removeItem: (k) => map.delete(k), clear: () => map.clear() };
}
globalThis.localStorage = memoryStorage();
globalThis.sessionStorage = memoryStorage();

describe('api client session handling', () => {
  let redirects;
  beforeEach(() => {
    localStorage.clear(); sessionStorage.clear();
    saveSession({ accessToken: 'old-access', refreshToken: 'old-refresh-token-0000000', user }, { remember: true });
    redirects = [];
    vi.spyOn(redirect, 'to').mockImplementation((url) => redirects.push(url));
    globalThis.location = { pathname: '/workflows/69dc1047', search: '?tab=props', hash: '' };
  });
  afterEach(() => vi.restoreAllMocks());

  it('refreshes once for concurrent 401s and retries each request', async () => {
    let refreshes = 0;
    globalThis.fetch = vi.fn(async (url, init) => {
      if (url === '/api/auth/refresh') {
        refreshes += 1;
        await new Promise((r) => setTimeout(r, 10));
        return json(200, { data: { accessToken: 'new-access', refreshToken: 'new-refresh-token-0000000', user } });
      }
      return init.headers.Authorization === 'Bearer new-access' ? json(200, { data: url }) : json(401, { error: { message: 'Invalid or expired token' } });
    });
    const results = await Promise.all(['/api/a', '/api/b', '/api/c'].map((p) => api(p)));
    expect(results.map((r) => r.data)).toEqual(['/api/a', '/api/b', '/api/c']);
    expect(refreshes).toBe(1);
    expect(getAccessToken()).toBe('new-access');
    expect(redirects).toEqual([]);
  });

  it('signs out and redirects to sign-in with the page to return to when refresh fails', async () => {
    globalThis.fetch = vi.fn(async (url) => (url === '/api/auth/refresh'
      ? json(401, { error: { message: 'Refresh token is invalid' } })
      : json(401, { error: { message: 'Invalid or expired token' } })));
    const error = await api('/api/workflows/69dc1047').catch((err) => err);
    expect(error.code).toBe('SESSION_EXPIRED');
    expect(error.message).toBe(''); // no red "Invalid or expired token" banner
    expect(getAccessToken()).toBeNull();
    expect(getRefreshToken()).toBeNull();
    expect(redirects).toEqual(['/login']);
    expect(readExpiredNotice()).toEqual({ from: '/workflows/69dc1047?tab=props' });
  });

  it('uses tokens another tab saved when it loses the rotation race', async () => {
    globalThis.fetch = vi.fn(async (url, init) => {
      if (url === '/api/auth/refresh') {
        saveSession({ accessToken: 'tab2-access', refreshToken: 'tab2-refresh-token-000000', user });
        return json(401, { error: { message: 'Refresh token is invalid' } });
      }
      return init.headers.Authorization === 'Bearer tab2-access' ? json(200, { data: 'ok' }) : json(401, {});
    });
    expect((await api('/api/x')).data).toBe('ok');
    expect(redirects).toEqual([]);
  });

  it('keeps the session when the refresh call cannot reach the server', async () => {
    globalThis.fetch = vi.fn(async (url) => { if (url === '/api/auth/refresh') throw new TypeError('network'); return json(401, {}); });
    const error = await api('/api/x').catch((err) => err);
    expect(error.message).toMatch(/could not be reached/);
    expect(getRefreshToken()).toBe('old-refresh-token-0000000');
    expect(redirects).toEqual([]);
  });

  it('does not refresh or redirect for a wrong password on sign-in', async () => {
    globalThis.fetch = vi.fn(async () => json(401, { error: { message: 'Invalid email or password' } }));
    const error = await api('/api/auth/login', { method: 'POST', body: {} }).catch((err) => err);
    expect(error.message).toBe('Invalid email or password');
    expect(globalThis.fetch).toHaveBeenCalledTimes(1);
    expect(redirects).toEqual([]);
  });
});
