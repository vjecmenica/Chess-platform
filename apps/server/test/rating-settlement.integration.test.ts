import { randomBytes, randomUUID } from 'node:crypto';
import type pg from 'pg';
import { afterAll, afterEach, beforeAll, beforeEach, expect, it } from 'vitest';
import { ratingPoolByTimeControl, timeControlPresets, type RatingPool, type TimeControlId } from '@chess/contracts';
import { initialRatingState, rateGame, STANDARD_STARTING_FEN, type RatingScore, type RatingState } from '@chess/domain';
import { loadOrCreateAccountRating } from '../src/account-ratings.js';
import { databaseUrl, loadEnvironment } from '../src/config.js';
import { createPool } from '../src/database.js';
import { createGameService, type Arrival, type GameService, type SimpleGameAction } from '../src/game-service.js';
import { migrate } from '../src/migrations.js';
import { settleGameRatings } from '../src/rating-settlement.js';

interface Player { account: string; seat: string }
interface Settlement {
  pool: RatingPool;
  white_account_id: string;
  black_account_id: string;
  final_result: object;
  white_before: RatingState;
  black_before: RatingState;
  white_after: RatingState;
  black_after: RatingState;
  settled_at: Date;
  policy_version: string;
}

const startMs = 1_000_000_000_000;
const whiteMateInOne = '7k/8/5KQ1/8/8/8/8/8 w - - 0 1';
const services: GameService[] = [];
const clock = { value: startMs, nowMs() { return this.value; } };
let pool: pg.Pool;
let service: GameService;

beforeAll(async () => {
  loadEnvironment();
  pool = createPool(databaseUrl(process.env.TEST_DATABASE_URL, 'TEST_DATABASE_URL'));
  await migrate(pool);
});
beforeEach(async () => {
  clock.value = startMs;
  service = await server();
});
afterEach(async () => { for (const running of services.splice(0)) await running.stop(); });
afterAll(async () => { await pool?.end(); });

async function server() {
  const instance = createGameService(pool, clock);
  services.push(instance);
  await instance.start();
  return instance;
}

async function player(account: string = randomUUID(), createAccount = true): Promise<Player> {
  const seat = randomUUID();
  if (createAccount) await pool.query('INSERT INTO chess.accounts (id, username, password_hash) VALUES ($1, $2, $3)',
    [account, `rt_${account.replaceAll('-', '').slice(0, 20)}`, 'unused rating fixture']);
  await pool.query(`INSERT INTO chess.guest_sessions (id, token_hash, csrf_token, expires_at, account_id)
    VALUES ($1, $2, $3, now() + interval '1 hour', $4)`,
  [seat, randomBytes(32), randomBytes(32).toString('hex'), account]);
  return { account, seat };
}

async function fixture(options: { white?: Player; black?: Player; control?: TimeControlId; rated?: boolean;
  fen?: string; grace?: boolean; poolOverride?: RatingPool; whiteAccountOverride?: string } = {}) {
  const white = options.white ?? await player();
  const black = options.black ?? await player();
  const control = options.control ?? '3+2';
  const ratingPool = options.poolOverride ?? ratingPoolByTimeControl[control];
  const rated = options.rated ?? true;
  const id = randomUUID();
  const fen = options.fen ?? STANDARD_STARTING_FEN;
  await transaction(async client => {
    await client.query(`INSERT INTO chess.challenges (id, creator_guest_id, acceptor_guest_id,
      create_request_id, accepted_at, time_control) VALUES ($1, $2, $3, $4, now(), $5)`,
    [id, white.seat, black.seat, randomUUID(), control]);
    await client.query(`INSERT INTO chess.games (id, starting_fen, fen, side_to_move, status,
      clock_mode, clock_phase, clock_start_mode, white_first_move_deadline_at, white_remaining_ms,
      black_remaining_ms, rated, rated_white_account_id, rated_black_account_id, rating_pool)
      VALUES ($1, $2, $2, 'white', 'active', 'five_plus_three', 'awaiting_first_move', $3, $4, $5, $5,
        $6, $7, $8, $9)`,
    [id, fen, options.grace ? 'first_move_grace' : 'first_move', options.grace ? new Date(startMs + 30_000) : null,
      timeControlPresets[control].initialMs, rated, rated ? options.whiteAccountOverride ?? white.account : null,
      rated ? black.account : null, rated ? ratingPool : null]);
  });
  return { id, white, black, ratingPool, control };
}
type Fixture = Awaited<ReturnType<typeof fixture>>;

async function transaction<T>(work: (client: pg.PoolClient) => Promise<T>): Promise<T> {
  const client = await pool.connect();
  try {
    await client.query('BEGIN ISOLATION LEVEL READ COMMITTED');
    const result = await work(client);
    await client.query('COMMIT');
    return result;
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}

async function withArrival<T>(instance: GameService, work: (arrival: Arrival) => Promise<T>): Promise<T> {
  const arrival = instance.beginReceipt();
  try { return await work(arrival); }
  finally { await arrival.release(); }
}

function move(game: Fixture, side: 'white' | 'black', version: number, from: string, to: string) {
  return withArrival(service, arrival => service.move(game.id, game[side].seat, randomUUID(),
    { expectedVersion: version, from, to }, arrival));
}

function action(game: Fixture, side: 'white' | 'black', kind: SimpleGameAction, version: number,
  request = randomUUID(), instance = service) {
  return withArrival(instance, arrival => instance.action(game.id, game[side].seat, request,
    kind, { expectedVersion: version }, arrival));
}

async function history(id: string) {
  return (await pool.query<Settlement>('SELECT * FROM chess.game_rating_settlements WHERE game_id = $1', [id])).rows;
}

async function expectSettlement(game: Fixture, score: RatingScore, result: object) {
  const entries = await history(game.id);
  expect(entries).toHaveLength(1);
  const entry = entries[0]!;
  expect(entry).toMatchObject({ pool: game.ratingPool, white_account_id: game.white.account,
    black_account_id: game.black.account, final_result: result, policy_version: 'glicko2-immediate-v1' });
  const atMs = entry.settled_at.getTime();
  expect(atMs).toBeGreaterThan(startMs + 86_400_000);
  expect([entry.white_after, entry.black_after]).toEqual(rateGame(entry.white_before, entry.black_before, score, atMs));
  return entry;
}

async function expectUnrated(game: Fixture) {
  expect(await history(game.id)).toEqual([]);
  const { rows } = await pool.query('SELECT 1 FROM chess.account_ratings WHERE account_id IN ($1, $2)',
    [game.white.account, game.black.account]);
  expect(rows).toEqual([]);
}

it('settles checkmate for Black in the preset pool and replays the original moves', async () => {
  const game = await fixture({ control: '10+5' });
  expect((await move(game, 'white', 0, 'f2', 'f3')).status).toBe(200);
  expect((await move(game, 'black', 1, 'e7', 'e5')).status).toBe(200);
  expect((await move(game, 'white', 2, 'g2', 'g4')).status).toBe(200);
  const mate = await move(game, 'black', 3, 'd8', 'h4');
  const result = { outcome: 'win', winner: 'black', reason: 'checkmate' };
  expect(mate.body).toMatchObject({ game: { status: 'finished', rated: true, result } });
  const entry = await expectSettlement(game, 0, result);
  expect(entry.white_before).toEqual(initialRatingState());
  expect(entry.black_before).toEqual(initialRatingState());
  expect(entry.white_after.rating).toBeLessThan(1500);
  expect(entry.black_after.rating).toBeGreaterThan(1500);
  expect(entry.white_after.ratedGames).toBe(1);
  expect(entry.black_after.ratedGames).toBe(1);
  expect(await loadOrCreateAccountRating(pool, game.white.account, 'rapid')).toEqual(entry.white_after);
  expect(await loadOrCreateAccountRating(pool, game.black.account, 'rapid')).toEqual(entry.black_after);
  expect(await loadOrCreateAccountRating(pool, game.white.account, 'blitz')).toEqual(initialRatingState());
  const restarted = await server();
  expect((await restarted.read(game.id, game.white.seat)).body).toMatchObject({
    status: 'finished', result, history: ['f3', 'e5', 'g4', 'Qh4#'].map(san => expect.objectContaining({ san })),
  });
});

it('settles resignation for White using frozen accounts and preserves idempotency after restart', async () => {
  const game = await fixture({ fen: whiteMateInOne });
  const unrelated = await player();
  // Test that settlement uses the identities saved at acceptance even if a legacy link changes.
  await pool.query('UPDATE chess.guest_sessions SET account_id = $2 WHERE id = $1', [game.white.seat, unrelated.account]);
  const requestId = randomUUID();
  const first = await action(game, 'black', 'resign', 0, requestId);
  expect(first.status).toBe(200);
  const entry = await expectSettlement(game, 1, { outcome: 'win', winner: 'white', reason: 'resignation' });
  expect(entry.white_after.rating).toBeGreaterThan(1500);
  expect(entry.black_after.rating).toBeLessThan(1500);
  expect((await pool.query('SELECT 1 FROM chess.account_ratings WHERE account_id = $1', [unrelated.account])).rows).toEqual([]);
  await service.stop();
  const restarted = await server();
  expect(await action(game, 'black', 'resign', 0, requestId, restarted)).toEqual(first);
  expect((await restarted.read(game.id, game.black.seat)).status).toBe(200);
  expect(await restarted.pollDueGames()).toBe(0);
  expect(await Promise.all([1, 2].map(() => transaction(client => settleGameRatings(client, game.id))))).toEqual([false, false]);
  await expect(pool.query(`INSERT INTO chess.game_rating_settlements
    SELECT * FROM chess.game_rating_settlements WHERE game_id = $1`, [game.id])).rejects.toMatchObject({ code: '23505' });
  expect(await history(game.id)).toEqual([entry]);
  expect(await loadOrCreateAccountRating(pool, game.white.account, 'blitz')).toEqual(entry.white_after);
  expect(await loadOrCreateAccountRating(pool, game.black.account, 'blitz')).toEqual(entry.black_after);
});

it('settles an agreed draw from the game action path', async () => {
  const game = await fixture({ control: '20+10' });
  expect((await move(game, 'white', 0, 'e2', 'e4')).status).toBe(200);
  expect((await move(game, 'black', 1, 'e7', 'e5')).status).toBe(200);
  expect((await action(game, 'white', 'offer_draw', 2)).status).toBe(200);
  expect((await action(game, 'black', 'accept_draw', 3)).status).toBe(200);
  const entry = await expectSettlement(game, 0.5, { outcome: 'draw', reason: 'agreement' });
  expect(entry.white_after).toEqual(entry.black_after);
  expect(entry.white_after).toMatchObject({ rating: 1500, ratedGames: 1 });
  expect(entry.white_after.rd).toBeLessThan(350);
});

it('settles a valid fifty-move claim and the automatic seventy-five-move draw', async () => {
  const position = '4k3/8/8/8/8/8/8/R3K3 w - -';
  const claimGame = await fixture({ fen: `${position} 100 51` });
  expect((await withArrival(service, arrival => service.claim(claimGame.id, claimGame.white.seat, randomUUID(),
    { expectedVersion: 0, rule: 'fifty_move' }, arrival))).status).toBe(200);
  await expectSettlement(claimGame, 0.5, { outcome: 'draw', reason: 'fifty_move' });

  const automatic = await fixture({ fen: `${position} 149 75` });
  expect((await move(automatic, 'white', 0, 'a1', 'a2')).status).toBe(200);
  await expectSettlement(automatic, 0.5, { outcome: 'draw', reason: 'seventy_five_move' });
});

it('settles a server-clock timeout once when two instances process the due game', async () => {
  const game = await fixture({ control: '1+0' });
  expect((await move(game, 'white', 0, 'e2', 'e4')).status).toBe(200);
  expect(await service.registerTimeoutWitness(game.id, [
    { from: 'e7', to: 'e5' }, { from: 'f1', to: 'c4' }, { from: 'b8', to: 'c6' },
    { from: 'd1', to: 'h5' }, { from: 'g8', to: 'f6' }, { from: 'h5', to: 'f7' },
  ])).toBe(true);
  const other = await server();
  clock.value = startMs + 60_000;
  await Promise.all([service.heartbeat(), other.heartbeat()]);
  const [first, second] = await Promise.all([service.read(game.id, game.white.seat), other.read(game.id, game.black.seat)]);
  const result = { outcome: 'win', winner: 'white', reason: 'timeout', flaggedSide: 'black', deadlineMs: clock.value };
  for (const response of [first, second]) expect(response.body).toMatchObject({ status: 'finished', result });
  const entry = await expectSettlement(game, 1, result);
  expect(entry.white_after.ratedGames).toBe(1);
  expect(entry.black_after.ratedGames).toBe(1);
});

it('excludes casual, aborted, active, and pending adjudication games', async () => {
  const casual = await fixture({ rated: false });
  expect((await action(casual, 'white', 'resign', 0)).body).toMatchObject({ game: { status: 'finished', rated: false } });
  await expect(pool.query('UPDATE chess.games SET rated = true WHERE id = $1', [casual.id]))
    .rejects.toMatchObject({ code: '23514', message: 'Game rating terms are immutable' });
  const aborted = await fixture({ grace: true });
  clock.value = startMs + 30_000;
  await service.heartbeat();
  expect((await service.read(aborted.id, aborted.white.seat)).body).toMatchObject({ status: 'aborted' });
  const active = await fixture();
  const pending = await fixture();
  for (const game of [casual, aborted, active]) {
    expect(await transaction(client => settleGameRatings(client, game.id))).toBe(false);
    await expectUnrated(game);
  }
  await pool.query(`UPDATE chess.games SET status = 'pending_adjudication', clock_phase = 'stopped',
    pending = '{"kind":"resignation","resigningSide":"white"}' WHERE id = $1`, [pending.id]);
  try {
    expect(await transaction(client => settleGameRatings(client, pending.id))).toBe(false);
    await expectUnrated(pending);
  } finally {
    // Legacy migration tests replay old SQL against pending fixtures in the shared test database.
    await pool.query(`UPDATE chess.games SET status = 'active', clock_phase = 'awaiting_first_move',
      pending = NULL WHERE id = $1`, [pending.id]);
  }
});

it('rejects mismatched accounts, same-account opponents, incorrect pools, and a finish without settlement', async () => {
  const white = await player();
  const black = await player();
  const anotherWhiteSeat = await player(white.account, false);
  await expect(fixture({ white, black, whiteAccountOverride: (await player()).account })).rejects.toMatchObject({ code: '23514' });
  await expect(fixture({ white, black: anotherWhiteSeat })).rejects.toMatchObject({ code: '23514' });
  await expect(fixture({ white, black, control: '1+0', poolOverride: 'rapid' })).rejects.toMatchObject({ code: '23514' });
  const game = await fixture({ white, black });
  await expect(pool.query(`UPDATE chess.games SET status = 'finished',
    result = '{"outcome":"win","winner":"white","reason":"resignation"}' WHERE id = $1`, [game.id]))
    .rejects.toMatchObject({ code: '23514', message: 'A finished rated game requires an atomic rating settlement' });
  expect((await service.read(game.id, white.seat)).body).toMatchObject({ status: 'active', result: null });
  await expectUnrated(game);
});

it('accepts the contract pool for each supported preset at creation', async () => {
  const white = await player();
  const black = await player();
  for (const control of Object.keys(ratingPoolByTimeControl) as TimeControlId[]) {
    const game = await fixture({ control, white, black });
    expect((await pool.query('SELECT rated, rating_pool FROM chess.games WHERE id = $1', [game.id])).rows)
      .toEqual([{ rated: true, rating_pool: ratingPoolByTimeControl[control] }]);
  }
});

it('allows a trusted adjudication transaction to settle once while another transaction retries', async () => {
  const game = await fixture();
  const result = { outcome: 'win', winner: 'white', reason: 'timeout', flaggedSide: 'black', deadlineMs: startMs };
  await pool.query(`UPDATE chess.games SET status = 'pending_adjudication', clock_phase = 'flagged',
    pending = $2, flagged_side = 'black', flagged_at = $3 WHERE id = $1`,
  [game.id, { kind: 'timeout', flaggedSide: 'black', deadlineMs: startMs }, new Date(startMs)]);
  let retry: Promise<boolean> | undefined;
  await transaction(async client => {
    expect(await settleGameRatings(client, game.id)).toBe(false);
    await client.query("UPDATE chess.games SET status = 'finished', pending = NULL, result = $2 WHERE id = $1",
      [game.id, result]);
    retry = transaction(other => settleGameRatings(other, game.id));
    expect(await settleGameRatings(client, game.id)).toBe(true);
    expect(await history(game.id)).toEqual([]);
  });
  expect(await retry).toBe(false);
  await expectSettlement(game, 1, result);
  await expect(pool.query("UPDATE chess.games SET result = '{\"outcome\":\"draw\",\"reason\":\"agreement\"}' WHERE id = $1", [game.id]))
    .rejects.toMatchObject({ code: '23514', message: 'A finished rated game requires an atomic rating settlement' });
});

it.each(['initialize', 'second rating update', 'history insertion'] as const)
  ('rolls back the final transition and all rating writes on failure at %s, then retries after restart', async failure => {
    const game = await fixture({ fen: whiteMateInOne });
    const request = randomUUID();
    const table = failure === 'history insertion' ? 'chess.game_rating_settlements' : 'chess.account_ratings';
    const check = failure === 'initialize' ? `account_id <> '${game.black.account}'`
      : failure === 'second rating update' ? `account_id <> '${game.black.account}' OR rated_games = 0`
        : `game_id <> '${game.id}'`;
    await pool.query(`ALTER TABLE ${table} ADD CONSTRAINT settlement_failure_probe CHECK (${check}) NOT VALID`);
    try {
      await expect(action(game, 'black', 'resign', 0, request))
        .rejects.toMatchObject({ code: '23514', constraint: 'settlement_failure_probe' });
      expect((await pool.query('SELECT status, result, version FROM chess.games WHERE id = $1', [game.id])).rows)
        .toEqual([{ status: 'active', result: null, version: 0 }]);
      expect((await pool.query('SELECT 1 FROM chess.game_actions WHERE game_id = $1', [game.id])).rows).toEqual([]);
      expect((await pool.query('SELECT response, status_code FROM chess.game_move_receipts WHERE game_id = $1', [game.id])).rows)
        .toEqual([{ response: null, status_code: null }]);
      await expectUnrated(game);
    } finally {
      await pool.query(`ALTER TABLE ${table} DROP CONSTRAINT settlement_failure_probe`);
    }
    await service.stop();
    const restarted = await server();
    expect((await restarted.read(game.id, game.white.seat)).body).toMatchObject({ status: 'finished', version: 1 });
    expect((await action(game, 'black', 'resign', 0, request, restarted)).status).toBe(200);
    const entry = await expectSettlement(game, 1, { outcome: 'win', winner: 'white', reason: 'resignation' });
    expect(entry.white_after.ratedGames).toBe(1);
    expect(entry.black_after.ratedGames).toBe(1);
  });

it('serializes reversed seats with missing rating rows while unrelated games settle concurrently', async () => {
  const first = await fixture({ fen: whiteMateInOne });
  const reversed = await fixture({ white: first.black, black: first.white, fen: whiteMateInOne });
  const unrelatedOne = await fixture({ fen: whiteMateInOne });
  const unrelatedTwo = await fixture({ fen: whiteMateInOne });
  const other = await server();
  const commands = [first, reversed, unrelatedOne, unrelatedTwo].map((game, index) =>
    action(game, 'black', 'resign', 0, randomUUID(), index % 2 ? other : service));
  expect((await Promise.all(commands)).map(result => result.status)).toEqual([200, 200, 200, 200]);
  const result = { outcome: 'win', winner: 'white', reason: 'resignation' };
  const [a, b, c, d] = await Promise.all([first, reversed, unrelatedOne, unrelatedTwo].map(game =>
    expectSettlement(game, 1, result)));
  const [earlier, later] = a!.white_after.ratedGames === 1 ? [a!, b!] : [b!, a!];
  expect(earlier.white_before).toEqual(initialRatingState());
  expect(earlier.black_before).toEqual(initialRatingState());
  expect(later.white_before).toEqual(earlier.black_after);
  expect(later.black_before).toEqual(earlier.white_after);
  expect(later.settled_at.getTime()).toBeGreaterThanOrEqual(earlier.settled_at.getTime());
  expect(later.white_after.ratedGames).toBe(2);
  expect(later.black_after.ratedGames).toBe(2);
  expect(await loadOrCreateAccountRating(pool, later.white_account_id, 'blitz')).toEqual(later.white_after);
  expect(await loadOrCreateAccountRating(pool, later.black_account_id, 'blitz')).toEqual(later.black_after);
  expect([c!.white_after.ratedGames, d!.white_after.ratedGames]).toEqual([1, 1]);
});
