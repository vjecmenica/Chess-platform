import { randomUUID } from 'node:crypto';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import type pg from 'pg';
import { timeControlPresets } from '@chess/contracts';
import { buildApp } from '../src/app.js';
import { loadEnvironment, databaseUrl } from '../src/config.js';
import { checkDatabase, createPool } from '../src/database.js';
import { migrate } from '../src/migrations.js';
import { createGameService } from '../src/game-service.js';

describe('selected challenge clocks in PostgreSQL', () => {
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

  function fixture(time = { value: 2_000_000_000_000, nowMs() { return this.value; } }) {
    const app = buildApp(() => checkDatabase(pool), false, { pool, secureCookies: true,
      gameService: createGameService(pool, time) });
    apps.push(app);
    return { app, time };
  }
  async function guest(app: FastifyInstance) {
    const response = await app.inject('/guest-session');
    return { cookie: String(response.headers['set-cookie']).split(';')[0]!,
      'x-csrf-token': response.json().csrfToken as string };
  }

  it.each(Object.entries(timeControlPresets))('persists %s and uses its base and increment through restart', async (id, preset) => {
    const { app, time } = fixture();
    const white = await guest(app), black = await guest(app);
    const key = randomUUID();
    const create = () => app.inject({ method: 'POST', url: '/challenges',
      headers: { ...white, 'idempotency-key': key }, payload: { timeControl: id } });
    const created = await create();
    expect(created.statusCode).toBe(200);
    const gameId = created.json().id as string;
    expect((await create()).json().id).toBe(gameId);
    expect((await app.inject({ url: `/challenges/${gameId}`, headers: black })).json().game).toMatchObject(preset);
    const accept = () => app.inject({ method: 'POST', url: `/challenges/${gameId}/accept`, headers: black });
    expect((await accept()).json().game).toMatchObject(preset);
    expect((await accept()).statusCode).toBe(200);
    expect((await pool.query('SELECT time_control FROM chess.challenges WHERE id = $1', [gameId])).rows[0].time_control).toBe(id);
    const read = async (server = app) => (await server.inject({ url: `/games/${gameId}`, headers: white })).json();
    expect(await read()).toMatchObject({ timeControl: preset, clocks: {
      phase: 'awaiting_first_move', remainingMs: { white: preset.initialMs, black: preset.initialMs } } });
    const move = (headers: typeof white, version: number, from: string, to: string, requestId = randomUUID()) =>
      app.inject({ method: 'POST', url: `/games/${gameId}/moves`,
        headers: { ...headers, 'idempotency-key': requestId }, payload: { expectedVersion: version, from, to } });
    time.value += 100;
    expect((await move(white, 0, 'e2', 'e4')).statusCode).toBe(200);
    expect(await read()).toMatchObject({ clocks: { remainingMs: { white: preset.initialMs, black: preset.initialMs },
      deadlineMs: time.value + preset.initialMs } });
    time.value += 200;
    const moveId = randomUUID();
    const played = await move(black, 1, 'e7', 'e5', moveId);
    expect(played.statusCode).toBe(200);
    expect((await move(black, 1, 'e7', 'e5', moveId)).json()).toEqual(played.json());
    time.value += 300;
    expect((await move(white, 2, 'g1', 'f3')).statusCode).toBe(200);
    const expected = { timeControl: preset, clocks: { remainingMs: {
      white: preset.initialMs - 300 + preset.incrementMs,
      black: preset.initialMs - 200 + preset.incrementMs } }, history: [
      { remainingMsAfterMove: preset.initialMs },
      { remainingMsAfterMove: preset.initialMs - 200 + preset.incrementMs },
      { remainingMsAfterMove: preset.initialMs - 300 + preset.incrementMs }] };
    expect(await read()).toMatchObject(expected);
    const restarted = fixture(time).app;
    expect(await read(restarted)).toMatchObject(expected);
    expect((await pool.query('SELECT id FROM chess.games WHERE id = $1', [gameId])).rowCount).toBe(1);
  });

  it('rejects unsupported bodies and conflicts without changing the original preset', async () => {
    const { app } = fixture();
    const owner = await guest(app);
    for (const body of [{ timeControl: '2+0' }, { timeControl: '5+0' }, { timeControl: 300 },
      { timeControl: null }, { timeControl: '__proto__' }, {}, { initialMs: 1, incrementMs: 1 },
      { timeControl: '5+3', initialMs: 1 }]) {
      const response = await app.inject({ method: 'POST', url: '/challenges',
        headers: { ...owner, 'idempotency-key': randomUUID() }, payload: body });
      expect(response.statusCode).toBe(400);
      expect(response.json().error).toBe('invalid_time_control');
    }
    const key = randomUUID();
    const create = (timeControl: string) => app.inject({ method: 'POST', url: '/challenges',
      headers: { ...owner, 'idempotency-key': key }, payload: { timeControl } });
    const [first, second] = await Promise.all([create('3+2'), create('30+10')]);
    expect([first.statusCode, second.statusCode].sort()).toEqual([200, 409]);
    const winner = first.statusCode === 200 ? first : second;
    const saved = await app.inject({ url: winner.json().path.replace('/challenge/', '/challenges/'), headers: owner });
    expect(saved.json().game).toEqual(winner.json().game);
    await expect(pool.query('UPDATE chess.challenges SET time_control = $2 WHERE id = $1',
      [winner.json().id, '2+0'])).rejects.toMatchObject({ code: '23514' });
  });
});
