import { mkdtemp, writeFile, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type pg from 'pg';
import { normalizedPositionKey, STANDARD_STARTING_FEN } from '@chess/domain';
import { buildApp } from '../src/app.js';
import { loadEnvironment, databaseUrl } from '../src/config.js';
import { createPool } from '../src/database.js';
import { migrate } from '../src/migrations.js';
import { importExplorerFile } from '../src/explorer-import.js';

const fixture = fileURLToPath(new URL('./fixtures/opening-book.pgn', import.meta.url));
describe('local opening explorer in PostgreSQL', () => {
  let pool: pg.Pool, directory: string;
  beforeAll(async () => {
    loadEnvironment(); pool = createPool(databaseUrl(process.env.TEST_DATABASE_URL, 'TEST_DATABASE_URL'));
    await migrate(pool); directory = await mkdtemp(join(tmpdir(), 'chess-synthetic-book-'));
  });
  beforeEach(async () => { await pool.query('TRUNCATE chess.explorer_game_positions, chess.explorer_records, chess.explorer_moves, chess.explorer_games, chess.explorer_imports, chess.explorer_config'); });
  afterAll(async () => { if (pool) await pool.end(); });

  it('aggregates transpositions and results, survives restart, without returning raw source text', async () => {
    expect(await importExplorerFile(pool, fixture, { batchSize: 2 })).toMatchObject({
      processed: 6, accepted: 3, skipped: 2, invalid: 1 });
    const fen = 'rnbqkb1r/ppp1pppp/5n2/3p4/3P4/5N2/PPP1PPPP/RNBQKB1R w KQkq - 4 3';
    const app = buildApp(async () => {}, false, { pool, secureCookies: true });
    try {
      expect((await app.inject(`/opening-explorer?fen=${encodeURIComponent(fen)}`)).statusCode).toBe(401);
      const session = await app.inject('/guest-session');
      const headers = { cookie: String(session.headers['set-cookie']).split(';')[0]! };
      const response = await app.inject({ url: `/opening-explorer?fen=${encodeURIComponent(fen)}`, headers });
      expect(response.statusCode).toBe(200);
      const listing = (await app.inject({ url: '/opening-explorer/games?fen=' + encodeURIComponent(fen), headers })).json();
      expect(listing.games).toHaveLength(3);
      expect(listing.totalPages).toBe(1);
      expect(listing.games.every((g: { ply: number; uci: string }) => g.ply === 4 && g.uci === 'c2c4')).toBe(true);
      expect(response.json()).toEqual({ opening: null, moves: [{ uci: 'c2c4', san: 'c4', white: 1, draws: 1, black: 1 }] });
      const changedCounters = await app.inject({ url: `/opening-explorer?fen=${encodeURIComponent(fen.replace('4 3', '0 17'))}`, headers });
      expect(changedCounters.json()).toEqual(response.json());
      expect((await app.inject({ url: '/opening-explorer?fen=invalid-position', headers })).statusCode).toBe(400);
      expect((await app.inject({ url: `/opening-explorer?fen=${encodeURIComponent(fen)}&download=all`, headers })).statusCode).toBe(400);
      const empty = '4k3/8/8/8/8/8/8/4K3 w - - 0 1';
      expect((await app.inject({ url: `/opening-explorer?fen=${encodeURIComponent(empty)}`, headers })).json().moves).toEqual([]);
      const restarted = buildApp(async () => {}, false, { pool, secureCookies: true });
      try { expect((await restarted.inject({ url: `/opening-explorer?fen=${encodeURIComponent(fen)}`, headers })).json()).toEqual(response.json()); }
      finally { await restarted.close(); }
    } finally { await app.close(); }
  });

  it('does not double-count repeated files or overlapping files with added rating/ID headers', async () => {
    await importExplorerFile(pool, fixture);
    expect(await importExplorerFile(pool, fixture)).toMatchObject({ alreadyImported: true, accepted: 0 });
    const copy = join(directory, 'overlap.pgn');
    await writeFile(copy, (await readFile(fixture, 'utf8')).replace('[Site "Test"]', '[WhiteFideId "123"]\n[WhiteElo "2400"]\n[Site "Test"]'));
    expect(await importExplorerFile(pool, copy)).toMatchObject({ processed: 6, accepted: 0, skipped: 5, invalid: 1 });
    expect(Number((await pool.query('SELECT count(*) FROM chess.explorer_games')).rows[0].count)).toBe(3);
    expect((await pool.query('SELECT sum(white+draws+black) AS n FROM chess.explorer_moves WHERE position=$1',
      [normalizedPositionKey(STANDARD_STARTING_FEN)])).rows[0].n).toBe('3');
    await expect(importExplorerFile(pool, copy, { maxPlies: 30 })).rejects.toThrow('rebuild');
  });

  it('recovers committed batches after interruption and serializes administrative imports', async () => {
    const held = await pool.connect();
    await held.query("SELECT pg_advisory_lock(hashtext('chess-platform:explorer-import'))");
    try { await expect(importExplorerFile(pool, fixture)).rejects.toThrow('Another opening import'); }
    finally { await held.query("SELECT pg_advisory_unlock(hashtext('chess-platform:explorer-import'))"); held.release(); }
    await expect(importExplorerFile(pool, fixture, { batchSize: 1, onProgress: () => { throw new Error('Simulated interruption'); } }))
      .rejects.toThrow('Simulated interruption');
    expect(await importExplorerFile(pool, fixture, { batchSize: 2 })).toMatchObject({ accepted: 2, skipped: 3, invalid: 1 });
    expect((await pool.query('SELECT count(*) FROM chess.explorer_games')).rows[0].count).toBe('3');
    expect((await pool.query('SELECT status FROM chess.explorer_imports')).rows[0].status).toBe('complete');
  });

  it('enforces the configured opening depth and recovers after a malformed/oversized game', async () => {
    const damaged = join(directory, 'damaged.pgn');
    await writeFile(damaged, '[Event "Damaged"]\n\n' + 'x'.repeat(1_100_000) + '\n' + await readFile(fixture, 'utf8'));
    expect(await importExplorerFile(pool, damaged, { maxPlies: 1 })).toMatchObject({ processed: 7, accepted: 3, skipped: 2, invalid: 2 });
    const positions = (await pool.query('SELECT DISTINCT position FROM chess.explorer_moves')).rows;
    expect(positions).toEqual([{ position: normalizedPositionKey(STANDARD_STARTING_FEN) }]);
  });

  it('rolls back fingerprints with counters when a batch cannot commit', async () => {
    await pool.query('ALTER TABLE chess.explorer_moves ADD CONSTRAINT synthetic_import_failure CHECK (false) NOT VALID');
    try {
      await expect(importExplorerFile(pool, fixture)).rejects.toMatchObject({ code: '23514' });
      expect((await pool.query('SELECT count(*) FROM chess.explorer_games')).rows[0].count).toBe('0');
      expect((await pool.query('SELECT count(*) FROM chess.explorer_records')).rows[0].count).toBe('0');
      expect((await pool.query('SELECT count(*) FROM chess.explorer_game_positions')).rows[0].count).toBe('0');
    } finally { await pool.query('ALTER TABLE chess.explorer_moves DROP CONSTRAINT synthetic_import_failure'); }
    expect(await importExplorerFile(pool, fixture)).toMatchObject({ accepted: 3, invalid: 1 });
  });

  it('bounds requests and returns a recoverable service error for a blocked query', async () => {
    const app = buildApp(async () => {}, false, { pool, secureCookies: true });
    const locker = await pool.connect();
    try {
      const guest = await app.inject('/guest-session');
      const headers = { cookie: String(guest.headers['set-cookie']).split(';')[0]! };
      const query = () => app.inject({ url: `/opening-explorer?fen=${encodeURIComponent(STANDARD_STARTING_FEN)}`, headers });
      await locker.query('BEGIN'); await locker.query('LOCK chess.explorer_moves IN ACCESS EXCLUSIVE MODE');
      const blocked = await query();
      expect(blocked.statusCode).toBe(503);
      expect(blocked.json()).toEqual({ error: 'explorer_unavailable' });
      await locker.query('ROLLBACK');
      for (let i = 0; i < 119; i += 1) expect((await query()).statusCode).toBe(200);
      const limited = await query();
      expect(limited.statusCode).toBe(429); expect(limited.headers['retry-after']).toBe('60');
    } finally { await locker.query('ROLLBACK'); locker.release(); await app.close(); }
  });

  it('preserves original CRLF PGNs and tags while extracting complete records beyond indexed depth', async () => {
    const source = '[Event "Preservation"]\r\n[White "A"]\r\n[Black "B"]\r\n[WhiteElo "2410"]\r\n[BlackElo "?"]\r\n[WhiteFideId "123"]\r\n[TimeControl "40/7200:3600"]\r\n[Custom "unknown value"]\r\n[Result "1-0"]\r\n\r\n1. e4 {Keep this comment} e5 2. Nf3 Nc6 1-0';
    const file = join(directory, 'preserved.pgn'); await writeFile(file, source);
    await importExplorerFile(pool, file, { maxPlies: 1 });
    const record = (await pool.query('SELECT * FROM chess.explorer_records')).rows[0];
    expect(record.original_pgn).toBe(source);
    expect(record.tags).toMatchObject({ Custom: 'unknown value', BlackElo: '?', TimeControl: '40/7200:3600' });
    expect(record).toMatchObject({ white_rating: 2410, black_rating: null, white_fide_id: '123', time_control: '40/7200:3600' });
    const app = buildApp(async () => {}, false, { pool, secureCookies: true });
    try {
      const guest = await app.inject('/guest-session');
      const headers = { cookie: String(guest.headers['set-cookie']).split(';')[0]! };
      const url = `/opening-explorer/games?fen=${encodeURIComponent(STANDARD_STARTING_FEN)}`;
      expect((await app.inject(url)).statusCode).toBe(401);
      const list = await app.inject({ url, headers });
      expect(list.json().games[0]).toMatchObject({ id: record.id, white_name: 'A', white_rating: 2410, ply: 0, uci: 'e2e4' });
      expect(list.body).not.toMatch(/original_pgn|Keep this comment/);
      const replay = await app.inject({ url: `/opening-explorer/games/${record.id}?fen=${encodeURIComponent(STANDARD_STARTING_FEN)}`, headers });
      expect(replay.statusCode).toBe(200);
      expect(replay.json().game.moves).toHaveLength(4);
      expect(replay.json().game.headers.Custom).toBe('unknown value');
      expect(replay.body).not.toContain('Keep this comment');
      expect((await app.inject({ url: url + '&page=5', headers })).statusCode).toBe(400);
      expect((await app.inject({ url: url + '&page=-1', headers })).statusCode).toBe(400);
      expect((await app.inject({ url: url + '&limit=10000', headers })).statusCode).toBe(400);
    } finally { await app.close(); }
    await importExplorerFile(pool, file, { maxPlies: 1 });
    expect((await pool.query('SELECT count(*) FROM chess.explorer_records')).rows[0].count).toBe('1');
  });

  it('paginates a restricted sample and limits replay to games in that position sample', async () => {
    const file = join(directory, 'pages.pgn');
    await writeFile(file, Array.from({ length: 53 }, (_, i) => `[Event "Synthetic ${i}"]\n[Result "1-0"]\n\n1. e4 e5 1-0\n\n`).join(''));
    await importExplorerFile(pool, file, { batchSize: 7 });
    const app = buildApp(async () => {}, false, { pool, secureCookies: true });
    try {
      const guest = await app.inject('/guest-session');
      const headers = { cookie: String(guest.headers['set-cookie']).split(';')[0]! };
      const url = `/opening-explorer/games?fen=${encodeURIComponent(STANDARD_STARTING_FEN)}`;
      const first = (await app.inject({ url, headers })).json();
      const second = (await app.inject({ url: url + '&page=1', headers })).json();
      expect(first.games).toHaveLength(10); expect(first.hasMore).toBe(true);
      expect(first.totalPages).toBe(5);
      expect(second.totalPages).toBe(5);
      expect(second.games.every((g: { id: string }) => !first.games.some((f: { id: string }) => f.id === g.id))).toBe(true);
      expect((await app.inject({ url: url + '&page=4', headers })).json()).toMatchObject({ hasMore: false, page: 4 });
      const last = (await pool.query('SELECT max(id)::text AS id FROM chess.explorer_records')).rows[0].id;
      expect((await app.inject({ url: `/opening-explorer/games/${last}?fen=${encodeURIComponent(STANDARD_STARTING_FEN)}`, headers })).statusCode).toBe(404);
    } finally { await app.close(); }
  });

  it('backfills aggregate-only records without incrementing their statistics', async () => {
    await importExplorerFile(pool, fixture);
    const before = (await pool.query('SELECT * FROM chess.explorer_moves ORDER BY position, uci')).rows;
    await pool.query('DELETE FROM chess.explorer_game_positions');
    await pool.query('DELETE FROM chess.explorer_records');
    await pool.query("UPDATE chess.explorer_imports SET status='failed'");
    expect(await importExplorerFile(pool, fixture)).toMatchObject({ accepted: 0, skipped: 5, invalid: 1 });
    expect((await pool.query('SELECT count(*) FROM chess.explorer_records')).rows[0].count).toBe('3');
    expect((await pool.query('SELECT * FROM chess.explorer_moves ORDER BY position, uci')).rows).toEqual(before);
    expect(await importExplorerFile(pool, fixture)).toMatchObject({ alreadyImported: true });
  });
});
