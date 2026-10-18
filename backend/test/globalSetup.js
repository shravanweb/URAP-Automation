import mysql from 'mysql2/promise';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const databaseUrl = process.env.TEST_DATABASE_URL || 'mysql://urap:urap_dev_password@127.0.0.1:3307/urap_test';

export default async function globalSetup() {
  console.log('Resetting urap_test');
  const url = new URL(databaseUrl);
  if (!url.pathname.endsWith('/urap_test')) {
    throw new Error('Refusing to reset a database that is not urap_test');
  }
  const connection = await mysql.createConnection({
    host: url.hostname,
    port: Number(url.port),
    user: decodeURIComponent(url.username),
    password: decodeURIComponent(url.password),
    multipleStatements: false,
  });
  await connection.query('DROP DATABASE IF EXISTS urap_test');
  await connection.end();
  const { migrate } = await import('../src/db/migrate.js');
  const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
  await migrate({
    databaseUrl,
    schemaPath: path.join(root, 'database/schema.sql'),
    seedPath: path.join(root, 'database/seed.sql'),
    migrationsPath: path.join(root, 'database/migrations'),
  });
  await fs.rm(path.join(root, 'data/test-storage'), { recursive: true, force: true });
  await fs.rm(path.join(root, 'data/test-robot'), { recursive: true, force: true });
}
