// Google Sheets connector using the Sheets REST API v4 with a service account.
// Connection secret: the service account key JSON (client_email, private_key, token_uri), or
// { accessToken } for a short-lived OAuth token. Connection config: { spreadsheetId }.
// Share the spreadsheet with the service account email so it can read or write it.
// apiBaseUrl and authUrl (OAuth token endpoint) may be overridden in the connection config for
// proxies and tests. ("authUrl" because config keys containing "token" are redacted on save.)
import crypto from 'node:crypto';
import { AppError } from '../lib/errors.js';

const SCOPE = 'https://www.googleapis.com/auth/spreadsheets';

function base64url(value) {
  return Buffer.from(value).toString('base64').replace(/=+$/, '').replace(/\+/g, '-').replace(/\//g, '_');
}

export function serviceAccountAssertion(secret, tokenUrl, nowSeconds = Math.floor(Date.now() / 1000)) {
  if (!secret.client_email || !secret.private_key) throw new AppError(400, 'VALIDATION', 'The Google Sheets secret needs client_email and private_key from a service account key');
  const header = base64url(JSON.stringify({ alg: 'RS256', typ: 'JWT' }));
  const claims = base64url(JSON.stringify({ iss: secret.client_email, scope: SCOPE, aud: tokenUrl, iat: nowSeconds, exp: nowSeconds + 3600 }));
  const signer = crypto.createSign('RSA-SHA256');
  signer.update(`${header}.${claims}`);
  const signature = signer.sign(String(secret.private_key).replace(/\\n/g, '\n'));
  return `${header}.${claims}.${base64url(signature)}`;
}

export function rowsToValues(rows, columns) {
  if (!Array.isArray(rows)) throw new AppError(400, 'VALIDATION', 'rows must be an array');
  if (!rows.length) return { values: [], columns: columns || [] };
  if (Array.isArray(rows[0])) return { values: rows.map((row) => row.map((cell) => (cell == null ? '' : cell))), columns: columns || [] };
  const header = columns?.length ? columns : Object.keys(rows[0]);
  return { values: rows.map((row) => header.map((key) => { const value = row?.[key]; return value == null ? '' : (typeof value === 'object' ? JSON.stringify(value) : value); })), columns: header };
}

export function valuesToRows(values, headerRow = true) {
  const list = Array.isArray(values) ? values : [];
  if (!headerRow) return list;
  const [header = [], ...rest] = list;
  const names = header.map((name, index) => String(name || `Column${index + 1}`));
  return rest.map((row) => Object.fromEntries(names.map((name, index) => [name, row[index] ?? ''])));
}

export function createSheetsClient({ config = {}, secret = {}, fetchImpl = fetch } = {}) {
  const apiBase = String(config.apiBaseUrl || 'https://sheets.googleapis.com').replace(/\/$/, '');
  const tokenUrl = config.authUrl || config.tokenUrl || secret.token_uri || 'https://oauth2.googleapis.com/token';
  let token = secret.accessToken ? { value: secret.accessToken, expires: Infinity } : null;

  async function accessToken() {
    if (token && token.expires > Date.now() + 60_000) return token.value;
    const response = await fetchImpl(tokenUrl, {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer', assertion: serviceAccountAssertion(secret, tokenUrl) }),
      signal: AbortSignal.timeout(15000),
    }).catch((error) => { const wrapped = new AppError(502, 'CONNECTOR_UNAVAILABLE', `Google token request failed: ${error.message}`); wrapped.retryable = true; throw wrapped; });
    const body = await response.json().catch(() => ({}));
    if (!response.ok || !body.access_token) throw new AppError(502, 'GOOGLE_AUTH_FAILED', `Google rejected the service account: ${body.error_description || body.error || response.status}`);
    token = { value: body.access_token, expires: Date.now() + (Number(body.expires_in) || 3600) * 1000 };
    return token.value;
  }

  async function call(method, pathAndQuery, body) {
    const response = await fetchImpl(`${apiBase}${pathAndQuery}`, {
      method,
      headers: { authorization: `Bearer ${await accessToken()}`, ...(body ? { 'content-type': 'application/json' } : {}) },
      body: body ? JSON.stringify(body) : undefined,
      signal: AbortSignal.timeout(Number(config.timeoutMs) || 30000),
    }).catch((error) => { const wrapped = new AppError(502, 'CONNECTOR_UNAVAILABLE', `Google Sheets request failed: ${error.message}`); wrapped.retryable = true; throw wrapped; });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) {
      const error = new AppError(502, 'SHEETS_ERROR', `Google Sheets returned ${response.status}: ${data.error?.message || 'error'}`);
      error.retryable = response.status >= 500 || response.status === 429;
      throw error;
    }
    return data;
  }

  const sheetId = (request) => {
    const id = request.spreadsheetId || config.spreadsheetId;
    if (!id || !/^[A-Za-z0-9_-]{10,100}$/.test(id)) throw new AppError(400, 'VALIDATION', 'A valid spreadsheetId is required on the step or the connection');
    return id;
  };
  const range = (request) => {
    if (!request.range || String(request.range).length > 200) throw new AppError(400, 'VALIDATION', 'range is required, for example Sheet1!A1:D100');
    return encodeURIComponent(String(request.range));
  };
  const inputOption = (request) => (request.valueInputOption === 'RAW' ? 'RAW' : 'USER_ENTERED');

  return {
    async metadata(request = {}) {
      const data = await call('GET', `/v4/spreadsheets/${sheetId(request)}?fields=properties.title,sheets.properties.title`);
      return { title: data.properties?.title, sheets: (data.sheets || []).map((sheet) => sheet.properties?.title) };
    },
    async readRange(request) {
      const data = await call('GET', `/v4/spreadsheets/${sheetId(request)}/values/${range(request)}`);
      const values = data.values || [];
      const rows = valuesToRows(values, request.headerRow !== false);
      return { range: data.range, rows, count: rows.length, values: request.includeValues ? values : undefined };
    },
    async appendRows(request) {
      const { values, columns } = rowsToValues(request.rows, request.columns);
      const data = await call('POST', `/v4/spreadsheets/${sheetId(request)}/values/${range(request)}:append?valueInputOption=${inputOption(request)}&insertDataOption=INSERT_ROWS`, { values });
      return { updatedRange: data.updates?.updatedRange || null, updatedRows: data.updates?.updatedRows ?? values.length, columns };
    },
    async updateRange(request) {
      const { values } = rowsToValues(request.rows ?? request.values, request.columns);
      const data = await call('PUT', `/v4/spreadsheets/${sheetId(request)}/values/${range(request)}?valueInputOption=${inputOption(request)}`, { values });
      return { updatedRange: data.updatedRange || null, updatedRows: data.updatedRows ?? values.length, updatedCells: data.updatedCells ?? null };
    },
  };
}
