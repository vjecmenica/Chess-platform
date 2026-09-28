import { createHash } from 'node:crypto';
import { readdir, readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import type pg from 'pg';

export const migrationDirectory = fileURLToPath(new URL('../migrations/', import.meta.url));

export async function migrate(pool: pg.Pool, directory = migrationDirectory): Promise<string[]> {
  const names = (await readdir(directory)).filter(name => name.endsWith('.sql')).sort();
  if (names.length === 0 || names.some(name => !/^\d{3}_[a-z0-9_]+\.sql$/.test(name))) {
    throw new Error('Expected versioned SQL files named 001_description.sql in the migration directory.');
  }
  const versions = names.map(name => name.slice(0, 3));
  if (new Set(versions).size !== versions.length) throw new Error('Migration version numbers must be unique.');
  const migrations = await Promise.all(names.map(async name => {
    const sql = (await readFile(path.join(directory, name), 'utf8')).replace(/\r\n/g, '\n');
    return { name, sql, checksum: createHash('sha256').update(sql).digest('hex') };
  }));

  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    // Serialize migration runners, including creation of the bookkeeping table.
    await client.query("SELECT pg_advisory_xact_lock(hashtext('chess-platform:migrations'))");
    await client.query(`CREATE TABLE IF NOT EXISTS public.schema_migrations (
      name text PRIMARY KEY,
      checksum text NOT NULL,
      applied_at timestamptz NOT NULL DEFAULT now()
    )`);
    const { rows } = await client.query<{ name: string; checksum: string }>(
      'SELECT name, checksum FROM public.schema_migrations ORDER BY name',
    );
    for (const row of rows) {
      if (migrations.find(migration => migration.name === row.name)?.checksum !== row.checksum) {
        throw new Error(`Applied migration ${row.name} is missing or changed. Restore it and add a new migration instead.`);
      }
    }
    const applied = new Set(rows.map(row => row.name));
    const pending = migrations.filter(migration => !applied.has(migration.name));
    const latest = rows.at(-1)?.name;
    if (latest && pending.some(migration => migration.name < latest)) {
      throw new Error('New migrations must sort after all applied migrations.');
    }
    for (const migration of pending) {
      await client.query(migration.sql);
      await client.query('INSERT INTO public.schema_migrations (name, checksum) VALUES ($1, $2)',
        [migration.name, migration.checksum]);
    }
    await client.query('COMMIT');
    return pending.map(migration => migration.name);
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}
