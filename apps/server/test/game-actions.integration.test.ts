import { randomUUID } from 'node:crypto';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import type pg from 'pg';
import { Chess } from 'chess.js';
import { databaseUrl, loadEnvironment } from '../src/config.js';
import { checkDatabase, createPool } from '../src/database.js';
import { migrate } from '../src/migrations.js';
import { buildApp } from '../src/app.js';
import { createGameService } from '../src/game-service.js';

interface Guest { cookie: string; csrf: string }

describe('guest game actions against PostgreSQL', () => {
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

  function fixture() {
    const time = { value: 2_000_000_000_000, nowMs() { return this.value; },
      set(value: number) { this.value = value; } };
    const service = createGameService(pool, time);
    const app = buildApp(() => checkDatabase(pool), false,
      { pool, secureCookies: true, gameService: service });
    apps.push(app);
    return { app, service, time };
  }

  function another(time: { nowMs(): number }) {
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

  function read(app: FastifyInstance, id: string, actor: Guest) {
    return app.inject({ url: `/games/${id}`, headers: { cookie: actor.cookie } });
  }
  function move(app: FastifyInstance, id: string, actor: Guest, expectedVersion: number,
    from: string, to: string) {
    return app.inject({ method: 'POST', url: `/games/${id}/moves`,
      headers: { cookie: actor.cookie, 'x-csrf-token': actor.csrf, 'idempotency-key': randomUUID() },
      payload: { expectedVersion, from, to } });
  }
  function action(app: FastifyInstance, id: string, actor: Guest, path: string,
    expectedVersion: number, requestId = randomUUID()) {
    return app.inject({ method: 'POST', url: `/games/${id}/${path}`,
      headers: { cookie: actor.cookie, 'x-csrf-token': actor.csrf, 'idempotency-key': requestId },
      payload: { expectedVersion } });
  }

  async function playPawnMovesTo(app: FastifyInstance, id: string, white: Guest,
    black: Guest, targetPly: number) {
    for (;;) {
      const state = (await read(app, id, white)).json();
      if (state.history.length >= targetPly) return state;
      const choice = new Chess(state.position.fen).moves({ verbose: true })
        .find(candidate => candidate.piece === 'p' && candidate.promotion === undefined);
      if (!choice) throw new Error('Fixture ran out of legal pawn moves.');
      const actor = state.position.sideToMove === 'white' ? white : black;
      expect((await move(app, id, actor, state.version, choice.from, choice.to)).statusCode).toBe(200);
    }
  }

  it('persists offers and responses for both seats, including after a fresh server read', async () => {
    const { app, time } = fixture();
    const { id, white, black } = await challenge(app);
    expect((await move(app, id, white, 0, 'e2', 'e4')).statusCode).toBe(200);
    expect((await move(app, id, black, 1, 'e7', 'e5')).statusCode).toBe(200);
    const offered = await action(app, id, white, 'draw-offer', 2);
    expect(offered.json()).toMatchObject({ accepted: true,
      game: { version: 3, drawOffer: 'white', status: 'active' } });
    expect((await action(app, id, white, 'draw-offer', 2)).json().error).toBe('stale_version');
    const { app: restarted } = another(time);
    expect((await read(restarted, id, white)).json().drawOffer).toBe('white');
    expect((await read(restarted, id, black)).json()).toMatchObject({ yourSeat: 'black', drawOffer: 'white' });
    const conflictId = randomUUID();
    const declined = await action(restarted, id, black, 'draw-decline', 3, conflictId);
    expect(declined.json()).toMatchObject({ accepted: true, game: { version: 4, drawOffer: null } });
    expect((await action(app, id, black, 'draw-accept', 3, conflictId)).json().error)
      .toBe('request_id_conflict');
    expect((await action(app, id, black, 'draw-accept', 3)).json().error).toBe('stale_version');
    expect((await action(app, id, black, 'draw-offer', 4)).statusCode).toBe(200);
    const acceptedId = randomUUID();
    const accepted = await action(app, id, white, 'draw-accept', 5, acceptedId);
    expect(accepted.json()).toMatchObject({ accepted: true,
      game: { version: 6, status: 'finished', drawOffer: null,
        result: { outcome: 'draw', reason: 'agreement' }, clocks: { phase: 'stopped' } } });
    expect((await action(restarted, id, white, 'draw-accept', 5, acceptedId)).json()).toEqual(accepted.json());
    expect((await read(restarted, id, black)).json()).toMatchObject({ status: 'finished',
      result: { reason: 'agreement' }, drawOffer: null });
  });

  it('rejects direct early offers, expires an offer on the opponent move, and keeps sides independent', async () => {
    const { app } = fixture();
    const { id, white, black } = await challenge(app);
    const outsider = await guest(app);
    expect((await action(app, id, outsider, 'resign', 0)).statusCode).toBe(403);
    expect((await app.inject({ method: 'POST', url: `/games/${id}/resign`,
      headers: { cookie: white.cookie, 'idempotency-key': randomUUID() },
      payload: { expectedVersion: 0 } })).statusCode).toBe(403);
    expect((await action(app, id, white, 'draw-accept', 0)).json().error).toBe('no_draw_offer');
    expect((await action(app, id, white, 'draw-offer', 0)).json().error).toBe('draw_offer_too_early');
    expect((await action(app, id, black, 'draw-offer', 0)).json().error).toBe('draw_offer_too_early');
    expect((await read(app, id, black)).json()).toMatchObject({ version: 0, drawOffer: null,
      drawOfferNextEligiblePly: { white: 2, black: 2 } });
    expect((await move(app, id, white, 0, 'e2', 'e4')).statusCode).toBe(200);
    expect((await action(app, id, black, 'draw-offer', 1)).json().error).toBe('draw_offer_too_early');
    expect((await read(app, id, white)).json()).toMatchObject({ version: 1, drawOffer: null });
    expect((await move(app, id, black, 1, 'e7', 'e5')).statusCode).toBe(200);
    expect((await action(app, id, white, 'draw-offer', 2)).statusCode).toBe(200);
    expect((await move(app, id, white, 3, 'g1', 'f3')).statusCode).toBe(200);
    expect((await read(app, id, black)).json().drawOffer).toBe('white');
    expect((await move(app, id, black, 4, 'b8', 'c6')).statusCode).toBe(200);
    expect((await read(app, id, white)).json()).toMatchObject({ version: 5, drawOffer: null,
      drawOfferNextEligiblePly: { white: 23, black: 2 } });
    expect((await action(app, id, white, 'draw-offer', 5)).json().error).toBe('draw_offer_cooldown');
    expect((await action(app, id, black, 'draw-offer', 5)).statusCode).toBe(200);
    expect((await read(app, id, white)).json().drawOffer).toBe('black');
  });

  it('uses played plies, not action versions, at the exact cooldown boundary after restart', async () => {
    const { app, time } = fixture();
    const { id, white, black } = await challenge(app);
    expect((await move(app, id, white, 0, 'e2', 'e4')).statusCode).toBe(200);
    expect((await move(app, id, black, 1, 'e7', 'e5')).statusCode).toBe(200);
    expect((await action(app, id, white, 'draw-offer', 2)).statusCode).toBe(200);
    expect((await action(app, id, black, 'draw-decline', 3)).statusCode).toBe(200);
    const atTwenty = await playPawnMovesTo(app, id, white, black, 22);
    expect(atTwenty).toMatchObject({ version: 24, drawOffer: null,
      drawOfferNextEligiblePly: { white: 23, black: 2 } });
    const { app: restarted } = another(time);
    const restored = (await read(restarted, id, black)).json();
    expect(restored.history).toHaveLength(22);
    expect(restored.drawOfferNextEligiblePly).toEqual({ white: 23, black: 2 });
    expect((await action(restarted, id, white, 'draw-offer', 24)).json().error)
      .toBe('draw_offer_cooldown');
    const atTwentyOne = await playPawnMovesTo(restarted, id, white, black, 23);
    expect(atTwentyOne.version).toBe(25);
    const requestId = randomUUID();
    const accepted = await action(restarted, id, white, 'draw-offer', 25, requestId);
    expect(accepted.json()).toMatchObject({ accepted: true,
      game: { version: 26, drawOffer: 'white', drawOfferNextEligiblePly: { white: 44, black: 2 } } });
    expect((await action(app, id, white, 'draw-offer', 25, requestId)).json()).toEqual(accepted.json());
  });

  it('freezes a resignation until a verified ruling, then reconstructs the result', async () => {
    const { app, service, time } = fixture();
    const { id, white, black } = await challenge(app);
    const requestId = randomUUID();
    const resignation = await action(app, id, white, 'resign', 0, requestId);
    expect(resignation.json()).toMatchObject({ accepted: true,
      game: { status: 'pending_adjudication', version: 1, drawOffer: null,
        pending: { kind: 'resignation', resigningSide: 'white' }, result: null,
        clocks: { phase: 'stopped', activeSide: null } } });
    expect((await action(app, id, white, 'resign', 0, requestId)).json()).toEqual(resignation.json());
    expect((await move(app, id, white, 1, 'e2', 'e4')).json().error).toBe('adjudication_pending');
    expect((await action(app, id, black, 'draw-offer', 1)).json().error).toBe('adjudication_pending');
    expect(await service.resolveResignation(id, [{ from: 'e2', to: 'e4' }])).toBe(false);
    expect((await read(app, id, black)).json().status).toBe('pending_adjudication');
    expect(await service.resolveResignation(id, [
      { from: 'f2', to: 'f3' }, { from: 'e7', to: 'e5' },
      { from: 'g2', to: 'g4' }, { from: 'd8', to: 'h4' },
    ])).toBe(true);
    const { app: restarted } = another(time);
    expect((await read(restarted, id, white)).json()).toMatchObject({ version: 2, status: 'finished',
      result: { outcome: 'win', winner: 'black', reason: 'resignation' },
      clocks: { phase: 'stopped' } });
    expect((await read(restarted, id, black)).json().result.winner).toBe('black');
    expect(await service.resolveResignation(id, [])).toBe(false);
  });

  it('keeps explicit actions available in an earlier untimed game', async () => {
    const { app, time } = fixture();
    const { id, white, black } = await challenge(app);
    await pool.query(`UPDATE chess.games SET clock_mode = 'legacy_untimed',
      clock_phase = 'legacy_untimed' WHERE id = $1`, [id]);
    expect((await read(app, id, white)).json()).toMatchObject({
      drawOffer: null, drawOfferNextEligiblePly: { white: 2, black: 2 }, clocks: null });
    expect((await action(app, id, white, 'draw-offer', 0)).json().error).toBe('draw_offer_too_early');
    expect((await move(app, id, white, 0, 'e2', 'e4')).statusCode).toBe(200);
    expect((await move(app, id, black, 1, 'e7', 'e5')).statusCode).toBe(200);
    expect((await action(app, id, white, 'draw-offer', 2)).json()).toMatchObject({
      accepted: true, game: { drawOffer: 'white', clocks: null } });
    const { app: restarted } = another(time);
    expect((await read(restarted, id, black)).json()).toMatchObject({
      version: 3, drawOffer: 'white', clocks: null });
    expect((await action(restarted, id, black, 'draw-decline', 3)).json()).toMatchObject({
      accepted: true, game: { version: 4, drawOffer: null, clocks: null } });
  });

  it('orders a pre-deadline response before a late timer and flags an exact-deadline action', async () => {
    const { app, time } = fixture();
    let entered!: () => void;
    let release!: () => void;
    const atBarrier = new Promise<void>(resolve => { entered = resolve; });
    const held = new Promise<void>(resolve => { release = resolve; });
    app.addHook('preHandler', async request => {
      if (request.url.endsWith('/draw-accept')) { entered(); await held; }
    });
    const { id, white, black } = await challenge(app);
    expect((await move(app, id, white, 0, 'e2', 'e4')).statusCode).toBe(200);
    expect((await move(app, id, black, 1, 'e7', 'e5')).statusCode).toBe(200);
    expect((await action(app, id, black, 'draw-offer', 2)).statusCode).toBe(200);
    const deadline = (await read(app, id, white)).json().clocks.deadlineMs as number;
    const { service: timer } = another(time);
    time.set(deadline - 1);
    const response = action(app, id, white, 'draw-accept', 3);
    await atBarrier;
    time.set(deadline + 5000);
    await timer.heartbeat();
    expect(await timer.pollDueGames()).toBe(0);
    release();
    expect((await response).json()).toMatchObject({ accepted: true,
      game: { status: 'finished', result: { reason: 'agreement' }, clocks: { phase: 'stopped' } } });
    await timer.pollDueGames();
    expect((await read(app, id, white)).json().result.reason).toBe('agreement');

    const second = await challenge(app);
    expect((await move(app, second.id, second.white, 0, 'e2', 'e4')).statusCode).toBe(200);
    const blackDeadline = (await read(app, second.id, second.black)).json().clocks.deadlineMs as number;
    time.set(blackDeadline);
    const late = await action(app, second.id, second.black, 'resign', 1);
    expect(late.json().error).toBe('flag_fell');
    expect((await read(app, second.id, second.white)).json()).toMatchObject({
      pending: { kind: 'timeout', flaggedSide: 'black', deadlineMs: blackDeadline },
      clocks: { phase: 'flagged', flaggedAtMs: blackDeadline },
    });

    const third = await challenge(app);
    expect((await move(app, third.id, third.white, 0, 'e2', 'e4')).statusCode).toBe(200);
    const thirdDeadline = (await read(app, third.id, third.black)).json().clocks.deadlineMs as number;
    time.set(thirdDeadline - 1);
    expect((await action(app, third.id, third.black, 'resign', 1)).json()).toMatchObject({
      accepted: true, game: { status: 'pending_adjudication',
        pending: { kind: 'resignation', resigningSide: 'black' }, clocks: { phase: 'stopped' } },
    });
    time.set(thirdDeadline + 5000);
    await timer.pollDueGames();
    expect((await read(app, third.id, third.white)).json().pending.kind).toBe('resignation');
  });
});
