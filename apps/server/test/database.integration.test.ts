import { mkdtemp, cp, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { expect, it } from 'vitest';
import { databaseUrl, loadEnvironment } from '../src/config.js';
import { checkDatabase, createPool } from '../src/database.js';
import { migrate, migrationDirectory } from '../src/migrations.js';
import { buildApp } from '../src/app.js';

it('connects, migrates once, detects drift, rolls back failed SQL, and serves readiness', async () => {
  loadEnvironment();
  const pool = createPool(databaseUrl(process.env.TEST_DATABASE_URL, 'TEST_DATABASE_URL'));
  const app = buildApp(() => checkDatabase(pool));
  const directory = await mkdtemp(path.join(tmpdir(), 'chess-migrations-'));
  try {
    await checkDatabase(pool);
    await migrate(pool);
    expect(await migrate(pool)).toEqual([]);
    expect((await pool.query("SELECT schema_name FROM information_schema.schemata WHERE schema_name = 'chess'")).rowCount).toBe(1);
    expect((await app.inject('/health/ready')).statusCode).toBe(200);

    await cp(migrationDirectory, directory, { recursive: true });
    await writeFile(path.join(directory, '001_initial.sql'), 'SELECT 1;');
    await expect(migrate(pool, directory)).rejects.toThrow('missing or changed');

    await cp(migrationDirectory, directory, { recursive: true });
    await writeFile(path.join(directory, '999_failure_probe.sql'),
      'CREATE TABLE chess.migration_rollback_probe (id integer); SELECT * FROM chess.table_that_does_not_exist;');
    await expect(migrate(pool, directory)).rejects.toThrow();
    expect((await pool.query("SELECT to_regclass('chess.migration_rollback_probe') AS name")).rows[0].name).toBeNull();
    expect((await pool.query("SELECT name FROM public.schema_migrations WHERE name = '999_failure_probe.sql'")).rowCount).toBe(0);
  } finally {
    await app.close();
    await pool.end();
    await rm(directory, { recursive: true, force: true });
  }
});
