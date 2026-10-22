import { createHash } from 'node:crypto';
import { createReadStream } from 'node:fs';
import { basename } from 'node:path';
import type pg from 'pg';
import { prepareExplorerGame, streamPgnGames, type ExplorerGame } from './explorer-pgn.js';

export interface ImportCounts { processed: number; accepted: number; skipped: number; invalid: number }
export interface ImportReport extends ImportCounts { alreadyImported: boolean }
export const defaultOpeningPlies = 24;

export async function importExplorerFile(pool: pg.Pool, file: string, options: {
  maxPlies?: number; batchSize?: number; onProgress?: (counts: ImportCounts) => void;
} = {}): Promise<ImportReport> {
  const maxPlies = options.maxPlies ?? defaultOpeningPlies, batchSize = options.batchSize ?? 100;
  if (!Number.isInteger(maxPlies) || maxPlies < 1 || maxPlies > 80)
    throw new Error('Opening depth must be between 1 and 80 plies.');
  if (!Number.isInteger(batchSize) || batchSize < 1 || batchSize > 500)
    throw new Error('Batch size must be between 1 and 500 games.');
  const client = await pool.connect();
  let locked = false;
  try {
    locked = (await client.query<{ locked: boolean }>(
      "SELECT pg_try_advisory_lock(hashtext('chess-platform:explorer-import')) AS locked")).rows[0]!.locked;
    if (!locked) throw new Error('Another opening import is running. Retry after it finishes.');
    // First pass reads bytes only. No source content or filesystem path is saved.
    const hash = createHash('sha256');
    for await (const chunk of createReadStream(file)) hash.update(chunk);
    const checksum = hash.digest('hex');
    await client.query(`INSERT INTO chess.explorer_config (max_plies) VALUES ($1) ON CONFLICT DO NOTHING`, [maxPlies]);
    const config = (await client.query<{ max_plies: number }>('SELECT max_plies FROM chess.explorer_config')).rows[0]!;
    if (config.max_plies !== maxPlies)
      throw new Error(`This explorer uses ${config.max_plies} plies. Changing depth requires a separate rebuild database.`);
    const previous = (await client.query<{ status: string }>(
      'SELECT status FROM chess.explorer_imports WHERE checksum = $1', [checksum])).rows[0];
    if (previous?.status === 'complete') return { processed: 0, accepted: 0, skipped: 0, invalid: 0, alreadyImported: true };
    await client.query(`INSERT INTO chess.explorer_imports (checksum, source_name, status)
      VALUES ($1, $2, 'running') ON CONFLICT (checksum) DO UPDATE SET status = 'running',
      processed = 0, accepted = 0, skipped = 0, invalid = 0, updated_at = now()`, [checksum, basename(file)]);
    const counts: ImportCounts = { processed: 0, accepted: 0, skipped: 0, invalid: 0 };
    let batch: ExplorerGame[] = [], sinceFlush = 0;
    const flush = async (complete = false) => {
      await client.query('BEGIN');
      try {
        const fresh = batch.length ? (await client.query<{ fingerprint: string }>(`
          INSERT INTO chess.explorer_games (fingerprint)
          SELECT decode(value, 'hex') FROM jsonb_array_elements_text($1::jsonb)
          ON CONFLICT DO NOTHING RETURNING encode(fingerprint, 'hex') AS fingerprint`,
        [JSON.stringify(batch.map(game => game.fingerprint))])).rows : [];
        const inserted = new Set(fresh.map(row => row.fingerprint));
        const counters = new Map<string, { position: string; uci: string; white: number; draws: number; black: number }>();
        for (const game of batch) {
          if (!inserted.delete(game.fingerprint)) { counts.skipped += 1; continue; }
          counts.accepted += 1;
          for (const move of game.moves) {
            const key = `${move.position}:${move.uci}`;
            const counter = counters.get(key) ?? { ...move, white: 0, draws: 0, black: 0 };
            counter[game.result === '1-0' ? 'white' : game.result === '0-1' ? 'black' : 'draws'] += 1;
            counters.set(key, counter);
          }
        }
        if (counters.size) await client.query(`INSERT INTO chess.explorer_moves (position, uci, white, draws, black)
          SELECT position, uci, white, draws, black FROM jsonb_to_recordset($1::jsonb)
            AS x(position text, uci text, white bigint, draws bigint, black bigint)
          ON CONFLICT (position, uci) DO UPDATE SET
            white = chess.explorer_moves.white + EXCLUDED.white,
            draws = chess.explorer_moves.draws + EXCLUDED.draws,
            black = chess.explorer_moves.black + EXCLUDED.black`, [JSON.stringify([...counters.values()])]);
        await client.query(`UPDATE chess.explorer_imports SET processed=$2, accepted=$3, skipped=$4,
          invalid=$5, status=$6, updated_at=now() WHERE checksum=$1`, [checksum, counts.processed,
          counts.accepted, counts.skipped, counts.invalid, complete ? 'complete' : 'running']);
        await client.query('COMMIT');
      } catch (error) { await client.query('ROLLBACK'); throw error; }
      batch = []; sinceFlush = 0;
      options.onProgress?.({ ...counts });
    };
    try {
      for await (const text of streamPgnGames(file)) {
        counts.processed += 1; sinceFlush += 1;
        try {
          const game = prepareExplorerGame(text, maxPlies);
          if (game) batch.push(game); else counts.skipped += 1;
        } catch { counts.invalid += 1; }
        if (sinceFlush >= batchSize) await flush();
      }
      await flush(true);
      return { ...counts, alreadyImported: false };
    } catch (error) {
      await client.query(`UPDATE chess.explorer_imports SET status='failed', updated_at=now() WHERE checksum=$1`, [checksum]);
      throw error;
    }
  } finally {
    try {
      if (locked) await client.query("SELECT pg_advisory_unlock(hashtext('chess-platform:explorer-import'))");
    } finally { client.release(); }
  }
}
