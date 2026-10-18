import mysql from 'mysql2/promise';

export function createPool(databaseUrl, options = {}) {
  const url = new URL(databaseUrl);
  return mysql.createPool({
    host: url.hostname,
    port: Number(url.port || 3306),
    user: decodeURIComponent(url.username),
    password: decodeURIComponent(url.password),
    database: url.pathname.replace(/^\//, ''),
    waitForConnections: true,
    connectionLimit: options.connectionLimit || 10,
    timezone: 'Z',
    dateStrings: true,
    multipleStatements: false,
    connectTimeout: 10000,
  });
}

export async function withTransaction(pool, work) {
  const connection = await pool.getConnection();
  try {
    await connection.beginTransaction();
    const result = await work(connection);
    await connection.commit();
    return result;
  } catch (error) {
    await connection.rollback();
    throw error;
  } finally {
    connection.release();
  }
}
