import fs from 'node:fs/promises';
import path from 'node:path';
import mysql from 'mysql2/promise';
import { readStatements } from './sqlFile.js';

async function applyFile(connection, file) {
  const statements = await readStatements(file);
  for (const statement of statements) {
    await connection.query(statement);
  }
}

function connectionOptions(url, database) {
  return {
    host: url.hostname,
    port: Number(url.port || 3306),
    user: decodeURIComponent(url.username),
    password: decodeURIComponent(url.password),
    ...(database ? { database } : {}),
    multipleStatements: false,
  };
}

/**
 * Lists incremental migrations in database/migrations. `001_init` is the marker for schema.sql
 * and is never executed directly. Every other file runs once, in file-name order, and is
 * recorded in schema_migrations so an existing database (for example the `urap` database on a
 * developer laptop) is upgraded in place without being recreated.
 */
export async function listMigrations(migrationsPath) {
  if (!migrationsPath) return [];
  let files = [];
  try {
    files = await fs.readdir(migrationsPath);
  } catch (error) {
    if (error.code === 'ENOENT') return [];
    throw error;
  }
  return files
    .filter((name) => /^\d{3}_[A-Za-z0-9_]+\.sql$/.test(name))
    .sort()
    .map((name) => ({ id: name.replace(/\.sql$/, ''), file: path.join(migrationsPath, name) }))
    .filter((item) => item.id !== '001_init');
}

export async function migrate({ databaseUrl, schemaPath, seedPath, migrationsPath }) {
  const url = new URL(databaseUrl);
  const database = url.pathname.replace(/^\//, '');
  const admin = await mysql.createConnection(connectionOptions(url));
  try {
    await admin.query(`CREATE DATABASE IF NOT EXISTS \`${database.replace(/`/g, '')}\` CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci`);
  } finally {
    await admin.end();
  }

  const connection = await mysql.createConnection(connectionOptions(url, database));
  const applied = [];
  try {
    const [tables] = await connection.query(`SHOW TABLES LIKE 'schema_migrations'`);
    if (!tables.length) {
      await applyFile(connection, schemaPath);
      await connection.query(`INSERT INTO schema_migrations (id, applied_at) VALUES ('001_init', UTC_TIMESTAMP(3))`);
      applied.push('001_init');
    }
    const resolvedMigrations = migrationsPath || path.join(path.dirname(schemaPath), 'migrations');
    const [doneRows] = await connection.query(`SELECT id FROM schema_migrations`);
    const done = new Set(doneRows.map((row) => row.id));
    for (const migration of await listMigrations(resolvedMigrations)) {
      if (done.has(migration.id)) continue;
      await applyFile(connection, migration.file);
      await connection.query(`INSERT INTO schema_migrations (id, applied_at) VALUES (?, UTC_TIMESTAMP(3))`, [migration.id]);
      applied.push(migration.id);
    }
    await applyFile(connection, seedPath);
  } finally {
    await connection.end();
  }
  return { applied };
}
