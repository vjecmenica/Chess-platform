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

  function fixture(start = 2_000_000_000_000,
    hooks: { afterMoveCommit?: () => Promise<void> } = {}) {
    const time = { value: start, nowMs() { return this.value; }, set(value: number) { this.value = value; } };
    const service = createGameService(pool, time, hooks);
    const app = buildApp(() => checkDatabase(pool), false,
      { pool, secureCookies: true, gameService: service });
    apps.push(app);
    return { app, service, time };
  }

  function anotherInstance(time: { nowMs(): number }) {
    const service = createGameService(pool, time);
    const app = buildApp(() => checkDatabase(pool), false,
      { pool, secureCookies: true, gameService: service });
    apps.push(app);
    return { app, service };
  }

  async function until(check: () => Promise<boolean>): Promise<void> {
    for (let attempt = 0; attempt < 100; attempt += 1) {
      if (await check()) return;
      await new Promise(resolve => setTimeout(resolve, 10));
    }
    throw new Error('The controlled database barrier was not reached.');
  }

  async function guest(app: FastifyInstance): Promise<Guest> {
    const response = await app.inject('/guest-session');
    expect(response.statusCode).toBe(200);
    return { cookie: String(response.headers['set-cookie']).split(';')[0]!,
      csrf: response.json().csrfToken as string };
  }

  async function challenge(app: FastifyInstance, oldReadiness = false) {
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
    if (oldReadiness) {
      await pool.query(`UPDATE chess.games SET clock_start_mode = 'readiness',
        status = 'waiting', clock_phase = 'waiting', white_first_move_deadline_at = NULL
        WHERE id = $1`, [id]);
    } else {
      await pool.query(`UPDATE chess.games SET clock_start_mode = 'first_move',
        white_first_move_deadline_at = NULL WHERE id = $1`, [id]);
    }
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
    const players = await challenge(app, true);
    expect((await ready(app, players.id, players.white)).statusCode).toBe(200);
    const second = await ready(app, players.id, players.black);
    expect(second.statusCode).toBe(200);
    return { ...players, started: second.json() };
  }

  it('waits for White without a deadline, including after restart and a late poll', async () => {
    const { app, service, time } = fixture();
    const { id, white, black } = await challenge(app);
    const initial = (await read(app, id, white)).json();
    expect(initial).toMatchObject({ version: 0, status: 'active', history: [],
      clocks: { phase: 'awaiting_first_move', activeSide: null, deadlineMs: null,
        remainingMs: { white: 300000, black: 300000 } } });
    expect((await ready(app, id, white)).json().error).toBe('ready_not_required');
    time.set(time.value + 10_000_000);
    await service.pollDueGames();
    await app.close();
    apps.splice(apps.indexOf(app), 1);
    const { app: restartedApp, service: restarted } = anotherInstance(time);
    await restarted.pollDueGames();
    expect((await read(restartedApp, id, black)).json()).toMatchObject({
      version: 0, status: 'active', history: [],
      clocks: { phase: 'awaiting_first_move', deadlineMs: null,
        remainingMs: { white: 300000, black: 300000 } } });
    expect((await pool.query('SELECT clock_start_mode FROM chess.games WHERE id=$1', [id]))
      .rows[0].clock_start_mode).toBe('first_move');
  });

  it('starts Black only after one valid first move, without charging or incrementing White', async () => {
    const { app, time } = fixture();
    const { id, white, black } = await challenge(app);
    const outsider = await guest(app);
    expect((await move(app, id, outsider, 0, 'e2', 'e4')).statusCode).toBe(403);
    expect((await move(app, id, black, 0, 'e7', 'e5')).json().error).toBe('wrong_turn');
    const invalidId = randomUUID();
    expect((await move(app, id, white, 0, 'e2', 'e5', invalidId)).json().error).toBe('illegal_move');
    time.set(time.value + 900_000);
    expect((await move(app, id, white, 0, 'e2', 'e5', invalidId)).json().error).toBe('illegal_move');
    expect((await read(app, id, white)).json()).toMatchObject({ version: 0, history: [],
      clocks: { phase: 'awaiting_first_move', remainingMs: { white: 300000, black: 300000 } } });
    const firstId = randomUUID();
    const [a, b] = await Promise.all([
      move(app, id, white, 0, 'e2', 'e4', firstId),
      move(app, id, white, 0, 'd2', 'd4'),
    ]);
    expect([a.statusCode, b.statusCode].sort()).toEqual([200, 409]);
    const accepted = a.statusCode === 200 ? a : b;
    expect(accepted.json()).toMatchObject({ accepted: true, game: { version: 1,
      clocks: { phase: 'running', activeSide: 'black',
        remainingMs: { white: 300000, black: 300000 }, deadlineMs: time.value + 300000 } } });
    if (a.statusCode === 200) {
      expect((await move(app, id, white, 0, 'e2', 'e4', firstId)).json()).toEqual(a.json());
    }
    expect((await pool.query('SELECT count(*)::int AS total FROM chess.game_moves WHERE game_id=$1', [id]))
      .rows[0].total).toBe(1);
    time.set(time.value + 1000);
    expect((await move(app, id, black, 1, 'e7', 'e5')).json()).toMatchObject({
      accepted: true, game: { version: 2, clocks: {
        remainingMs: { white: 300000, black: 302000 }, activeSide: 'white' } } });
  });

  it('ignores a crashed instance watermark immediately instead of stalling the first move', async () => {
    const { app } = fixture();
    const { id, white, black } = await challenge(app);
    const crashedInstance = randomUUID();
    await pool.query(`INSERT INTO chess.clock_ingress_watermarks
      (instance_id, safe_through_ms, lease_until)
      VALUES ($1, 0, clock_timestamp() + interval '30 seconds')`, [crashedInstance]);
    try {
      const requestId = randomUUID();
      const response = await move(app, id, white, 0, 'e2', 'e4', requestId);
      expect(response.statusCode).toBe(200);
      expect(response.json()).toMatchObject({ accepted: true, move: { san: 'e4' },
        game: { status: 'active', clocks: { phase: 'running', activeSide: 'black' } } });
      expect((await read(app, id, black)).json()).toMatchObject({
        version: 1, history: [{ san: 'e4' }], clocks: { activeSide: 'black' },
      });
      expect((await move(app, id, white, 0, 'e2', 'e4', requestId)).json()).toEqual(response.json());
      expect((await pool.query<{ count: string }>(
        'SELECT count(*) FROM chess.game_moves WHERE game_id = $1', [id])).rows[0]?.count).toBe('1');
    } finally {
      await pool.query('DELETE FROM chess.clock_ingress_watermarks WHERE instance_id = $1',
        [crashedInstance]);
    }
  });

  it('recovers the first-move clock handoff after its move transaction commits', async () => {
    const { app, time } = fixture(2_000_000_000_000,
      { afterMoveCommit: async () => { throw new Error('Simulated worker failure after commit.'); } });
    const { id, white, black } = await challenge(app);
    const requestId = randomUUID();
    expect((await move(app, id, white, 0, 'e2', 'e4', requestId)).statusCode).toBe(500);
    expect((await pool.query(`SELECT clock_phase, turn_started_at, deadline_at,
      white_remaining_ms, black_remaining_ms FROM chess.games WHERE id=$1`, [id]))
      .rows[0]).toMatchObject({ clock_phase: 'handoff', turn_started_at: null,
        deadline_at: null, white_remaining_ms: 300000, black_remaining_ms: 300000 });
    time.set(time.value + 25_000);
    const { app: recoveryApp, service: recovery } = anotherInstance(time);
    await recoveryApp.ready();
    expect(await recovery.pollDueGames()).toBe(0);
    const response = await move(recoveryApp, id, white, 0, 'e2', 'e4', requestId);
    expect(response.json()).toMatchObject({ game: { version: 1,
      clocks: { phase: 'running', activeSide: 'black', deadlineMs: time.value + 300000,
        remainingMs: { white: 300000, black: 300000 } } } });
    expect((await read(recoveryApp, id, black)).json()).toMatchObject({
      history: [{ san: 'e4' }], version: 1,
      clocks: { phase: 'running', activeSide: 'black' } });
    expect((await move(recoveryApp, id, white, 0, 'e2', 'e4', requestId)).json()).toEqual(response.json());
  });

  it('authorizes both readiness commands and starts White only after the second seat is ready', async () => {
    const { app, time } = fixture();
    const { id, white, black } = await challenge(app, true);
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
    const { app: otherApp } = anotherInstance(time);
    await otherApp.ready();
    time.set(deadline);
    const requestId = randomUUID();
    const exact = await move(otherApp, second.id, second.white, 2, 'e2', 'e4', requestId);
    expect(exact.json()).toMatchObject({ error: 'flag_fell', currentVersion: 3 });
    expect((await read(app, second.id, second.white)).json()).toMatchObject({
      version: 3, status: 'finished', history: [],
      result: { outcome: 'win', winner: 'black', reason: 'timeout', flaggedSide: 'white', deadlineMs: deadline },
      clocks: { phase: 'flagged', flaggedSide: 'white', flaggedAtMs: deadline,
        remainingMs: { white: 0, black: 300000 } },
    });
    time.set(deadline + 1000);
    expect((await move(app, second.id, second.white, 2, 'e2', 'e4', requestId)).json()).toEqual(exact.json());
    expect((await move(app, second.id, second.white, 3, 'e2', 'e4')).json().error)
      .toBe('flag_fell');
  });

  it('flags without a move at the saved deadline and reconstructs after restart', async () => {
    const { app, time } = fixture();
    const { id, white, started } = await start(app);
    const deadline = started.clocks.deadlineMs as number;
    time.set(deadline - 298500);
    await app.close();
    apps.splice(apps.indexOf(app), 1);
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
      status: 'finished', version: 3,
      clocks: { phase: 'flagged', flaggedAtMs: deadline },
      result: { outcome: 'win', winner: 'black', reason: 'timeout', flaggedSide: 'white', deadlineMs: deadline },
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

  it('keeps an HTTP arrival ahead of a timer while authentication is delayed on another instance', async () => {
    const { app, time } = fixture();
    const { service: timer } = anotherInstance(time);
    let entered!: () => void;
    let release!: () => void;
    const atBarrier = new Promise<void>(resolve => { entered = resolve; });
    const held = new Promise<void>(resolve => { release = resolve; });
    app.addHook('preHandler', async request => {
      if (request.url.endsWith('/moves')) { entered(); await held; }
    });
    const { id, white, started } = await start(app);
    await timer.start();
    const deadline = started.clocks.deadlineMs as number;
    time.set(deadline - 1);
    const submitted = move(app, id, white, 2, 'e2', 'e4');
    await atBarrier;
    time.set(deadline + 5_000);
    await timer.heartbeat();
    expect(await timer.pollDueGames()).toBe(0);
    release();
    const response = await submitted;
    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({ accepted: true,
      game: { status: 'active', clocks: { activeSide: 'black',
        remainingMs: { white: 3001, black: 300000 } } } });
    expect(await timer.pollDueGames()).toBe(0);
  });

  it('drains a pre-deadline receipt even when another instance queued its timer for the row first', async () => {
    const { app, service, time } = fixture();
    const { app: timerApp, service: timer } = anotherInstance(time);
    const { id, white, started } = await start(app);
    await timer.start();
    const { rows } = await pool.query<{ creator_guest_id: string }>(
      'SELECT creator_guest_id FROM chess.challenges WHERE id = $1', [id]);
    const guestId = rows[0]!.creator_guest_id;
    const deadline = started.clocks.deadlineMs as number;
    time.set(deadline - 1);
    const arrival = service.beginReceipt();
    const requestId = randomUUID();
    const holder = await pool.connect();
    try {
      await holder.query('BEGIN');
      await holder.query('SELECT id FROM chess.games WHERE id = $1 FOR UPDATE', [id]);
      time.set(deadline + 5_000);
      const polling = timer.pollDueGames();
      await until(async () => (await pool.query<{ count: string }>(
        `SELECT count(*) FROM pg_stat_activity
          WHERE wait_event_type = 'Lock' AND query LIKE '%FOR UPDATE OF g%'`,
      )).rows[0]!.count !== '0');
      const submitted = service.move(id, guestId, requestId,
        { expectedVersion: 2, from: 'e2', to: 'e4' }, arrival);
      await holder.query('COMMIT');
      expect(await polling).toBe(0);
      expect(await submitted).toMatchObject({ status: 200,
        body: { accepted: true, game: { version: 3, clocks: {
          remainingMs: { white: 3001, black: 300000 }, activeSide: 'black' } } } });
      const retry = await move(timerApp, id, white, 2, 'e2', 'e4', requestId);
      expect(retry.statusCode).toBe(200);
      expect((await pool.query<{ count: string }>(
        'SELECT count(*) FROM chess.game_moves WHERE game_id = $1', [id])).rows[0]!.count).toBe('1');
    } finally {
      await holder.query('ROLLBACK');
      holder.release();
      await arrival.release();
    }
  });

  it('replays a durably admitted move before an overdue flag after a server restart', async () => {
    const { app, time } = fixture();
    const { id, white, started } = await start(app);
    const deadline = started.clocks.deadlineMs as number;
    const requestId = randomUUID();
    await pool.query(`INSERT INTO chess.game_move_receipts
      (game_id, guest_id, request_id, payload, response, status_code, received_at)
      SELECT $1, creator_guest_id, $2, $3::jsonb, NULL, NULL, $4
      FROM chess.challenges WHERE id = $1`,
    [id, requestId, JSON.stringify({ expectedVersion: 2, from: 'e2', to: 'e4' }),
      new Date(deadline - 1)]);
    await app.close();
    apps.splice(apps.indexOf(app), 1);
    time.set(deadline + 9_000);
    const { app: restartedApp, service: restarted } = anotherInstance(time);
    await restartedApp.ready();
    expect(await restarted.pollDueGames()).toBe(0);
    expect((await read(restartedApp, id, white)).json()).toMatchObject({
      status: 'active', version: 3, history: [{ san: 'e4' }],
      clocks: { phase: 'running', activeSide: 'black', remainingMs: {
        white: 3001, black: 300000 } },
    });
    expect((await move(restartedApp, id, white, 2, 'e2', 'e4', requestId)).statusCode).toBe(200);
  });

  it('starts the opponent only after the move commit and recovers a committed handoff', async () => {
    let committed!: () => void;
    let release!: () => void;
    const atCommit = new Promise<void>(resolve => { committed = resolve; });
    const held = new Promise<void>(resolve => { release = resolve; });
    const { app, time } = fixture(2_000_000_000_000,
      { afterMoveCommit: async () => { committed(); await held; } });
    const { id, white, started } = await start(app);
    const turnStart = started.clocks.serverNowMs as number;
    time.set(turnStart + 1000);
    const submitted = move(app, id, white, 2, 'e2', 'e4');
    await atCommit;
    const { rows } = await pool.query<{ clock_phase: string; turn_started_at: Date | null;
      deadline_at: Date | null; white_remaining_ms: number; black_remaining_ms: number }>(
      `SELECT clock_phase, turn_started_at, deadline_at, white_remaining_ms, black_remaining_ms
        FROM chess.games WHERE id = $1`, [id]);
    expect(rows[0]).toMatchObject({ clock_phase: 'handoff', turn_started_at: null,
      deadline_at: null, white_remaining_ms: 302000, black_remaining_ms: 300000 });
    expect((await pool.query<{ applied: boolean; response: unknown }>(
      'SELECT applied, response FROM chess.game_move_receipts WHERE game_id = $1', [id]))
      .rows[0]).toMatchObject({ applied: true, response: null });
    time.set(turnStart + 16_000);
    const { app: recoveryApp, service: recovery } = anotherInstance(time);
    await recoveryApp.ready();
    expect(await recovery.pollDueGames()).toBe(0);
    release();
    const response = await submitted;
    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({ game: { clocks: {
      activeSide: 'black', remainingMs: { white: 302000, black: 300000 },
      deadlineMs: time.value + 300000 } } });
  });

  it('returns a pending receipt instead of hanging when first-move handoff stalls', async () => {
    let committed!: () => void;
    let release!: () => void;
    const atCommit = new Promise<void>(resolve => { committed = resolve; });
    const held = new Promise<void>(resolve => { release = resolve; });
    const { app, time } = fixture(2_000_000_000_000,
      { afterMoveCommit: async () => { committed(); await held; } });
    const { id, white, black } = await challenge(app);
    const other = anotherInstance(time);
    const requestId = randomUUID();
    try {
      const first = move(app, id, white, 0, 'e2', 'e4', requestId);
      await atCommit;
      expect((await pool.query<{ clock_phase: string }>(
        'SELECT clock_phase FROM chess.games WHERE id = $1', [id])).rows[0]?.clock_phase)
        .toBe('handoff');
      expect((await first).json()).toMatchObject({ error: 'receipt_pending' });

      // A second process can finish the durable handoff while the original request is stalled.
      await other.service.pollDueGames();
      const retry = await move(other.app, id, white, 0, 'e2', 'e4', requestId);
      expect(retry.statusCode).toBe(200);
      expect(retry.json()).toMatchObject({ move: { san: 'e4' }, game: {
        clocks: { phase: 'running', activeSide: 'black' } } });
      expect((await read(other.app, id, black)).json()).toMatchObject({
        history: [{ san: 'e4' }], clocks: { phase: 'running', activeSide: 'black' },
      });
      expect((await pool.query<{ count: string }>(
        'SELECT count(*) FROM chess.game_moves WHERE game_id = $1', [id])).rows[0]?.count).toBe('1');
    } finally {
      release();
    }
  });
});
