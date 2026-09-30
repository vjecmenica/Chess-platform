import { randomUUID } from 'node:crypto';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import type pg from 'pg';
import { databaseUrl, loadEnvironment } from '../src/config.js';
import { checkDatabase, createPool } from '../src/database.js';
import { migrate } from '../src/migrations.js';
import { buildApp } from '../src/app.js';
import { createGameService } from '../src/game-service.js';

interface Guest { cookie: string; csrf: string }

describe('durable 5+3 guest clocks against PostgreSQL', () => {
  let pool: pg.Pool;
  const apps: FastifyInstance[] = [];

  beforeAll(async () => {
    loadEnvironment();
    pool = createPool(databaseUrl(process.env.TEST_DATABASE_URL, 'TEST_DATABASE_URL'));
    await checkDatabase(pool);
    await migrate(pool);
  });
  afterEach(async () => { for (const app of apps.splice(0)) await app.close(); });
  afterAll(async () => { if (pool) await pool.end(); });

  function fixture(start = 2_000_000_000_000) {
    const time = { value: start, nowMs() { return this.value; }, set(value: number) { this.value = value; } };
    const service = createGameService(pool, time);
    const app = buildApp(() => checkDatabase(pool), false,
      { pool, secureCookies: true, gameService: service });
    apps.push(app);
    return { app, service, time };
  }

  async function guest(app: FastifyInstance): Promise<Guest> {
    const response = await app.inject('/guest-session');
    expect(response.statusCode).toBe(200);
    return { cookie: String(response.headers['set-cookie']).split(';')[0]!,
      csrf: response.json().csrfToken as string };
  }

  async function challenge(app: FastifyInstance) {
    const white = await guest(app);
    const black = await guest(app);
    const created = await app.inject({ method: 'POST', url: '/challenges',
      headers: { cookie: white.cookie, 'x-csrf-token': white.csrf,
        'idempotency-key': randomUUID() } });
    expect(created.statusCode).toBe(200);
    const id = created.json().id as string;
    const accepted = await app.inject({ method: 'POST', url: `/challenges/${id}/accept`,
      headers: { cookie: black.cookie, 'x-csrf-token': black.csrf } });
    expect(accepted.statusCode).toBe(200);
    return { id, white, black };
  }

  function read(app: FastifyInstance, id: string, actor: Guest) {
    return app.inject({ url: `/games/${id}`, headers: { cookie: actor.cookie } });
  }
  function ready(app: FastifyInstance, id: string, actor: Guest) {
    return app.inject({ method: 'POST', url: `/games/${id}/ready`,
      headers: { cookie: actor.cookie, 'x-csrf-token': actor.csrf } });
  }
  function move(app: FastifyInstance, id: string, actor: Guest, expectedVersion: number,
    from: string, to: string, requestId = randomUUID()) {
    return app.inject({ method: 'POST', url: `/games/${id}/moves`,
      headers: { cookie: actor.cookie, 'x-csrf-token': actor.csrf,
        'idempotency-key': requestId }, payload: { expectedVersion, from, to } });
  }
  async function start(app: FastifyInstance) {
    const players = await challenge(app);
    expect((await ready(app, players.id, players.white)).statusCode).toBe(200);
    const second = await ready(app, players.id, players.black);
    expect(second.statusCode).toBe(200);
    return { ...players, started: second.json() };
  }

  it('authorizes both readiness commands and starts White only after the second seat is ready', async () => {
    const { app, time } = fixture();
    const { id, white, black } = await challenge(app);
    const outsider = await guest(app);
    expect((await ready(app, id, outsider)).statusCode).toBe(403);
    expect((await app.inject({ method: 'POST', url: `/games/${id}/ready`,
      headers: { cookie: white.cookie } })).statusCode).toBe(403);
    expect((await move(app, id, white, 0, 'e2', 'e4')).json().error).toBe('clock_not_started');
    const first = await ready(app, id, white);
    expect(first.json()).toMatchObject({ version: 1, status: 'waiting',
      clocks: { phase: 'waiting', ready: { white: true, black: false },
        remainingMs: { white: 300000, black: 300000 }, deadlineMs: null } });
    expect((await ready(app, id, white)).json().version).toBe(1);
    time.set(time.value + 500);
    const second = await ready(app, id, black);
    expect(second.json()).toMatchObject({ version: 2, status: 'active',
      clocks: { phase: 'running', activeSide: 'white', deadlineMs: time.value + 300000 } });
    expect((await ready(app, id, black)).json().version).toBe(2);
    const persisted = await pool.query('SELECT ready_white, ready_black, deadline_at FROM chess.games WHERE id=$1', [id]);
    expect(persisted.rows[0]).toMatchObject({ ready_white: true, ready_black: true });
    expect(persisted.rows[0].deadline_at.getTime()).toBe(time.value + 300000);
  });

  it('charges only accepted moves, adds increment once, and serializes simultaneous requests', async () => {
    const { app, time } = fixture();
    const { id, white, black, started } = await start(app);
    const deadline = started.clocks.deadlineMs as number;
    time.set(deadline - 299000);
    const firstId = randomUUID();
    const secondId = randomUUID();
    const [first, second] = await Promise.all([
      move(app, id, white, 2, 'e2', 'e4', firstId),
      move(app, id, white, 2, 'd2', 'd4', secondId),
    ]);
    expect([first.statusCode, second.statusCode].sort()).toEqual([200, 409]);
    const winner = first.statusCode === 200 ? first : second;
    const winnerId = first.statusCode === 200 ? firstId : secondId;
    const from = first.statusCode === 200 ? 'e2' : 'd2';
    const to = first.statusCode === 200 ? 'e4' : 'd4';
    expect(winner.json()).toMatchObject({ accepted: true,
      game: { version: 3, clocks: { phase: 'running', activeSide: 'black',
        remainingMs: { white: 302000, black: 300000 } } } });
    time.set(time.value + 1000);
    expect((await move(app, id, white, 2, from, to, winnerId)).json()).toEqual(winner.json());
    expect((await pool.query('SELECT count(*)::int AS total FROM chess.game_moves WHERE game_id=$1', [id]))
      .rows[0].total).toBe(1);
    expect((await move(app, id, black, 3, 'e7', 'e5')).json()).toMatchObject({ accepted: true,
      game: { version: 4, clocks: { remainingMs: { white: 302000, black: 302000 } } } });
    expect((await read(app, id, white)).json()).toMatchObject({ version: 4,
      history: [{ ply: 1 }, { ply: 2 }], clocks: { activeSide: 'white' } });
  });

  it('keeps an invalid move as a repeatable rejection without resetting the running clock', async () => {
    const { app, time } = fixture();
    const { id, white, black, started } = await start(app);
    const startedAt = started.clocks.serverNowMs as number;
    time.set(startedAt + 1000);
    const badId = randomUUID();
    const rejected = await move(app, id, white, 2, 'e2', 'e5', badId);
    expect(rejected.statusCode).toBe(422);
    expect(rejected.json().error).toBe('illegal_move');
    time.set(startedAt + 2000);
    expect((await move(app, id, white, 2, 'e2', 'e5', badId)).json()).toEqual(rejected.json());
    expect((await read(app, id, black)).json()).toMatchObject({ version: 2, history: [],
      clocks: { activeSide: 'white', remainingMs: { white: 298000, black: 300000 } } });
    expect((await move(app, id, white, 2, 'e2', 'e4')).json()).toMatchObject({ accepted: true,
      game: { clocks: { remainingMs: { white: 301000, black: 300000 } } } });
  });

  it('accepts a move strictly before the deadline and flags at the deadline or after it', async () => {
    const { app, time } = fixture();
    const first = await start(app);
    const firstDeadline = first.started.clocks.deadlineMs as number;
    time.set(firstDeadline - 1);
    expect((await move(app, first.id, first.white, 2, 'e2', 'e4')).statusCode).toBe(200);
    const second = await start(app);
    const deadline = second.started.clocks.deadlineMs as number;
    time.set(deadline);
    const requestId = randomUUID();
    const exact = await move(app, second.id, second.white, 2, 'e2', 'e4', requestId);
    expect(exact.json()).toMatchObject({ error: 'flag_fell', currentVersion: 3 });
    expect((await read(app, second.id, second.white)).json()).toMatchObject({
      version: 3, status: 'pending_adjudication', history: [],
      pending: { kind: 'timeout', flaggedSide: 'white', deadlineMs: deadline },
      clocks: { phase: 'flagged', flaggedSide: 'white', flaggedAtMs: deadline,
        remainingMs: { white: 0, black: 300000 } },
    });
    time.set(deadline + 1000);
    expect((await move(app, second.id, second.white, 2, 'e2', 'e4', requestId)).json()).toEqual(exact.json());
    expect((await move(app, second.id, second.white, 3, 'e2', 'e4')).json().error)
      .toBe('adjudication_pending');
  });

  it('flags without a move at the saved deadline and reconstructs after restart', async () => {
    const { app, time } = fixture();
    const { id, white, started } = await start(app);
    const deadline = started.clocks.deadlineMs as number;
    time.set(deadline - 298500);
    const restarted = createGameService(pool, time);
    const restartedApp = buildApp(() => checkDatabase(pool), false,
      { pool, secureCookies: true, gameService: restarted });
    apps.push(restartedApp);
    expect((await read(restartedApp, id, white)).json()).toMatchObject({
      status: 'active', version: 2,
      clocks: { phase: 'running', deadlineMs: deadline,
        remainingMs: { white: 298500, black: 300000 } },
    });
    time.set(deadline + 9000);
    expect(await restarted.pollDueGames()).toBeGreaterThanOrEqual(1);
    expect(await restarted.pollDueGames()).toBe(0);
    expect((await read(restartedApp, id, white)).json()).toMatchObject({
      status: 'pending_adjudication', version: 3,
      clocks: { phase: 'flagged', flaggedAtMs: deadline },
      pending: { flaggedSide: 'white', deadlineMs: deadline },
    });
  });

  it('uses a separately verified witness for a timeout win without searching on the move path', async () => {
    const { app, service, time } = fixture();
    const { id, white, started } = await start(app);
    expect(await service.registerTimeoutWitness(id, [{ from: 'e2', to: 'e4' }])).toBe(false);
    expect(await service.registerTimeoutWitness(id, [
      { from: 'f2', to: 'f3' }, { from: 'e7', to: 'e5' },
      { from: 'g2', to: 'g4' }, { from: 'd8', to: 'h4' },
    ])).toBe(true);
    const deadline = started.clocks.deadlineMs as number;
    time.set(deadline + 1);
    await service.pollDueGames();
    expect((await read(app, id, white)).json()).toMatchObject({ status: 'finished',
      result: { outcome: 'win', reason: 'timeout', winner: 'black',
        flaggedSide: 'white', deadlineMs: deadline },
      clocks: { phase: 'flagged', flaggedAtMs: deadline } });
  });
});
