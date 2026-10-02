import { randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import type pg from 'pg';
import { databaseUrl, loadEnvironment } from '../src/config.js';
import { checkDatabase, createPool } from '../src/database.js';
import { migrate, migrationDirectory } from '../src/migrations.js';
import { buildApp } from '../src/app.js';
import { createGameService } from '../src/game-service.js';

describe('casual timeout finalization against PostgreSQL', () => {
  let pool: pg.Pool;
  const apps: FastifyInstance[] = [];
  const time = { value: 1_500_000_000_000, nowMs() { return this.value; } };

  beforeAll(async () => {
    loadEnvironment();
    pool = createPool(databaseUrl(process.env.TEST_DATABASE_URL, 'TEST_DATABASE_URL'));
    await checkDatabase(pool);
    await migrate(pool);
  });
  afterEach(async () => {
    for (const app of apps.splice(0)) await app.close();
    time.value = 1_500_000_000_000;
  });
  afterAll(async () => { if (pool) await pool.end(); });

  function instance() {
    const service = createGameService(pool, time);
    const app = buildApp(() => checkDatabase(pool), false,
      { pool, secureCookies: true, gameService: service });
    apps.push(app);
    return { app, service };
  }
  async function guest(app: FastifyInstance) {
    const response = await app.inject('/guest-session');
    return { cookie: String(response.headers['set-cookie']).split(';')[0]!,
      csrf: response.json().csrfToken as string };
  }
  function read(app: FastifyInstance, id: string, cookie: string) {
    return app.inject({ url: `/games/${id}`, headers: { cookie } });
  }
  async function challenge(app: FastifyInstance) {
    const white = await guest(app);
    const black = await guest(app);
    const created = await app.inject({ method: 'POST', url: '/challenges',
      headers: { cookie: white.cookie, 'x-csrf-token': white.csrf,
        'idempotency-key': randomUUID() } });
    const id = created.json().id as string;
    expect((await app.inject({ method: 'POST', url: `/challenges/${id}/accept`,
      headers: { cookie: black.cookie, 'x-csrf-token': black.csrf } })).statusCode).toBe(200);
    await pool.query(`UPDATE chess.games SET clock_start_mode = 'first_move',
      white_first_move_deadline_at = NULL WHERE id = $1`, [id]);
    return { id, white, black };
  }
  async function runningGame(app: FastifyInstance) {
    const players = await challenge(app);
    expect((await app.inject({ method: 'POST', url: `/games/${players.id}/moves`,
      headers: { cookie: players.white.cookie, 'x-csrf-token': players.white.csrf,
        'idempotency-key': randomUUID() },
      payload: { expectedVersion: 0, from: 'e2', to: 'e4' } })).statusCode).toBe(200);
    const deadlineMs = (await read(app, players.id, players.black.cookie)).json().clocks.deadlineMs as number;
    return { ...players, deadlineMs };
  }

  it('settles Black at 00:00 without a mate-search worker and restores both views after restart', async () => {
    const first = instance();
    const { id, white, black, deadlineMs } = await runningGame(first.app);
    time.value = deadlineMs;
    expect(await first.service.pollDueGames()).toBe(1);
    for (const player of [white, black]) {
      expect((await read(first.app, id, player.cookie)).json()).toMatchObject({
        version: 2, status: 'finished', timeoutAdjudication: null,
        result: { outcome: 'win', winner: 'white', reason: 'timeout',
          flaggedSide: 'black', deadlineMs },
        clocks: { phase: 'flagged', flaggedSide: 'black', remainingMs: { black: 0 } },
        history: [{ san: 'e4' }],
      });
    }
    await first.app.close();
    apps.splice(apps.indexOf(first.app), 1);
    const restarted = instance();
    expect((await read(restarted.app, id, black.cookie)).json()).toMatchObject({
      version: 2, status: 'finished', result: { winner: 'white', reason: 'timeout' } });
    expect(await restarted.service.pollDueGames()).toBe(0);
  });

  it('records a proven no-mate timeout draw durably', async () => {
    const { app, service } = instance();
    const { id, white, black } = await challenge(app);
    const fen = '4k3/8/8/8/8/8/8/R3K3 w - - 0 1';
    const deadlineMs = time.value + 300_000;
    // A trusted database fixture supplies a legal position; public challenges still start normally.
    await pool.query(`UPDATE chess.games SET starting_fen = $2, fen = $2,
      clock_start_mode = 'readiness', ready_white = true, ready_black = true,
      clock_phase = 'running', version = 2, turn_started_at = $3, deadline_at = $4
      WHERE id = $1`, [id, fen, new Date(time.value), new Date(deadlineMs)]);
    time.value = deadlineMs;
    expect(await service.pollDueGames()).toBe(1);
    for (const player of [white, black]) {
      expect((await read(app, id, player.cookie)).json()).toMatchObject({
        version: 3, status: 'finished', result: { outcome: 'draw',
          reason: 'timeout_no_mating_possibility', flaggedSide: 'white', deadlineMs },
        clocks: { phase: 'flagged', remainingMs: { white: 0 } },
      });
    }
  });

  it('lets concurrent due-clock pollers produce one final result', async () => {
    const first = instance();
    const second = instance();
    const { id, white, deadlineMs } = await runningGame(first.app);
    await second.service.start();
    time.value = deadlineMs;
    const counts = await Promise.all([first.service.pollDueGames(), second.service.pollDueGames()]);
    expect(counts.reduce((sum, count) => sum + count, 0)).toBe(1);
    expect((await read(second.app, id, white.cookie)).json()).toMatchObject({
      version: 2, status: 'finished', result: { winner: 'white', reason: 'timeout' } });
  });

  it('notifies the other server only after the final timeout commits', async () => {
    const writer = instance();
    const reader = instance();
    const { id, white, black, deadlineMs } = await runningGame(writer.app);
    const origin = await reader.app.listen({ host: '127.0.0.1', port: 0 });
    const abort = new AbortController();
    const timeout = setTimeout(() => abort.abort(), 2_000);
    try {
      const response = await fetch(`${origin}/games/${id}/events`,
        { headers: { cookie: black.cookie }, signal: abort.signal });
      expect(response.status).toBe(200);
      const stream = response.body!.getReader();
      expect(new TextDecoder().decode((await stream.read()).value)).toContain(': connected');
      const update = (async () => {
        let text = '';
        for (;;) {
          const chunk = await stream.read();
          if (chunk.done) throw new Error('The game stream closed before the timeout update.');
          text += new TextDecoder().decode(chunk.value);
          const match = /event: game\ndata: (\{[^\n]+\})\n\n/.exec(text);
          if (match) return JSON.parse(match[1]!) as { version: number };
        }
      })();
      time.value = deadlineMs;
      await reader.service.heartbeat();
      expect(await writer.service.pollDueGames()).toBeGreaterThanOrEqual(1);
      expect(await update).toEqual({ version: 2 });
      for (const player of [white, black]) {
        expect((await read(reader.app, id, player.cookie)).json()).toMatchObject({
          status: 'finished', result: { winner: 'white', reason: 'timeout' } });
      }
    } finally {
      clearTimeout(timeout);
      abort.abort();
    }
  });

  it('migrates an exhausted historical pending timeout to a recoverable result', async () => {
    const first = instance();
    const { id, white, black, deadlineMs } = await runningGame(first.app);
    time.value = deadlineMs;
    await first.service.pollDueGames();
    await pool.query(`UPDATE chess.games SET status = 'pending_adjudication', result = NULL,
      pending = $2::jsonb, timeout_search_exhausted_at = now(), version = 3
      WHERE id = $1`, [id, JSON.stringify({ kind: 'timeout', flaggedSide: 'black', deadlineMs })]);
    const sql = await readFile(join(migrationDirectory, '011_finalize_casual_timeouts.sql'), 'utf8');
    await pool.query(sql);
    await first.app.close();
    apps.splice(apps.indexOf(first.app), 1);
    const restarted = instance();
    for (const player of [white, black]) {
      expect((await read(restarted.app, id, player.cookie)).json()).toMatchObject({
        version: 4, status: 'finished', result: { outcome: 'win', winner: 'white',
          reason: 'timeout', flaggedSide: 'black', deadlineMs }, clocks: { phase: 'flagged' } });
    }
  });
});
