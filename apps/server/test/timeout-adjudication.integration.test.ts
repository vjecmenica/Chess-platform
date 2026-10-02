import { randomUUID } from 'node:crypto';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import type pg from 'pg';
import { databaseUrl, loadEnvironment } from '../src/config.js';
import { checkDatabase, createPool } from '../src/database.js';
import { migrate } from '../src/migrations.js';
import { buildApp } from '../src/app.js';
import { createGameService } from '../src/game-service.js';

describe('background timeout adjudication against PostgreSQL', () => {
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

  function instance(budget?: { maxDepth: number; maxNodes: number }) {
    const service = createGameService(pool, time, budget ? { timeoutSearchBudget: budget } : {});
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
  async function flaggedGame(app: FastifyInstance, service: ReturnType<typeof createGameService>) {
    const white = await guest(app);
    const black = await guest(app);
    const created = await app.inject({ method: 'POST', url: '/challenges',
      headers: { cookie: white.cookie, 'x-csrf-token': white.csrf,
        'idempotency-key': randomUUID() } });
    const id = created.json().id as string;
    expect((await app.inject({ method: 'POST', url: `/challenges/${id}/accept`,
      headers: { cookie: black.cookie, 'x-csrf-token': black.csrf } })).statusCode).toBe(200);
    expect((await app.inject({ method: 'POST', url: `/games/${id}/moves`,
      headers: { cookie: white.cookie, 'x-csrf-token': white.csrf,
        'idempotency-key': randomUUID() },
      payload: { expectedVersion: 0, from: 'e2', to: 'e4' } })).statusCode).toBe(200);
    const clock = (await read(app, id, black.cookie)).json().clocks;
    time.value = clock.deadlineMs;
    await service.pollDueGames();
    expect((await read(app, id, black.cookie)).json()).toMatchObject({
      status: 'pending_adjudication', timeoutAdjudication: 'searching',
      pending: { kind: 'timeout', flaggedSide: 'black', deadlineMs: clock.deadlineMs } });
    return { id, white, black, deadlineMs: clock.deadlineMs as number };
  }

  it('resolves a normal pending flag durably for both players after a restart', async () => {
    const original = instance();
    const { id, white, black, deadlineMs } = await flaggedGame(original.app, original.service);
    await original.app.close();
    apps.splice(apps.indexOf(original.app), 1);
    const restarted = instance();
    await restarted.service.pollPendingTimeouts();
    for (const player of [white, black]) {
      expect((await read(restarted.app, id, player.cookie)).json()).toMatchObject({
        version: 3, status: 'finished', timeoutAdjudication: null,
        result: { outcome: 'win', winner: 'white', reason: 'timeout',
          flaggedSide: 'black', deadlineMs }, clocks: { phase: 'flagged' } });
    }
    await restarted.service.pollPendingTimeouts();
    expect((await pool.query('SELECT timeout_adjudicated_at FROM chess.games WHERE id = $1', [id]))
      .rows[0].timeout_adjudicated_at).not.toBeNull();
  });

  it('allows only one worker to finalize a pending flag', async () => {
    const first = instance();
    const second = instance();
    const { id, white } = await flaggedGame(first.app, first.service);
    await second.service.start();
    const counts = await Promise.all([
      first.service.pollPendingTimeouts(), second.service.pollPendingTimeouts(),
    ]);
    expect(counts.reduce((sum, count) => sum + count, 0)).toBeGreaterThanOrEqual(1);
    expect((await read(second.app, id, white.cookie)).json()).toMatchObject({
      version: 3, status: 'finished', result: { winner: 'white' } });
  });

  it('keeps an exhausted search unresolved and does not retry it after restart', async () => {
    const original = instance({ maxDepth: 0, maxNodes: 0 });
    const { id, black } = await flaggedGame(original.app, original.service);
    await original.service.pollPendingTimeouts();
    const pending = (await read(original.app, id, black.cookie)).json();
    expect(pending).toMatchObject({ version: 3, status: 'pending_adjudication',
      timeoutAdjudication: 'unresolved', result: null });
    await original.app.close();
    apps.splice(apps.indexOf(original.app), 1);
    const restarted = instance();
    await restarted.service.pollPendingTimeouts();
    expect((await read(restarted.app, id, black.cookie)).json()).toMatchObject({
      version: 3, status: 'pending_adjudication', timeoutAdjudication: 'unresolved' });
  });
});
