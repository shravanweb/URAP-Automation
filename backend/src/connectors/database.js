// Database activities for MySQL/MariaDB and PostgreSQL.
//   Approved operations (select_rows, count_rows, insert_row, update_rows) work on tables and
//   columns listed on the connection.
//   run_query runs one parameterized statement, only when the connection sets
//   allowCustomQueries: true. Connections are read-only unless readOnly: false, in which case
//   only SELECT/WITH/SHOW/EXPLAIN statements run, inside a read-only transaction.
import mysql from 'mysql2/promise';
import { AppError } from '../lib/errors.js';
import { runApprovedMysqlOperation } from '../workflow/mysqlOps.js';

const IDENT = /^[A-Za-z_][A-Za-z0-9_]{0,63}$/;
export const DATABASE_CONNECTORS = ['mysql', 'postgres'];

function pgIdent(value, label) {
  if (typeof value !== 'string' || !IDENT.test(value)) throw new AppError(400, 'INVALID_IDENTIFIER', `${label} is not an approved identifier`);
  return `"${value}"`;
}

function allowed(config, table, column) {
  const columns = config.allowedColumns?.[table];
  if (columns && !columns.includes(column)) throw new AppError(400, 'COLUMN_NOT_ALLOWED', `Column ${column} is not allowed on ${table}`);
  return pgIdent(column, 'column');
}

/** Builds SQL for an approved operation in PostgreSQL syntax ($1 placeholders). */
export function buildPostgresOperation(config, request) {
  if (!config.allowedTables?.includes(request.table)) throw new AppError(400, 'TABLE_NOT_ALLOWED', 'Table is not in the connection allow list');
  const table = pgIdent(request.table, 'table');
  const limit = Math.min(Math.max(Number(request.limit || 100), 1), 500);
  const params = [];
  const where = (Array.isArray(request.filters) ? request.filters : []).map((filter) => {
    if (filter.op !== 'eq') throw new AppError(400, 'INVALID_FILTER', 'Only equality filters are approved');
    params.push(filter.value ?? null);
    return `${allowed(config, request.table, filter.column)} = $${params.length}`;
  });
  const whereSql = where.length ? ` WHERE ${where.join(' AND ')}` : '';
  if (request.operation === 'select_rows') {
    const columns = request.columns?.length ? request.columns.map((column) => (column === '*' ? '*' : allowed(config, request.table, column))).join(', ') : '*';
    return { text: `SELECT ${columns} FROM ${table}${whereSql} LIMIT ${limit}`, params };
  }
  if (request.operation === 'count_rows') return { text: `SELECT COUNT(*)::int AS count FROM ${table}${whereSql}`, params };
  const row = request.row || {};
  const keys = Object.keys(row);
  if (request.operation === 'insert_row') {
    if (!keys.length) throw new AppError(400, 'VALIDATION', 'insert_row requires a row');
    const values = keys.map((key, index) => { params.push(row[key]); return `$${index + 1}`; });
    return { text: `INSERT INTO ${table} (${keys.map((key) => allowed(config, request.table, key)).join(', ')}) VALUES (${values.join(', ')})`, params: keys.map((key) => row[key]) };
  }
  if (request.operation === 'update_rows') {
    if (!where.length) throw new AppError(400, 'VALIDATION', 'update_rows requires at least one filter');
    if (!keys.length) throw new AppError(400, 'VALIDATION', 'update_rows requires values');
    const setParams = keys.map((key) => row[key]);
    const offset = setParams.length;
    const sets = keys.map((key, index) => `${allowed(config, request.table, key)} = $${index + 1}`);
    const shiftedWhere = where.map((clause) => clause.replace(/\$(\d+)$/, (_, n) => `$${Number(n) + offset}`));
    return { text: `UPDATE ${table} SET ${sets.join(', ')} WHERE ${shiftedWhere.join(' AND ')}`, params: [...setParams, ...params] };
  }
  throw new AppError(400, 'VALIDATION', 'Unsupported database operation');
}

/** Checks a custom query against the connection policy and returns the cleaned statement. */
export function checkCustomQuery(config, request) {
  if (config.allowCustomQueries !== true) {
    throw new AppError(403, 'CUSTOM_QUERY_DISABLED', 'This connection does not allow custom queries. Set allowCustomQueries: true on the connection to enable run_query.');
  }
  const query = typeof request.query === 'string' ? request.query.trim().replace(/;\s*$/, '') : '';
  if (!query) throw new AppError(400, 'VALIDATION', 'query is required');
  if (query.length > 10000) throw new AppError(400, 'VALIDATION', 'query is limited to 10000 characters');
  if (query.includes(';')) throw new AppError(400, 'VALIDATION', 'Only one statement may run per step');
  const parameters = request.parameters === undefined ? [] : request.parameters;
  if (!Array.isArray(parameters) || parameters.length > 100) throw new AppError(400, 'VALIDATION', 'parameters must be an array of at most 100 values');
  const readOnly = config.readOnly !== false;
  const firstWord = query.replace(/^(\s|--[^\n]*\n|\/\*[\s\S]*?\*\/)+/, '').split(/\s+/)[0].toUpperCase();
  if (readOnly && !['SELECT', 'WITH', 'SHOW', 'EXPLAIN', 'DESCRIBE', 'VALUES'].includes(firstWord)) {
    throw new AppError(403, 'READ_ONLY_CONNECTION', 'This connection is read-only. Only SELECT, WITH, SHOW, and EXPLAIN statements are allowed.');
  }
  return { query, parameters: parameters.map((value) => (value !== null && typeof value === 'object' ? JSON.stringify(value) : value)), readOnly };
}

function shapeRows(rows, maxRows) {
  const list = Array.isArray(rows) ? rows : [];
  const limit = Math.min(Math.max(Number(maxRows) || 500, 1), 5000);
  return { rows: list.slice(0, limit), rowCount: list.length, truncated: list.length > limit };
}

async function postgresClient(config, secret) {
  const { default: pg } = await import('pg');
  const client = new pg.Client({
    host: config.host,
    port: Number(config.port || 5432),
    database: config.database,
    user: config.user,
    password: secret.password,
    ssl: config.ssl ? { rejectUnauthorized: config.sslRejectUnauthorized !== false } : undefined,
    connectionTimeoutMillis: config.timeoutMs || 10000,
    statement_timeout: config.statementTimeoutMs || 30000,
  });
  await client.connect();
  return client;
}

/**
 * Runs a database step. clientFactory(config, secret) may be passed for tests; it must return
 * an object with query(text, params) -> { rows, rowCount } and end().
 */
export async function runDatabaseStep(connectorType, config, secret, request, { clientFactory } = {}) {
  if (!DATABASE_CONNECTORS.includes(connectorType)) throw new AppError(400, 'WRONG_CONNECTOR', 'Database steps need a MySQL or PostgreSQL connection');
  if (connectorType === 'mysql') {
    if (request.operation !== 'run_query') return { result: await runApprovedMysqlOperation(config, secret, request) };
    const checked = checkCustomQuery(config, request);
    const client = clientFactory ? await clientFactory(config, secret) : await mysql.createConnection({
      host: config.host, port: Number(config.port || 3306), database: config.database, user: config.user,
      password: secret.password, connectTimeout: config.timeoutMs || 10000, multipleStatements: false,
    });
    try {
      if (checked.readOnly) await client.query('START TRANSACTION READ ONLY');
      const [rows] = await client.execute(checked.query, checked.parameters);
      if (checked.readOnly) await client.query('COMMIT');
      if (!Array.isArray(rows)) return { result: rows, affectedRows: rows.affectedRows ?? 0, insertId: rows.insertId ?? null };
      return { result: shapeRows(rows, request.maxRows).rows, ...shapeRows(rows, request.maxRows) };
    } finally {
      await client.end();
    }
  }
  const client = clientFactory ? await clientFactory(config, secret) : await postgresClient(config, secret);
  try {
    if (request.operation === 'run_query') {
      const checked = checkCustomQuery(config, request);
      if (checked.readOnly) await client.query('BEGIN READ ONLY');
      try {
        const response = await client.query(checked.query, checked.parameters);
        if (checked.readOnly) await client.query('COMMIT');
        const shaped = shapeRows(response.rows, request.maxRows);
        return { result: shaped.rows, ...shaped, affectedRows: response.rowCount ?? response.affectedRows ?? null };
      } catch (error) {
        if (checked.readOnly) await client.query('ROLLBACK').catch(() => {});
        throw error;
      }
    }
    const { text, params } = buildPostgresOperation(config, request);
    const response = await client.query(text, params);
    if (request.operation === 'insert_row' || request.operation === 'update_rows') return { result: { affectedRows: response.rowCount ?? response.affectedRows ?? 0 } };
    return { result: response.rows };
  } finally {
    await client.end();
  }
}

export async function testDatabaseConnection(connectorType, config, secret) {
  if (connectorType === 'postgres') {
    const client = await postgresClient(config, secret);
    try { await client.query('SELECT 1'); } finally { await client.end(); }
  }
}
