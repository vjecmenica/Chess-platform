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

describe('separate first-move deadlines against PostgreSQL', () => {
  let pool: pg.Pool;
  const apps: FastifyInstance[] = [];
  const time = { value: 2_200_000_000_000, nowMs() { return this.value; } };

  beforeAll(async () => {
    loadEnvironment();
    pool = createPool(databaseUrl(process.env.TEST_DATABASE_URL, 'TEST_DATABASE_URL'));
    await checkDatabase(pool);
    await migrate(pool);
  });
  afterEach(async () => {
    for (const app of apps.splice(0)) await app.close();
    time.value = 2_200_000_000_000;
  });
  afterAll(async () => { if (pool) await pool.end(); });

  function instance() {
    const service = createGameService(pool, time);
    const app = buildApp(() => checkDatabase(pool), false,
      { pool, secureCookies: true, gameService: service });
    apps.push(app);
    return { app, service };
  }
  async function guest(app: FastifyInstance): Promise<Guest> {
    const response = await app.inject('/guest-session');
    return { cookie: String(response.headers['set-cookie']).split(';')[0]!,
      csrf: response.json().csrfToken as string };
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
    return { id, white, black };
  }
  function read(app: FastifyInstance, id: string, player: Guest) {
    return app.inject({ url: `/games/${id}`, headers: { cookie: player.cookie } });
  }
  function move(app: FastifyInstance, id: string, player: Guest, version: number,
    from: string, to: string, requestId = randomUUID()) {
    return app.inject({ method: 'POST', url: `/games/${id}/moves`,
      headers: { cookie: player.cookie, 'x-csrf-token': player.csrf,
        'idempotency-key': requestId }, payload: { expectedVersion: version, from, to } });
  }

  it('starts White on acceptance, then starts Black’s grace and game clocks together', async () => {
    const { app } = instance();
    const { id, white, black } = await challenge(app);
    const initial = (await read(app, id, white)).json();
    const whiteDeadline = time.value + 30_000;
    expect(initial).toMatchObject({ version: 0, status: 'active',
      clocks: { startMode: 'first_move_grace', phase: 'awaiting_first_move',
        firstMoveDeadlineMs: { white: whiteDeadline, black: null },
        remainingMs: { white: 300_000, black: 300_000 } } });
    expect((await move(app, id, white, 0, 'e2', 'e5')).json().error).toBe('illegal_move');
    expect((await read(app, id, black)).json().clocks.firstMoveDeadlineMs.white).toBe(whiteDeadline);
    time.value = whiteDeadline - 1;
    expect((await move(app, id, white, 0, 'e2', 'e4')).statusCode).toBe(200);
    const next = (await read(app, id, black)).json();
    expect(next).toMatchObject({ version: 1, status: 'active',
      clocks: { phase: 'running', activeSide: 'black',
        firstMoveDeadlineMs: { white: null, black: time.value + 30_000 },
        deadlineMs: time.value + 300_000,
        remainingMs: { white: 300_000, black: 300_000 } } });
    time.value = next.clocks.firstMoveDeadlineMs.black - 1;
    expect((await move(app, id, black, 1, 'e7', 'e5')).statusCode).toBe(200);
    expect((await read(app, id, white)).json()).toMatchObject({ version: 2,
      status: 'active', clocks: { firstMoveDeadlineMs: { white: null, black: null },
        remainingMs: { black: 273_001 } } });
    time.value += 60_000;
    expect((await read(app, id, black)).json().status).toBe('active');
  });

  it('aborts White at the exact first-move deadline, without a result score or clock loss', async () => {
    const { app } = instance();
    const { id, white, black } = await challenge(app);
    const deadlineMs = (await read(app, id, white)).json().clocks.firstMoveDeadlineMs.white as number;
    time.value = deadlineMs;
    const requestId = randomUUID();
    const late = await move(app, id, white, 0, 'e2', 'e4', requestId);
    expect(late.json().error).toBe('first_move_deadline_elapsed');
    expect((await move(app, id, white, 0, 'e2', 'e4', requestId)).json()).toEqual(late.json());
    for (const player of [white, black]) {
      expect((await read(app, id, player)).json()).toMatchObject({ version: 1,
        status: 'aborted', history: [], result: { outcome: 'aborted',
          reason: 'first_move_deadline', missedSide: 'white', deadlineMs },
        clocks: { phase: 'stopped', flaggedSide: null,
          firstMoveDeadlineMs: { white: null, black: null },
          remainingMs: { white: 300_000, black: 300_000 } } });
    }
  });

  it('aborts Black on its separate deadline while preserving the normal clock reading after restart', async () => {
    const original = instance();
    const { id, white, black } = await challenge(original.app);
    expect((await move(original.app, id, white, 0, 'e2', 'e4')).statusCode).toBe(200);
    const blackDeadline = (await read(original.app, id, black)).json()
      .clocks.firstMoveDeadlineMs.black as number;
    await original.app.close();
    apps.splice(apps.indexOf(original.app), 1);
    time.value = blackDeadline;
    const restarted = instance();
    expect(await restarted.service.pollDueGames()).toBeGreaterThanOrEqual(1);
    for (const player of [white, black]) {
      expect((await read(restarted.app, id, player)).json()).toMatchObject({
        status: 'aborted', history: [{ san: 'e4' }],
        result: { outcome: 'aborted', missedSide: 'black', deadlineMs: blackDeadline },
        clocks: { phase: 'stopped', flaggedSide: null,
          firstMoveDeadlineMs: { white: null, black: null },
          remainingMs: { white: 300_000, black: 270_000 } } });
    }
    expect((await move(restarted.app, id, black, 1, 'e7', 'e5')).json().error)
      .toBe('first_move_deadline_elapsed');
  });

  it('rejects Black’s first move received exactly at its deadline before a timer poll', async () => {
    const { app } = instance();
    const { id, white, black } = await challenge(app);
    expect((await move(app, id, white, 0, 'e2', 'e4')).statusCode).toBe(200);
    const deadlineMs = (await read(app, id, black)).json()
      .clocks.firstMoveDeadlineMs.black as number;
    time.value = deadlineMs;
    const rejected = await move(app, id, black, 1, 'e7', 'e5');
    expect(rejected.statusCode).toBe(409);
    expect(rejected.json().error).toBe('first_move_deadline_elapsed');
    expect((await read(app, id, white)).json()).toMatchObject({
      status: 'aborted', version: 2, history: [{ san: 'e4' }],
      result: { outcome: 'aborted', missedSide: 'black', deadlineMs },
      clocks: { phase: 'stopped', remainingMs: { black: 270_000 } },
    });
  });

  it('accepts a legal pre-deadline arrival before a late timer on another instance', async () => {
    const writer = instance();
    const timer = instance();
    let entered!: () => void;
    let release!: () => void;
    const atBarrier = new Promise<void>(resolve => { entered = resolve; });
    const held = new Promise<void>(resolve => { release = resolve; });
    writer.app.addHook('preHandler', async request => {
      if (request.url.endsWith('/moves')) { entered(); await held; }
    });
    const { id, white, black } = await challenge(writer.app);
    await timer.service.start();
    const deadlineMs = (await read(writer.app, id, white)).json().clocks.firstMoveDeadlineMs.white as number;
    time.value = deadlineMs - 1;
    const submission = move(writer.app, id, white, 0, 'e2', 'e4');
    await atBarrier;
    time.value = deadlineMs + 5_000;
    await timer.service.heartbeat();
    await timer.service.pollDueGames();
    expect((await pool.query('SELECT status FROM chess.games WHERE id = $1', [id]))
      .rows[0].status).toBe('active');
    release();
    expect((await submission).statusCode).toBe(200);
    expect((await read(timer.app, id, black)).json()).toMatchObject({
      status: 'active', version: 1, history: [{ san: 'e4' }],
      clocks: { phase: 'running', activeSide: 'black',
        firstMoveDeadlineMs: { white: null, black: time.value + 30_000 } } });
  });

  it('pushes the committed abort to both seat owners', async () => {
    const writer = instance();
    const reader = instance();
    const { id, white, black } = await challenge(writer.app);
    const deadlineMs = (await read(writer.app, id, white)).json().clocks.firstMoveDeadlineMs.white as number;
    const origin = await reader.app.listen({ host: '127.0.0.1', port: 0 });
    const abort = new AbortController();
    const timeout = setTimeout(() => abort.abort(), 5_000);
    async function event(origin: string, player: Guest) {
      const response = await fetch(`${origin}/games/${id}/events`,
        { headers: { cookie: player.cookie }, signal: abort.signal });
      expect(response.status).toBe(200);
      const stream = response.body!.getReader();
      expect(new TextDecoder().decode((await stream.read()).value)).toContain(': connected');
      return { update: (async () => {
        let text = '';
        for (;;) {
          const chunk = await stream.read();
          if (chunk.done) throw new Error('The game stream closed before the abort update.');
          text += new TextDecoder().decode(chunk.value);
          const match = /event: game\ndata: (\{[^\n]+\})\n\n/.exec(text);
          if (match) return JSON.parse(match[1]!) as { version: number };
        }
      })() };
    }
    try {
      const [whiteStream, blackStream] = await Promise.all([
        event(origin, white), event(origin, black),
      ]);
      time.value = deadlineMs;
      await reader.service.heartbeat();
      expect(await writer.service.pollDueGames()).toBeGreaterThanOrEqual(1);
      expect(await whiteStream.update).toEqual({ version: 1 });
      expect(await blackStream.update).toEqual({ version: 1 });
      for (const player of [white, black]) {
        expect((await read(reader.app, id, player)).json()).toMatchObject({ status: 'aborted',
          result: { outcome: 'aborted', missedSide: 'white' } });
      }
    } finally {
      clearTimeout(timeout);
      abort.abort();
    }
  });
});
