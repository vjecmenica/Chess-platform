import { databaseUrl, loadEnvironment } from './config.js';
import { createPool } from './database.js';
import { importExplorerFile } from './explorer-import.js';
import { resolve } from 'node:path';

async function main() {
  loadEnvironment();
  const args = process.argv.slice(2), files: string[] = [];
  if (args.includes('--help')) {
    console.log('Usage: npm run explorer:import -- --max-plies 24 --batch-size 100 file.pgn [more.pgn]');
    console.log('Stores complete private games and tags. Index depth counts plies (24 = 12 full moves), not game length.');
    console.log('Start with a small pilot in a disposable database. See docs/opening-explorer.md.');
    return;
  }
  let maxPlies = 24, batchSize = 100;
  for (let i = 0; i < args.length; i += 1) {
    if (args[i] === '--max-plies') maxPlies = Number(args[++i]);
    else if (args[i] === '--batch-size') batchSize = Number(args[++i]);
    else if (args[i]!.startsWith('--')) throw new Error('Unknown option. Use --max-plies 24 --batch-size 100 followed by PGN file paths.');
    else files.push(args[i]!);
  }
  if (!files.length) throw new Error('Supply one or more local PGN files. See docs/opening-explorer.md.');
  const pool = createPool(databaseUrl(process.env.DATABASE_URL));
  try {
    for (let i = 0; i < files.length; i += 1) {
      console.log(`Importing file ${i + 1}/${files.length} (paths and game content are not logged).`);
      // npm runs workspace scripts in apps/server; relative arguments belong to
      // the caller's directory, not that implementation detail.
      const file = resolve(process.env.INIT_CWD ?? process.cwd(), files[i]!);
      const result = await importExplorerFile(pool, file, { maxPlies, batchSize,
        onProgress: counts => { if (counts.processed % 10_000 === 0) console.log(JSON.stringify(counts)); } });
      console.log(JSON.stringify(result));
    }
  } finally { await pool.end(); }
}
main().catch((error: unknown) => {
  const code = typeof error === 'object' && error !== null && 'code' in error ? String(error.code) : null;
  console.error(code ? `Opening import failed (${code}). Check input accessibility, database availability, and migrations. Committed batches are safe to retry.`
    : error instanceof Error ? error.message : 'Opening import failed.');
  process.exitCode = 1;
});
