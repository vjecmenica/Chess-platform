import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import type pg from 'pg';
import { STANDARD_STARTING_FEN } from '@chess/domain';
import { databaseUrl, loadEnvironment } from '../src/config.js';
import { checkDatabase, createPool } from '../src/database.js';
import { migrate } from '../src/migrations.js';
import { buildApp } from '../src/app.js';

interface Guest { cookie: string; csrf: string }

describe('earlier untimed guest games against PostgreSQL', () => {
  let pool: pg.Pool;
  let app: FastifyInstance;

  beforeAll(async () => {
    loadEnvironment();
    pool = createPool(databaseUrl(process.env.TEST_DATABASE_URL, 'TEST_DATABASE_URL'));
    await checkDatabase(pool);
    await migrate(pool);
    app = buildApp(() => checkDatabase(pool), false, { pool, secureCookies: true });
  });

  afterAll(async () => {
    if (app) await app.close();
    if (pool) await pool.end();
  });

  async function guest(): Promise<Guest> {
    const response = await app.inject('/guest-session');
    expect(response.statusCode).toBe(200);
    return { cookie: String(response.headers['set-cookie']).split(';')[0]!,
      csrf: response.json().csrfToken as string };
  }

  async function acceptedGame() {
    const white = await guest();
    const black = await guest();
    const created = await app.inject({ method: 'POST', url: '/challenges',
      headers: { cookie: white.cookie, 'x-csrf-token': white.csrf,
        'idempotency-key': randomUUID() } });
    expect(created.statusCode).toBe(200);
    const id = created.json().id as string;
    const accepted = await app.inject({ method: 'POST', url: `/challenges/${id}/accept`,
      headers: { cookie: black.cookie, 'x-csrf-token': black.csrf } });
    expect(accepted.statusCode).toBe(200);
    // Exercise the migration's compatibility mode for games created before durable clocks.
    await pool.query(`UPDATE chess.games SET clock_mode = 'legacy_untimed',
      clock_phase = 'legacy_untimed', status = 'active' WHERE id = $1`, [id]);
    return { id, white, black };
  }

  function read(id: string, actor?: Guest, server = app) {
    return server.inject({ url: `/games/${id}`, headers: actor ? { cookie: actor.cookie } : {} });
  }

  function move(id: string, actor: Guest, expectedVersion: number, from: string, to: string,
    requestId = randomUUID()) {
    return app.inject({ method: 'POST', url: `/games/${id}/moves`,
      headers: { cookie: actor.cookie, 'x-csrf-token': actor.csrf, 'idempotency-key': requestId },
      payload: { expectedVersion, from, to } });
  }

  it('creates one standard-start game and derives the moving side from the guest seat', async () => {
    const { id, white, black } = await acceptedGame();
    const outsider = await guest();
    expect((await read(id)).statusCode).toBe(401);
    expect((await read(id, outsider)).statusCode).toBe(403);
    const initial = await read(id, white);
    expect(initial.statusCode).toBe(200);
    expect(initial.json()).toMatchObject({ id, version: 0, status: 'active', yourSeat: 'white',
      position: { fen: STANDARD_STARTING_FEN, sideToMove: 'white' }, history: [], result: null,
      clocks: null, clockStatus: 'not_integrated', rated: false,
      timeControl: { initialMs: 300000, incrementMs: 3000 } });
    expect((await read(id, black)).json().yourSeat).toBe('black');
    expect((await move(id, outsider, 0, 'e2', 'e4')).statusCode).toBe(403);
    expect((await app.inject({ method: 'POST', url: `/games/${id}/moves`,
      headers: { 'idempotency-key': randomUUID() },
      payload: { expectedVersion: 0, from: 'e2', to: 'e4' } })).statusCode).toBe(401);
    expect((await app.inject({ method: 'POST', url: `/games/${id}/moves`,
      headers: { cookie: white.cookie, 'idempotency-key': randomUUID() },
      payload: { expectedVersion: 0, from: 'e2', to: 'e4' } })).statusCode).toBe(403);
    expect((await app.inject({ method: 'POST', url: `/games/${id}/moves`,
      headers: { cookie: white.cookie, 'x-csrf-token': white.csrf,
        'idempotency-key': randomUUID() },
      payload: { expectedVersion: 0, from: 'e2', to: 'e4', side: 'black' } })).statusCode).toBe(400);
    expect((await move(id, black, 0, 'e7', 'e5')).json().error).toBe('wrong_turn');
    expect((await move(id, white, 0, 'e2', 'e5')).json().error).toBe('illegal_move');
    expect((await read(id, white)).json()).toEqual(initial.json());

    const accepted = await move(id, white, 0, 'e2', 'e4');
    expect(accepted.statusCode).toBe(200);
    expect(accepted.json()).toMatchObject({ accepted: true, move: { ply: 1, side: 'white', uci: 'e2e4' },
      game: { version: 1, yourSeat: 'white', position: { sideToMove: 'black' }, clocks: null } });
    expect((await read(id, black)).json()).toMatchObject({ version: 1, yourSeat: 'black',
      history: [{ ply: 1, uci: 'e2e4' }] });
  });

  it('serializes competing moves, rejects stale versions, and replays durable receipts', async () => {
    const { id, white, black } = await acceptedGame();
    const firstId = randomUUID();
    const secondId = randomUUID();
    const [first, second] = await Promise.all([
      move(id, white, 0, 'e2', 'e4', firstId),
      move(id, white, 0, 'd2', 'd4', secondId),
    ]);
    expect([first.statusCode, second.statusCode].sort()).toEqual([200, 409]);
    const winner = first.statusCode === 200 ? first : second;
    const winnerId = first.statusCode === 200 ? firstId : secondId;
    const winnerFrom = first.statusCode === 200 ? 'e2' : 'd2';
    const winnerTo = first.statusCode === 200 ? 'e4' : 'd4';
    expect((await move(id, white, 0, winnerFrom, winnerTo, winnerId)).json()).toEqual(winner.json());
    expect((await move(id, white, 0, 'g2', 'g4', winnerId)).json().error).toBe('request_id_conflict');
    expect((await move(id, white, 0, 'g2', 'g4')).json()).toMatchObject({
      error: 'stale_version', currentVersion: 1 });
    expect((await read(id, white)).json().history).toHaveLength(1);
    const reply = await move(id, black, 1, 'e7', 'e5');
    expect(reply.statusCode).toBe(200);
    expect((await read(id, white)).json()).toMatchObject({ version: 2,
      position: { sideToMove: 'white' }, history: [{ ply: 1 }, { ply: 2, uci: 'e7e5' }] });
    expect((await pool.query('SELECT ply FROM chess.game_moves WHERE game_id = $1', [id])).rowCount).toBe(2);
    expect((await pool.query('SELECT request_id FROM chess.game_move_receipts WHERE game_id = $1', [id])).rowCount)
      .toBe(4);
  });

  it('reconstructs after a new server instance and detects a stored-position mismatch', async () => {
    const { id, white, black } = await acceptedGame();
    expect((await move(id, white, 0, 'e2', 'e4')).statusCode).toBe(200);
    expect((await move(id, black, 1, 'e7', 'e5')).statusCode).toBe(200);
    const before = (await read(id, white)).json();
    const restarted = buildApp(() => checkDatabase(pool), false, { pool, secureCookies: true });
    try {
      expect((await read(id, white, restarted)).json()).toEqual(before);
      await pool.query('UPDATE chess.games SET fen = $2 WHERE id = $1', [id, STANDARD_STARTING_FEN]);
      expect((await read(id, white, restarted)).statusCode).toBe(500);
    } finally {
      await pool.query('UPDATE chess.games SET fen = $2 WHERE id = $1', [id, before.position.fen]);
      await restarted.close();
    }
    expect((await read(id, white)).statusCode).toBe(200);
  });

  it('stores a terminal move and result once', async () => {
    const { id, white, black } = await acceptedGame();
    expect((await move(id, white, 0, 'f2', 'f3')).statusCode).toBe(200);
    expect((await move(id, black, 1, 'e7', 'e5')).statusCode).toBe(200);
    expect((await move(id, white, 2, 'g2', 'g4')).statusCode).toBe(200);
    const mateId = randomUUID();
    const mate = await move(id, black, 3, 'd8', 'h4', mateId);
    expect(mate.json()).toMatchObject({ accepted: true, game: { version: 4, status: 'finished',
      result: { outcome: 'win', winner: 'black', reason: 'checkmate' } } });
    expect((await move(id, black, 3, 'd8', 'h4', mateId)).json()).toEqual(mate.json());
    expect((await move(id, white, 4, 'e2', 'e4')).json().error).toBe('game_finished');
    expect((await read(id, white)).json()).toMatchObject({ version: 4, status: 'finished',
      history: [{ ply: 1 }, { ply: 2 }, { ply: 3 }, { ply: 4, san: 'Qh4#' }] });
    const restarted = buildApp(() => checkDatabase(pool), false, { pool, secureCookies: true });
    try {
      const saved = (await read(id, white, restarted)).json();
      expect(saved.result).toEqual(mate.json().game.result);
      expect(saved.history.map((entry: { beforeFen: string; afterFen: string }, index: number) =>
        index === 0 ? entry.beforeFen === STANDARD_STARTING_FEN
          : entry.beforeFen === saved.history[index - 1].afterFen)).toEqual([true, true, true, true]);
      expect(saved.history[3].afterFen).toBe(saved.position.fen);
    } finally {
      await restarted.close();
    }
    expect((await pool.query('SELECT ply FROM chess.game_moves WHERE game_id = $1', [id])).rowCount).toBe(4);
  });
});
