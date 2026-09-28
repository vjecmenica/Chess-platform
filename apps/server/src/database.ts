import pg from 'pg';

export const databaseHelp = 'PostgreSQL is unavailable. Start PostgreSQL and check DATABASE_URL (host, port, credentials, and database name).';

export function createPool(connectionString: string): pg.Pool {
  const pool = new pg.Pool({
    connectionString,
    max: 5,
    connectionTimeoutMillis: 3000,
    idleTimeoutMillis: 10000,
    statement_timeout: 5000,
    query_timeout: 6000,
  });
  // An idle client can disconnect after startup; never log the connection string.
  pool.on('error', () => console.error(databaseHelp));
  return pool;
}

export async function checkDatabase(pool: pg.Pool): Promise<void> {
  try {
    await pool.query('SELECT 1');
  } catch {
    throw new Error(databaseHelp);
  }
}
