import { databaseUrl, loadEnvironment } from './config.js';
import { checkDatabase, createPool } from './database.js';
import { migrate } from './migrations.js';

async function main() {
  loadEnvironment();
  const pool = createPool(databaseUrl(process.env.DATABASE_URL));
  try {
    await checkDatabase(pool);
    if (process.argv[2] === 'check') {
      console.log('PostgreSQL connection: OK');
    } else if (process.argv[2] === 'migrate') {
      const applied = await migrate(pool);
      console.log(applied.length ? `Applied migrations: ${applied.join(', ')}` : 'Database migrations are up to date.');
    } else {
      throw new Error('Use npm run db:check or npm run db:migrate from the repository root.');
    }
  } finally {
    await pool.end();
  }
}

main().catch((error: unknown) => {
  // Database error details can contain data or credentials; report only our own messages.
  const databaseError = typeof error === 'object' && error !== null && 'code' in error;
  console.error(databaseError ? 'Database command failed. Check PostgreSQL availability, permissions, and migration SQL; no pending migration was committed.'
    : error instanceof Error ? error.message : 'Database command failed.');
  process.exitCode = 1;
});
