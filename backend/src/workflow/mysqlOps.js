import mysql from 'mysql2/promise';
import { AppError } from '../lib/errors.js';

const IDENT = /^[A-Za-z_][A-Za-z0-9_]{0,63}$/;

function ident(value, label) {
  if (typeof value !== 'string' || !IDENT.test(value)) {
    throw new AppError(400, 'INVALID_IDENTIFIER', `${label} is not an approved identifier`);
  }
  return `\`${value}\``;
}

function allowedColumn(connection, table, column) {
  const columns = connection.allowedColumns?.[table];
  if (columns && !columns.includes(column)) {
    throw new AppError(400, 'COLUMN_NOT_ALLOWED', `Column ${column} is not allowed on ${table}`);
  }
  return ident(column, 'column');
}

export async function runApprovedMysqlOperation(connection, secret, request) {
  if (!connection.allowedTables?.includes(request.table)) {
    throw new AppError(400, 'TABLE_NOT_ALLOWED', 'Table is not in the connection allow list');
  }
  const table = ident(request.table, 'table');
  const limit = Math.min(Math.max(Number(request.limit || 100), 1), 500);
  const filters = Array.isArray(request.filters) ? request.filters : [];
  const where = [];
  const params = [];
  for (const filter of filters) {
    const column = allowedColumn(connection, request.table, filter.column);
    const op = filter.op === 'eq' ? '=' : null;
    if (!op) throw new AppError(400, 'INVALID_FILTER', 'Only equality filters are approved');
    where.push(`${column} = ?`);
    params.push(filter.value ?? null);
  }
  const whereSql = where.length ? ` WHERE ${where.join(' AND ')}` : '';
  let sql = '';
  let sqlParams = [];
  if (request.operation === 'select_rows') {
    const columns = (request.columns?.length ? request.columns : ['*']);
    const list = columns.map((column) => (column === '*' ? '*' : allowedColumn(connection, request.table, column))).join(', ');
    sql = `SELECT ${list} FROM ${table}${whereSql} LIMIT ${limit}`;
    sqlParams = params;
  } else if (request.operation === 'count_rows') {
    sql = `SELECT COUNT(*) AS count FROM ${table}${whereSql}`;
    sqlParams = params;
  } else if (request.operation === 'insert_row') {
    const row = request.row || {};
    const keys = Object.keys(row);
    if (!keys.length) throw new AppError(400, 'VALIDATION', 'insert_row requires a row');
    const cols = keys.map((key) => allowedColumn(connection, request.table, key));
    sql = `INSERT INTO ${table} (${cols.join(', ')}) VALUES (${keys.map(() => '?').join(', ')})`;
    sqlParams = keys.map((key) => row[key]);
  } else if (request.operation === 'update_rows') {
    if (!where.length) throw new AppError(400, 'VALIDATION', 'update_rows requires at least one filter');
    const row = request.row || {};
    const keys = Object.keys(row);
    if (!keys.length) throw new AppError(400, 'VALIDATION', 'update_rows requires values');
    const sets = keys.map((key) => `${allowedColumn(connection, request.table, key)} = ?`);
    sql = `UPDATE ${table} SET ${sets.join(', ')}${whereSql} LIMIT ${limit}`;
    sqlParams = [...keys.map((key) => row[key]), ...params];
  } else {
    throw new AppError(400, 'VALIDATION', 'Unsupported database operation');
  }

  const client = await mysql.createConnection({
    host: connection.host,
    port: Number(connection.port || 3306),
    database: connection.database,
    user: connection.user,
    password: secret.password,
    connectTimeout: connection.timeoutMs || 10000,
    multipleStatements: false,
  });
  try {
    const [rows] = await client.execute(sql, sqlParams);
    return rows;
  } finally {
    await client.end();
  }
}
