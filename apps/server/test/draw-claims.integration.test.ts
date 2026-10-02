import { createHash, randomUUID } from 'node:crypto';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import type pg from 'pg';
import { Chess } from 'chess.js';
import { databaseUrl, loadEnvironment } from '../src/config.js';
import { checkDatabase, createPool } from '../src/database.js';
import { migrate } from '../src/migrations.js';
import { buildApp } from '../src/app.js';
import { createGameService } from '../src/game-service.js';

interface Guest { cookie: string; csrf: string; id: string }
type Rule = 'threefold_repetition' | 'fifty_move';

describe('draw claims against PostgreSQL', () => {
  let pool: pg.Pool;
  const apps: FastifyInstance[] = [];
  const time = { value: 2_100_000_000_000, nowMs() { return this.value; } };

  beforeAll(async () => {
    loadEnvironment();
    pool = createPool(databaseUrl(process.env.TEST_DATABASE_URL, 'TEST_DATABASE_URL'));
    await checkDatabase(pool);
    await migrate(pool);
  });
  afterEach(async () => {
    for (const app of apps.splice(0)) await app.close();
    time.value = 2_100_000_000_000;
  });
  afterAll(async () => { if (pool) await pool.end(); });

  function instance(hooks: { afterMoveCommit?: () => Promise<void> } = {}) {
    const service = createGameService(pool, time, hooks);
    const app = buildApp(() => checkDatabase(pool), false,
      { pool, secureCookies: true, gameService: service });
    apps.push(app);
    return { app, service };
  }
  async function guest(app: FastifyInstance): Promise<Guest> {
    const response = await app.inject('/guest-session');
    const cookie = String(response.headers['set-cookie']).split(';')[0]!;
    const id = (await pool.query<{ id: string }>(
      'SELECT id FROM chess.guest_sessions WHERE token_hash = $1',
      [createHash('sha256').update(cookie.slice(cookie.indexOf('=') + 1)).digest()])).rows[0]?.id;
    return { cookie, csrf: response.json().csrfToken as string, id: id ?? '' };
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
  function move(app: FastifyInstance, id: string, actor: Guest, version: number,
    from: string, to: string, requestId = randomUUID()) {
    return app.inject({ method: 'POST', url: `/games/${id}/moves`,
      headers: { cookie: actor.cookie, 'x-csrf-token': actor.csrf,
        'idempotency-key': requestId }, payload: { expectedVersion: version, from, to } });
  }
  function claim(app: FastifyInstance, id: string, actor: Guest, version: number,
    rule: Rule, intendedMove?: { from: string; to: string }, requestId = randomUUID()) {
    return app.inject({ method: 'POST', url: `/games/${id}/draw-claim`,
      headers: { cookie: actor.cookie, 'x-csrf-token': actor.csrf,
        'idempotency-key': requestId },
      payload: { expectedVersion: version, rule, ...(intendedMove ? { intendedMove } : {}) } });
  }
  async function cycle(app: FastifyInstance, id: string, white: Guest, black: Guest,
    count: number) {
    const sequence = [['g1', 'f3'], ['g8', 'f6'], ['f3', 'g1'], ['f6', 'g8']];
    for (let index = 0; index < count; index++) {
      const [from, to] = sequence[index % 4]!;
      expect((await move(app, id, index % 2 ? black : white, index, from!, to!)).statusCode).toBe(200);
    }
  }

  it('finishes a current or intended threefold claim without playing the intended move', async () => {
    const { app } = instance();
    const first = await challenge(app);
    expect((await read(app, first.id, first.white)).json().availableDrawClaims).toEqual([]);
    await cycle(app, first.id, first.white, first.black, 8);
    expect((await read(app, first.id, first.white)).json().availableDrawClaims)
      .toEqual(['threefold_repetition']);
    expect((await read(app, first.id, first.black)).json().availableDrawClaims)
      .toEqual(['threefold_repetition']);
    const requestId = randomUUID();
    const accepted = await claim(app, first.id, first.white, 8, 'threefold_repetition', undefined, requestId);
    expect(accepted.json()).toMatchObject({ accepted: true, claimCorrect: true, bonusMs: 0,
      game: { version: 9, status: 'finished', result: { reason: 'threefold_repetition' },
        clocks: { phase: 'stopped' } } });
    expect((await claim(app, first.id, first.white, 8, 'threefold_repetition', undefined, requestId)).json())
      .toEqual(accepted.json());
    const { app: restarted } = instance();
    const restored = (await read(restarted, first.id, first.black)).json();
    expect(restored).toMatchObject({ version: 9, result: { reason: 'threefold_repetition' } });
    expect(restored.history).toHaveLength(8);

    const second = await challenge(app);
    await cycle(app, second.id, second.white, second.black, 7);
    const intended = await claim(app, second.id, second.black, 7, 'threefold_repetition',
      { from: 'f6', to: 'g8' });
    expect(intended.json()).toMatchObject({ claimCorrect: true,
      game: { version: 8, position: { sideToMove: 'black' } } });
    expect((await read(restarted, second.id, second.white)).json().history).toHaveLength(7);
  });

  it('accepts a fifty-move claim after 100 reversible half-moves', async () => {
    const { app } = instance();
    const { id, white, black } = await challenge(app);
    const board = new Chess();
    const key = () => board.fen().split(' ').slice(0, 4).join(' ');
    const counts = new Map([[key(), 1]]);
    for (let ply = 0; ply < 100; ply++) {
      const choices = board.moves({ verbose: true }).filter(move =>
        move.piece !== 'p' && move.captured === undefined).map(move => {
        const candidate = new Chess(board.fen());
        candidate.move(move);
        const identity = candidate.fen().split(' ').slice(0, 4).join(' ');
        return { move, identity, count: counts.get(identity) ?? 0,
          terminal: candidate.isCheckmate() || candidate.isStalemate() };
      }).filter(candidate => candidate.count < 4 && !candidate.terminal)
        .sort((a, b) => a.count - b.count
          || `${a.move.from}${a.move.to}`.localeCompare(`${b.move.from}${b.move.to}`));
      const chosen = choices[0];
      if (!chosen) throw new Error(`No reversible continuation at ply ${ply}.`);
      expect((await move(app, id, ply % 2 ? black : white, ply,
        chosen.move.from, chosen.move.to)).statusCode).toBe(200);
      board.move(chosen.move);
      counts.set(chosen.identity, chosen.count + 1);
    }
    expect((await read(app, id, white)).json().availableDrawClaims).toContain('fifty_move');
    const accepted = await claim(app, id, white, 100, 'fifty_move');
    expect(accepted.json()).toMatchObject({ claimCorrect: true, bonusMs: 0,
      game: { status: 'finished', result: { reason: 'fifty_move' } } });
    expect((await read(app, id, black)).json().history).toHaveLength(100);
  });

  it('penalizes an incorrect claim once, preserves competing offers, and rejects invalid commands', async () => {
    const { app } = instance();
    const { id, white, black } = await challenge(app);
    const outsider = await guest(app);
    expect((await claim(app, id, outsider, 0, 'fifty_move')).statusCode).toBe(403);
    expect((await claim(app, id, white, 0, 'fifty_move', { from: 'e2', to: 'e5' })).json().error)
      .toBe('illegal_move');
    expect((await read(app, id, white)).json()).toMatchObject({ version: 0,
      claimDrawOffer: null, clocks: { remainingMs: { black: 300_000 } } });
    expect((await move(app, id, white, 0, 'e2', 'e4')).statusCode).toBe(200);
    expect((await move(app, id, black, 1, 'e7', 'e5')).statusCode).toBe(200);
    const offer = await app.inject({ method: 'POST', url: `/games/${id}/draw-offer`,
      headers: { cookie: black.cookie, 'x-csrf-token': black.csrf,
        'idempotency-key': randomUUID() }, payload: { expectedVersion: 2 } });
    expect(offer.statusCode).toBe(200);
    const requestId = randomUUID();
    const incorrect = await claim(app, id, white, 3, 'threefold_repetition', undefined, requestId);
    expect(incorrect.json()).toMatchObject({ accepted: true, claimCorrect: false,
      bonusMs: 60_000, game: { version: 4, drawOffer: 'black', claimDrawOffer: 'white',
        clocks: { remainingMs: { black: 363_000 }, activeSide: 'white' } } });
    expect((await claim(app, id, white, 3, 'threefold_repetition', undefined, requestId)).json())
      .toEqual(incorrect.json());
    expect((await claim(app, id, white, 3, 'fifty_move')).json().error).toBe('stale_version');
    const { app: restarted } = instance();
    expect((await read(restarted, id, black)).json()).toMatchObject({ version: 4,
      drawOffer: 'black', claimDrawOffer: 'white', history: [{ ply: 1 }, { ply: 2 }] });
    const accepted = await restarted.inject({ method: 'POST', url: `/games/${id}/draw-accept`,
      headers: { cookie: black.cookie, 'x-csrf-token': black.csrf,
        'idempotency-key': randomUUID() }, payload: { expectedVersion: 4 } });
    expect(accepted.json()).toMatchObject({ game: { status: 'finished',
      result: { outcome: 'draw', reason: 'agreement' }, clocks: { phase: 'stopped' } } });
  });

  it('plays an incorrect intended first move and recovers its handoff after restart', async () => {
    const { app } = instance();
    const { id, white, black } = await challenge(app);
    const requestId = randomUUID();
    const incorrect = await claim(app, id, white, 0, 'fifty_move',
      { from: 'e2', to: 'e4' }, requestId);
    expect(incorrect.json()).toMatchObject({ claimCorrect: false, bonusMs: 60_000,
      move: { ply: 1, san: 'e4' }, game: { version: 1,
        clocks: { remainingMs: { white: 300_000, black: 360_000 }, activeSide: 'black' } } });
    const { app: restarted } = instance();
    expect((await read(restarted, id, black)).json()).toMatchObject({ version: 1,
      history: [{ ply: 1, san: 'e4' }], claimDrawOffer: 'white',
      clocks: { remainingMs: { black: 360_000 } } });
    expect((await claim(restarted, id, white, 0, 'fifty_move',
      { from: 'e2', to: 'e4' }, requestId)).json()).toEqual(incorrect.json());
    expect((await move(app, id, black, 1, 'e7', 'e5')).statusCode).toBe(200);
    expect((await read(app, id, white)).json().claimDrawOffer).toBeNull();
  });

  it('recovers a committed intended-move claim if the original worker stops before handoff', async () => {
    const { app } = instance({ afterMoveCommit: async () => {
      throw new Error('Simulated stop after the claim transaction committed.');
    } });
    const { id, white, black } = await challenge(app);
    const requestId = randomUUID();
    expect((await claim(app, id, white, 0, 'fifty_move',
      { from: 'e2', to: 'e4' }, requestId)).statusCode).toBe(500);
    const { rows } = await pool.query<{ clock_phase: string }>(
      'SELECT clock_phase FROM chess.games WHERE id = $1', [id]);
    expect(rows[0]?.clock_phase).toBe('handoff');
    const { app: restarted } = instance();
    expect((await read(restarted, id, black)).json()).toMatchObject({ version: 1,
      claimDrawOffer: 'white', clocks: { activeSide: 'black', remainingMs: { black: 360_000 } } });
    expect((await claim(restarted, id, white, 0, 'fifty_move',
      { from: 'e2', to: 'e4' }, requestId)).json()).toMatchObject({
      accepted: true, claimCorrect: false, bonusMs: 60_000, move: { san: 'e4' } });
  });

  it('orders a claim and a move by their trusted receipts across service instances', async () => {
    const { app, service } = instance();
    const { service: opponentInstance } = instance();
    await opponentInstance.start();
    const { id, white, black } = await challenge(app);
    expect((await move(app, id, white, 0, 'e2', 'e4')).statusCode).toBe(200);
    expect((await move(app, id, black, 1, 'e7', 'e5')).statusCode).toBe(200);
    const first = service.beginReceipt();
    time.value += 1;
    const second = opponentInstance.beginReceipt();
    const [claimed, moved] = await Promise.all([
      service.claim(id, white.id, randomUUID(), { expectedVersion: 2,
        rule: 'threefold_repetition' }, first),
      opponentInstance.move(id, white.id, randomUUID(), { expectedVersion: 2,
        from: 'g1', to: 'f3' }, second),
    ]);
    expect(claimed.body).toMatchObject({ accepted: true, claimCorrect: false });
    expect(moved.body).toMatchObject({ error: 'stale_version', currentVersion: 3 });
    expect((await read(app, id, white)).json()).toMatchObject({ version: 3,
      history: [{ ply: 1 }, { ply: 2 }], claimDrawOffer: 'white' });
  });

  it('orders pre-deadline claims ahead of a flag and flags exact-deadline claims', async () => {
    const { app, service } = instance();
    const { id, white, black } = await challenge(app);
    expect((await move(app, id, white, 0, 'e2', 'e4')).statusCode).toBe(200);
    expect((await move(app, id, black, 1, 'e7', 'e5')).statusCode).toBe(200);
    const state = (await read(app, id, white)).json();
    const deadline = state.clocks.deadlineMs as number;
    time.value = deadline - 1;
    const early = service.beginReceipt();
    time.value = deadline + 1;
    const response = await service.claim(id, white.id, randomUUID(), {
      expectedVersion: 2, rule: 'fifty_move' }, early);
    expect(response.body).toMatchObject({ claimCorrect: false, bonusMs: 60_000 });
    expect((await read(app, id, white)).json()).toMatchObject({ status: 'active', version: 3 });

    const other = await challenge(app);
    expect((await move(app, other.id, other.white, 0, 'e2', 'e4')).statusCode).toBe(200);
    expect((await move(app, other.id, other.black, 1, 'e7', 'e5')).statusCode).toBe(200);
    const laterDeadline = (await read(app, other.id, other.white)).json().clocks.deadlineMs as number;
    time.value = laterDeadline;
    const exact = await claim(app, other.id, other.white, 2, 'fifty_move');
    expect(exact.json().error).toBe('flag_fell');
    expect((await read(app, other.id, other.white)).json()).toMatchObject({
      status: 'pending_adjudication', claimDrawOffer: null });
  });
});
