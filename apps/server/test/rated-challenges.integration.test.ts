import { randomInt, randomUUID } from 'node:crypto';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { userInfo } from 'node:os';
import { fileURLToPath } from 'node:url';
import type { FastifyInstance } from 'fastify';
import type pg from 'pg';
import { afterAll, afterEach, beforeAll, expect, it } from 'vitest';
import { initialRatingState } from '@chess/domain';
import { loadOrCreateAccountRating } from '../src/account-ratings.js';
import { buildApp } from '../src/app.js';
import { databaseUrl, loadEnvironment } from '../src/config.js';
import { createPool } from '../src/database.js';
import { createGameService } from '../src/game-service.js';
import { migrate } from '../src/migrations.js';
import { createRatedAdjudicationProcessor } from '../src/rated-adjudication.js';
import { claimAdjudication } from '../src/rated-adjudication-store.js';
import { disconnectTiming } from '../src/rated-presence.js';

interface Browser { cookies: Map<string, string>; csrf: string; ip: string }
const password = 'a synthetic rated challenge password';
const subnet = `127.${randomInt(1, 255)}.${randomInt(1, 255)}`;
const clock = () => ({ value: 1_950_000_000_000, nowMs() { return this.value; } });
const apps: FastifyInstance[] = [];
const terms = { timeControl: '10+2', rated: true };
let browserCount = 0;
let pool: pg.Pool;
let testDatabase: string;

beforeAll(async () => {
  loadEnvironment();
  testDatabase = databaseUrl(process.env.TEST_DATABASE_URL, 'TEST_DATABASE_URL');
  pool = createPool(testDatabase);
  await migrate(pool);
});
afterEach(async () => { for (const app of apps.splice(0)) await app.close(); });
afterAll(async () => { await pool?.end(); });

function server(ratedChallengesEnabled?: boolean, time = clock(), disconnectEnabled = false) {
  const service = createGameService(pool, time, { disconnectEnabled });
  const app = buildApp(async () => {}, false, { pool, secureCookies: false, gameService: service,
    ...(ratedChallengesEnabled === undefined ? {} : { ratedChallengesEnabled }) });
  apps.push(app);
  return { app, time, service };
}

async function browser(app: FastifyInstance): Promise<Browser> {
  const response = await app.inject('/guest-session');
  expect(response.statusCode).toBe(200);
  return { cookies: new Map(response.cookies.map(cookie => [cookie.name, cookie.value] as const)),
    csrf: response.json().csrfToken, ip: `${subnet}.${++browserCount}` };
}

function cookie(who: Browser) { return [...who.cookies].map(([name, value]) => `${name}=${value}`).join('; '); }
function get(app: FastifyInstance, who: Browser, url: string) {
  return app.inject({ url, headers: { cookie: cookie(who) } });
}
function post(app: FastifyInstance, who: Browser, url: string, payload?: object, key: string = randomUUID()) {
  return app.inject({ method: 'POST', url, remoteAddress: who.ip, headers: {
    cookie: cookie(who), 'x-csrf-token': who.csrf, 'idempotency-key': key,
  }, ...(payload === undefined ? {} : { payload }) });
}

async function auth(app: FastifyInstance, who: Browser, action: 'register' | 'login' | 'logout', username?: string) {
  const response = await post(app, who, `/account/${action}`, username ? { username, password } : undefined);
  expect(response.statusCode).toBe(200);
  for (const { name, value } of response.cookies) {
    if (value) who.cookies.set(name, value);
    else who.cookies.delete(name);
  }
  who.csrf = response.json().csrfToken;
  return response.json().account as { id: string; username: string } | null;
}

async function register(app: FastifyInstance) {
  const who = await browser(app);
  const account = (await auth(app, who, 'register', `rc_${randomUUID().replaceAll('-', '').slice(0, 20)}`))!;
  return { who, ...account };
}

async function create(app: FastifyInstance, who: Browser, body: object = terms, key?: string) {
  const response = await post(app, who, '/challenges', body, key);
  expect(response.statusCode).toBe(200);
  return response.json().id as string;
}

const accept = (app: FastifyInstance, who: Browser, id: string) => post(app, who, `/challenges/${id}/accept`);

async function assertNoSettlement(id: string) {
  expect((await pool.query('SELECT 1 FROM chess.game_rating_settlements WHERE game_id = $1', [id])).rowCount).toBe(0);
}

async function readCase(id: string) {
  return (await pool.query('SELECT * FROM chess.rated_adjudications WHERE game_id = $1', [id])).rows[0];
}

async function useLegacyAdjudication(id: string) {
  await pool.query(`UPDATE chess.games SET resignation_policy = 'fide_proof_required',
    timeout_policy = 'fide_proof_required' WHERE id = $1`, [id]);
}

async function deletePendingProbe(id: string) {
  if ((await pool.query("SELECT 1 FROM chess.games WHERE id = $1 AND status = 'pending_adjudication'", [id])).rowCount === 0) return;
  // Legacy Casual migration tests replay historical SQL against pending fixtures in this test database.
  await pool.query('DELETE FROM chess.game_move_receipts WHERE game_id = $1', [id]);
  await pool.query('DELETE FROM chess.game_actions WHERE game_id = $1', [id]);
  await pool.query('DELETE FROM chess.game_moves WHERE game_id = $1', [id]);
  await pool.query('DELETE FROM chess.games WHERE id = $1', [id]);
  await pool.query('DELETE FROM chess.challenges WHERE id = $1', [id]);
}

const foolsMate = [
  { from: 'f2', to: 'f3' }, { from: 'e7', to: 'e5' }, { from: 'g2', to: 'g4' }, { from: 'd8', to: 'h4' },
];
const quietOpening = [
  ['e2', 'e4'], ['e7', 'e5'], ['g1', 'f3'], ['b8', 'c6'],
  ['f1', 'b5'], ['a7', 'a6'], ['b5', 'a4'], ['g8', 'f6'],
] as const;

async function play(app: FastifyInstance, id: string, who: Browser, version: number, from: string, to: string) {
  const response = await post(app, who, `/games/${id}/moves`, { expectedVersion: version, from, to });
  expect(response.statusCode).toBe(200);
}

it('keeps Rated creation off by default and blocks accepting an open Rated link when disabled', async () => {
  const { app } = server();
  const { app: enabled } = server(true);
  const white = await register(enabled);
  const black = await register(enabled);
  expect((await app.inject('/guest-session')).json()).not.toHaveProperty('ratedChallengesEnabled');
  expect((await enabled.inject('/guest-session')).json()).toMatchObject({ ratedChallengesEnabled: true });
  expect((await post(app, white.who, '/challenges', terms)).json()).toEqual({ error: 'rated_challenges_disabled' });
  const id = await create(enabled, white.who);
  expect((await get(app, black.who, `/challenges/${id}`)).json()).toMatchObject({ game: { rated: true, status: 'not_created' } });
  expect((await accept(app, black.who, id)).json()).toEqual({ error: 'rated_challenges_disabled' });
  expect((await pool.query('SELECT id FROM chess.games WHERE id = $1', [id])).rowCount).toBe(0);
  expect((await accept(enabled, black.who, id)).json()).toMatchObject({ game: { rated: true, status: 'active' } });
  expect((await accept(app, black.who, id)).statusCode).toBe(200);
});

it('validates sessions, mode, owner and request terms before admitting a Rated opponent', async () => {
  const { app } = server(true);
  const guest = await browser(app);
  const white = await register(app);
  const sameAccount = await browser(app);
  await auth(app, sameAccount, 'login', white.username);
  const guestCreate = await post(app, guest, '/challenges', terms);
  expect(guestCreate.statusCode).toBe(401);
  expect(guestCreate.json()).toEqual({ error: 'rated_account_required' });
  expect((await post(app, white.who, '/challenges', { ...terms, rated: 'true' })).json())
    .toEqual({ error: 'invalid_challenge_mode' });
  expect((await post(app, white.who, '/challenges', { ...terms, whiteAccountId: white.id })).statusCode).toBe(400);
  const key = randomUUID();
  const id = await create(app, white.who, terms, key);
  expect(await create(app, sameAccount, terms, key)).toBe(id);
  const conflict = await post(app, sameAccount, '/challenges', { ...terms, rated: false }, key);
  expect(conflict.statusCode).toBe(409);
  expect(conflict.json()).toEqual({ error: 'request_id_conflict' });
  expect((await post(app, white.who, '/challenges', { ...terms, timeControl: '1+0' }, key)).statusCode).toBe(409);
  expect((await get(app, guest, `/challenges/${id}`)).json()).toMatchObject({
    yourSeat: null, status: 'open', game: { rated: true, initialMs: 600_000, incrementMs: 2_000 },
  });
  const guestAccept = await accept(app, guest, id);
  expect(guestAccept.statusCode).toBe(401);
  expect(guestAccept.json()).toEqual({ error: 'rated_account_required' });
  expect((await accept(app, sameAccount, id)).json()).toEqual({ error: 'cannot_accept_own_challenge' });
  await expect(pool.query('UPDATE chess.challenges SET rated = false WHERE id = $1', [id]))
    .rejects.toMatchObject({ code: '23514', message: 'Challenge rating terms are immutable' });
  expect((await pool.query('SELECT rated, rated_creator_account_id FROM chess.challenges WHERE id = $1', [id])).rows)
    .toEqual([{ rated: true, rated_creator_account_id: white.id }]);
});

it('admits only one concurrent acceptor and freezes both accounts with the mapped pool', async () => {
  const { app } = server(true);
  const white = await register(app), first = await register(app), second = await register(app);
  const id = await create(app, white.who, { timeControl: '20+10', rated: true });
  const [a, b] = await Promise.all([accept(app, first.who, id), accept(app, second.who, id)]);
  expect([a.statusCode, b.statusCode].sort()).toEqual([200, 409]);
  const winner = a.statusCode === 200 ? first : second;
  expect((await accept(app, winner.who, id)).json()).toMatchObject({ yourSeat: 'black', game: { rated: true } });
  expect((await pool.query(`SELECT rated, rated_white_account_id, rated_black_account_id, rating_pool
    FROM chess.games WHERE id = $1`, [id])).rows).toEqual([{
    rated: true, rated_white_account_id: white.id, rated_black_account_id: winner.id, rating_pool: 'classical',
  }]);
  await expect(pool.query("UPDATE chess.games SET rating_pool = 'bullet' WHERE id = $1", [id]))
    .rejects.toMatchObject({ code: '23514', message: 'Game rating terms are immutable' });

  const reversed = await create(app, winner.who);
  const forward = await create(app, white.who);
  const mutual = await Promise.all([accept(app, winner.who, forward), accept(app, white.who, reversed)]);
  expect(mutual.map(response => response.statusCode)).toEqual([200, 200]);
});

it('resumes across sessions and restart, settles once, and blocks Rated rematch creation', async () => {
  const { app, time } = server(true);
  const white = await register(app), black = await register(app);
  const id = await create(app, white.who);
  expect((await accept(app, black.who, id)).statusCode).toBe(200);
  const move = (instance: FastifyInstance, who: Browser, expectedVersion: number, from: string, to: string, key?: string) =>
    post(instance, who, `/games/${id}/moves`, { expectedVersion, from, to }, key);
  expect((await move(app, white.who, 0, 'f2', 'f3')).statusCode).toBe(200);
  await auth(app, white.who, 'logout');
  expect((await get(app, white.who, `/games/${id}`)).statusCode).toBe(403);
  expect((await move(app, white.who, 1, 'e7', 'e5')).statusCode).toBe(403);
  await app.close();
  const { app: restarted } = server(undefined, time);
  const reconnected = await browser(restarted);
  await auth(restarted, reconnected, 'login', white.username);
  expect((await get(restarted, reconnected, `/games/${id}`)).json()).toMatchObject({
    rated: true, status: 'active', yourSeat: 'white', history: [{ san: 'f3' }],
  });
  expect((await move(restarted, black.who, 1, 'e7', 'e5')).statusCode).toBe(200);
  expect((await move(restarted, reconnected, 2, 'g2', 'g4')).statusCode).toBe(200);
  const request = randomUUID();
  const finish = await move(restarted, black.who, 3, 'd8', 'h4', request);
  expect(finish.json()).toMatchObject({ game: { rated: true, status: 'finished', result: { outcome: 'win', winner: 'black' } } });
  const whiteRating = await loadOrCreateAccountRating(pool, white.id, 'rapid');
  const blackRating = await loadOrCreateAccountRating(pool, black.id, 'rapid');
  expect(whiteRating).toMatchObject({ rating: expect.any(Number), ratedGames: 1 });
  expect(whiteRating.rating).toBeLessThan(1500);
  expect(blackRating.ratedGames).toBe(1);
  expect(blackRating.rating).toBeGreaterThan(1500);
  expect((await pool.query(`SELECT pool, white_after, black_after FROM chess.game_rating_settlements WHERE game_id = $1`, [id])).rows)
    .toEqual([{ pool: 'rapid', white_after: whiteRating, black_after: blackRating }]);
  expect((await move(restarted, black.who, 3, 'd8', 'h4', request)).json()).toEqual(finish.json());
  expect(await loadOrCreateAccountRating(pool, white.id, 'rapid')).toEqual(whiteRating);
  expect(await loadOrCreateAccountRating(pool, black.id, 'rapid')).toEqual(blackRating);
  expect(await loadOrCreateAccountRating(pool, black.id, 'blitz')).toEqual(initialRatingState());
  const rematchPath = `/games/${id}/rematch`;
  expect((await post(restarted, black.who, rematchPath, { action: 'offer' })).json()).toEqual({ error: 'rated_rematch_unavailable' });
  const { app: enabled } = server(true, time);
  expect((await post(enabled, black.who, rematchPath, { action: 'offer' })).json()).toEqual({ error: 'rated_rematch_unavailable' });
  expect((await post(enabled, reconnected, rematchPath, { action: 'accept', offerId: randomUUID() })).json())
    .toEqual({ error: 'rated_rematch_unavailable' });
  expect((await get(enabled, black.who, rematchPath)).json()).toEqual({ offer: null });

  const casual = await create(restarted, reconnected, { timeControl: terms.timeControl, rated: false });
  expect((await accept(restarted, black.who, casual)).statusCode).toBe(200);
  expect((await post(restarted, black.who, `/games/${casual}/resign`, { expectedVersion: 0 })).json())
    .toMatchObject({ game: { rated: false, status: 'finished' } });
  await assertNoSettlement(casual);
  expect(await loadOrCreateAccountRating(pool, white.id, 'rapid')).toEqual(whiteRating);
  expect(await loadOrCreateAccountRating(pool, black.id, 'rapid')).toEqual(blackRating);
});

it('preserves guest Casual play and aborts a Rated game at the first-move deadline without ratings', async () => {
  const { app, time, service } = server(true);
  const g1 = await browser(app), g2 = await browser(app);
  const casual = await create(app, g1, { timeControl: '5+3' });
  expect((await accept(app, g2, casual)).json()).toMatchObject({ game: { rated: false } });
  expect((await get(app, g1, `/games/${casual}`)).json()).not.toHaveProperty('playerRatings');
  expect((await post(app, g1, `/games/${casual}/resign`, { expectedVersion: 0 })).json())
    .toMatchObject({ game: { rated: false, status: 'finished' } });
  await assertNoSettlement(casual);
  const white = await register(app), black = await register(app);
  const id = await create(app, white.who);
  expect((await accept(app, black.who, id)).statusCode).toBe(200);
  const read = () => get(app, white.who, `/games/${id}`);
  expect((await read()).json().clocks.firstMoveDeadlineMs.white).toBe(time.value + 30_000);
  time.value += 30_000;
  await service.heartbeat();
  expect((await read()).json()).toMatchObject({ rated: true, status: 'aborted',
    result: { outcome: 'aborted', missedSide: 'white', reason: 'first_move_deadline' } });
  expect((await read()).json()).not.toHaveProperty('playerRatings');
  await assertNoSettlement(id);
  expect((await pool.query('SELECT 1 FROM chess.account_ratings WHERE account_id IN ($1, $2)', [white.id, black.id])).rows)
    .toEqual([]);
});

it('reads private effective ratings without initializing rows or mixing accounts', async () => {
  const { app } = server();
  const white = await register(app), black = await register(app);
  const guest = await browser(app);
  expect((await get(app, guest, '/account/ratings')).statusCode).toBe(401);
  expect((await get(app, white.who, `/account/ratings?accountId=${black.id}`)).statusCode).toBe(400);
  const read = () => get(app, white.who, '/account/ratings');
  const first = await read();
  expect(first.headers['cache-control']).toBe('no-store');
  const initial = { rating: 1500, rd: 350, provisional: true, ratedGames: 0, lastRatedAt: null };
  expect(first.json()).toEqual({ accountId: white.id, ratings: {
    bullet: initial, blitz: initial, rapid: initial, classical: initial,
  } });
  expect((await pool.query('SELECT 1 FROM chess.account_ratings WHERE account_id = $1', [white.id])).rowCount).toBe(0);
  const last = new Date(Date.now() - 30 * 86_400_000);
  await pool.query(`INSERT INTO chess.account_ratings (account_id, pool, rating, rd, volatility, rated_games, last_rated_at)
    VALUES ($1, 'blitz', 1678.12, 109, 0.06, 30, $2)`, [white.id, last]);
  const blitz = (await read()).json().ratings.blitz;
  expect(blitz).toMatchObject({ rating: 1678.12, provisional: true, ratedGames: 30, lastRatedAt: last.toISOString() });
  expect(blitz.rd).toBeGreaterThan(110);
  expect((await get(app, black.who, '/account/ratings')).json().ratings.blitz).toEqual(initial);
  expect((await pool.query('SELECT rd FROM chess.account_ratings WHERE account_id = $1', [white.id])).rows)
    .toEqual([{ rd: 109 }]);
});

it('keeps replay and favorites tied to saved Rated accounts and their historical settlement', async () => {
  const { app } = server(true);
  const white = await register(app), black = await register(app), unrelated = await register(app);
  async function start() {
    const id = await create(app, white.who);
    expect((await accept(app, black.who, id)).statusCode).toBe(200);
    return id;
  }
  async function finish(id: string) {
    for (const [index, move] of foolsMate.entries())
      await play(app, id, index % 2 ? black.who : white.who, index, move.from, move.to);
  }
  const first = await start();
  const read = async (id: string) => (await get(app, white.who, `/games/${id}`)).json();
  const initial = { rating: 1500, provisional: true };
  expect((await read(first)).playerRatings).toEqual({ source: 'current', pool: 'rapid', players: { white: initial, black: initial } });
  await finish(first);
  const saved = (await read(first)).playerRatings;
  expect(saved).toMatchObject({ source: 'settlement', pool: 'rapid', players: {
    white: { before: initial, after: { rating: expect.any(Number), provisional: true }, change: expect.any(Number) },
    black: { before: initial, after: { rating: expect.any(Number), provisional: true }, change: expect.any(Number) },
  } });
  expect(saved.players.white.change).toBe(saved.players.white.after.rating - 1500);
  expect(saved.players.black.change).toBe(saved.players.black.after.rating - 1500);
  const second = await start();
  expect((await read(second)).playerRatings.players.white).toEqual(saved.players.white.after);
  await finish(second);
  const { ratings } = (await get(app, white.who, '/account/ratings')).json();
  expect(ratings.rapid.ratedGames).toBe(2);
  expect(ratings.rapid.rating).not.toBe(saved.players.white.after.rating);
  expect(ratings.blitz).toMatchObject({ rating: 1500, ratedGames: 0 });

  const { rows: [seat] } = await pool.query('SELECT creator_guest_id FROM chess.challenges WHERE id = $1', [first]);
  await pool.query('UPDATE chess.guest_sessions SET account_id = $2 WHERE id = $1', [seat.creator_guest_id, unrelated.id]);
  try {
    expect(await read(first)).toMatchObject({ playerNames: { white: white.username }, playerRatings: saved });
    expect((await get(app, unrelated.who, `/games/${first}`)).statusCode).toBe(403);
    const favorite = await app.inject({ method: 'PUT', url: `/account/games/${first}/favorite`, headers: {
      cookie: cookie(white.who), 'x-csrf-token': white.who.csrf,
    } });
    expect(favorite.statusCode).toBe(200);
    expect((await get(app, white.who, '/account/games?filter=favorites')).json().games)
      .toEqual([expect.objectContaining({ id: first, rated: true, favorite: true, playerRatings: saved, opponent: black.username })]);
    expect((await get(app, white.who, '/account/games')).json().games.map((entry: { id: string }) => entry.id).sort())
      .toEqual([first, second].sort());
    expect((await get(app, unrelated.who, '/account/games')).json().games).toEqual([]);
  } finally {
    await pool.query('UPDATE chess.guest_sessions SET account_id = $2 WHERE id = $1', [seat.creator_guest_id, white.id]);
  }
});

it('recovers a ply-zero resignation after restart, publishes the final version and settles once', async () => {
  const { app, time } = server(true);
  const white = await register(app), black = await register(app);
  const id = await create(app, white.who);
  expect((await accept(app, black.who, id)).statusCode).toBe(200);
  await useLegacyAdjudication(id);
  try {
    const key = randomUUID();
    const command = { expectedVersion: 0 };
    const pending = await post(app, white.who, `/games/${id}/resign`, command, key);
    expect(pending.json())
      .toMatchObject({ game: { rated: true, status: 'pending_adjudication', result: null,
        pending: { kind: 'resignation', resigningSide: 'white' }, clocks: { phase: 'stopped' } } });
    expect((await get(app, white.who, `/games/${id}`)).json()).toMatchObject({ status: 'pending_adjudication' });
    expect(await readCase(id)).toMatchObject({ status: 'queued', pending_version: 1, attempts: 0 });
    await assertNoSettlement(id);
    const forbidden = await post(app, black.who, `/games/${id}/adjudication`, { verdict: 'mate_impossible' });
    expect(forbidden.statusCode).toBe(404);

    await app.close();
    const restarted = server(false, time);
    expect((await get(restarted.app, black.who, `/games/${id}`)).json()).toMatchObject({ version: 1, status: 'pending_adjudication' });
    const listener = await pool.connect();
    try {
      await listener.query('LISTEN chess_game_updates');
      const updates: { id: string; version: number }[] = [];
      listener.on('notification', message => { if (message.payload) updates.push(JSON.parse(message.payload)); });
      await createRatedAdjudicationProcessor(pool, restarted.service).poll();
      await listener.query('SELECT 1');
      expect(updates).toContainEqual({ id, version: 2 });
    } finally { listener.release(true); }
    expect((await get(restarted.app, black.who, `/games/${id}`)).json()).toMatchObject({
      status: 'finished', version: 2, result: { outcome: 'win', winner: 'black', reason: 'resignation' }, history: [],
    });
    expect(await readCase(id)).toMatchObject({ status: 'resolved', decided_by: 'automatic',
      mate_line: foolsMate, policy_version: 'rated-mate-witness-v1', nodes_visited: 4 });
    expect((await post(restarted.app, white.who, `/games/${id}/resign`, command, key)).json()).toEqual(pending.json());
    expect(await restarted.service.finalizeAdjudication(id, foolsMate, { reviewer: 'second-attempt' })).toBe(false);
    expect((await loadOrCreateAccountRating(pool, white.id, 'rapid')).ratedGames).toBe(1);
    expect((await loadOrCreateAccountRating(pool, black.id, 'rapid')).ratedGames).toBe(1);
    expect((await pool.query('SELECT final_result FROM chess.game_rating_settlements WHERE game_id = $1', [id])).rows)
      .toEqual([{ final_result: { outcome: 'win', winner: 'black', reason: 'resignation' } }]);

    await pool.query('UPDATE chess.rated_adjudications SET mate_line = $2 WHERE game_id = $1',
      [id, JSON.stringify([{ from: 'e2', to: 'e4' }])]);
    try { expect((await get(restarted.app, black.who, `/games/${id}`)).statusCode).toBe(500); }
    finally {
      await pool.query('UPDATE chess.rated_adjudications SET mate_line = $2 WHERE game_id = $1', [id, JSON.stringify(foolsMate)]);
    }
  } finally {
    await deletePendingProbe(id);
  }
});

it.each([0, quietOpening.length])('settles a Rated resignation at ply %i without adjudication', async ply => {
  const { app, service, time } = server(true);
  const white = await register(app), black = await register(app);
  const id = await create(app, white.who);
  expect((await accept(app, black.who, id)).statusCode).toBe(200);
  try {
    for (const [index, [from, to]] of quietOpening.slice(0, ply).entries()) {
      await play(app, id, index % 2 ? black.who : white.who, index, from, to);
    }
    const before = (await get(app, white.who, `/games/${id}`)).json();
    const deadline = (ply === 0 ? before.clocks.firstMoveDeadlineMs.white : before.clocks.deadlineMs) as number;
    time.value = deadline - 1;
    const command = { expectedVersion: ply }, key = randomUUID();
    const reply = await post(app, white.who, `/games/${id}/resign`, command, key);
    const result = { outcome: 'win', winner: 'black', reason: 'resignation' };
    expect(reply.statusCode).toBe(200);
    expect(reply.json()).toMatchObject({ game: { status: 'finished', result,
      clocks: { phase: 'stopped', activeSide: null, deadlineMs: null, flaggedSide: null } } });
    expect(reply.json().game).not.toHaveProperty('pending');
    expect(await readCase(id)).toBeUndefined();
    time.value = deadline + 500;
    await service.heartbeat();
    const opponent = (await get(app, black.who, `/games/${id}`)).json();
    expect(opponent).toMatchObject({ version: ply + 1, status: 'finished', result, history: before.history,
      playerRatings: { source: 'settlement', pool: 'rapid' } });
    expect(opponent.playerRatings.players.white.change).toBeLessThan(0);
    expect(opponent.playerRatings.players.black.change).toBeGreaterThan(0);
    await app.close();
    const restarted = server(false, time);
    expect((await get(restarted.app, white.who, `/games/${id}`)).json()).toMatchObject({
      version: ply + 1, status: 'finished', result, playerRatings: opponent.playerRatings,
    });
    expect((await post(restarted.app, white.who, `/games/${id}/resign`, command, key)).json()).toEqual(reply.json());
    expect((await pool.query('SELECT pool, final_result FROM chess.game_rating_settlements WHERE game_id = $1', [id])).rows)
      .toEqual([{ pool: 'rapid', final_result: result }]);
    for (const account of [white, black]) {
      const ratings = (await get(restarted.app, account.who, '/account/ratings')).json().ratings;
      expect(ratings.rapid.ratedGames).toBe(1);
      expect(ratings.blitz.ratedGames).toBe(0);
    }
  } finally { await deletePendingProbe(id); }
});

it('settles a Rated flag from the saved deadline without waiting for a mating witness', async () => {
  const { app, time, service } = server(true);
  const white = await register(app), black = await register(app);
  const id = await create(app, white.who);
  expect((await accept(app, black.who, id)).statusCode).toBe(200);
  try {
    for (const [index, [from, to]] of quietOpening.entries()) {
      await play(app, id, index % 2 ? black.who : white.who, index, from, to);
    }
    const before = (await get(app, white.who, `/games/${id}`)).json();
    const deadlineMs = before.clocks.deadlineMs as number;
    time.value = deadlineMs;
    await Promise.all([service.heartbeat(), service.heartbeat()]);
    const result = { outcome: 'win', winner: 'black', reason: 'timeout', flaggedSide: 'white', deadlineMs };
    const final = (await get(app, white.who, `/games/${id}`)).json();
    expect(final).toMatchObject({ status: 'finished', version: quietOpening.length + 1,
      result, history: before.history, clocks: { phase: 'flagged', activeSide: null, flaggedAtMs: deadlineMs },
      playerRatings: { source: 'settlement', pool: 'rapid' } });
    expect(final).not.toHaveProperty('pending');
    expect(await readCase(id)).toBeUndefined();
    expect((await pool.query('SELECT final_result FROM chess.game_rating_settlements WHERE game_id = $1', [id])).rows)
      .toEqual([{ final_result: result }]);
    for (const account of [white, black]) {
      expect((await loadOrCreateAccountRating(pool, account.id, 'rapid')).ratedGames).toBe(1);
    }
  } finally { await deletePendingProbe(id); }
});

it('recovers an expired timeout lease under concurrent pollers, preserving the flag and clock history', async () => {
  const { app, time, service } = server(true);
  const white = await register(app), black = await register(app);
  const id = await create(app, white.who);
  expect((await accept(app, black.who, id)).statusCode).toBe(200);
  await useLegacyAdjudication(id);
  try {
    await play(app, id, white.who, 0, 'f2', 'f3');
    await play(app, id, black.who, 1, 'e7', 'e5');
    const before = (await get(app, white.who, `/games/${id}`)).json();
    const deadline = before.clocks.deadlineMs as number;
    time.value = deadline + 10;
    await service.heartbeat();
    const paused = (await get(app, black.who, `/games/${id}`)).json();
    expect(paused).toMatchObject({ status: 'pending_adjudication', result: null, version: 3,
      pending: { kind: 'timeout', flaggedSide: 'white', deadlineMs: deadline }, clocks: { phase: 'flagged' } });
    await assertNoSettlement(id);
    expect(await service.recoverRatedResignation(id, 'test-operator')).toBe(false);
    const abandoned = await claimAdjudication(pool);
    expect(abandoned?.game_id).toBe(id);
    await app.close();
    await pool.query("UPDATE chess.rated_adjudications SET due_at = clock_timestamp() - interval '1 second' WHERE game_id = $1", [id]);
    const first = server(false, time), second = server(false, time);
    expect(await first.service.finalizeAdjudication(id, foolsMate.slice(2),
      { leaseToken: abandoned!.token, metrics: { nodesVisited: 2, searchMs: 1 } })).toBe(false);
    expect((await get(first.app, black.who, `/games/${id}`)).json()).toMatchObject({ pending: paused.pending });
    await Promise.all([createRatedAdjudicationProcessor(pool, first.service).poll(),
      createRatedAdjudicationProcessor(pool, second.service).poll()]);
    expect((await get(second.app, white.who, `/games/${id}`)).json()).toMatchObject({
      status: 'finished', version: 4, history: before.history,
      clocks: { phase: 'flagged', remainingMs: paused.clocks.remainingMs, flaggedAtMs: deadline },
      result: { outcome: 'win', winner: 'black', reason: 'timeout', flaggedSide: 'white', deadlineMs: deadline },
    });
    expect(await readCase(id)).toMatchObject({ attempts: 2, status: 'resolved', mate_line: foolsMate.slice(2) });
    expect((await loadOrCreateAccountRating(pool, white.id, 'rapid')).ratedGames).toBe(1);
    expect((await loadOrCreateAccountRating(pool, black.id, 'rapid')).ratedGames).toBe(1);
  } finally { await deletePendingProbe(id); }
});

it('holds exhausted searches for authorized review, rejects invalid evidence and records one winning review', async () => {
  const { app, service } = server(true);
  const white = await register(app), black = await register(app);
  const id = await create(app, white.who);
  expect((await accept(app, black.who, id)).statusCode).toBe(200);
  await useLegacyAdjudication(id);
  try {
    expect((await post(app, white.who, `/games/${id}/resign`, { expectedVersion: 0 })).statusCode).toBe(200);
    const processor = createRatedAdjudicationProcessor(pool, service, async () => ({
      result: { status: 'unresolved', reason: 'budget_exhausted', nodesVisited: 5000 }, searchMs: 120,
    }));
    await processor.poll();
    await processor.poll();
    expect(await readCase(id)).toMatchObject({ status: 'review', diagnostic: 'budget_exhausted',
      nodes_visited: 5000, attempts: 1, due_at: null });
    expect((await get(app, black.who, `/games/${id}`)).json()).toMatchObject({ status: 'pending_adjudication', result: null });
    await assertNoSettlement(id);
    await expect(service.finalizeAdjudication(id, [{ from: 'e2', to: 'e4' }], { reviewer: 'test-operator' }))
      .rejects.toThrow('Mating witness is invalid');

    const cli = fileURLToPath(new URL('../src/adjudication-cli.ts', import.meta.url));
    const witness = fileURLToPath(new URL('fixtures/fools-mate.json', import.meta.url));
    const run = promisify(execFile);
    const env = { ...process.env, DATABASE_URL: testDatabase };
    await expect(run(process.execPath, ['--import', 'tsx', cli, 'list'],
      { env: { ...env, ADJUDICATION_REVIEWERS: '' } })).rejects.toMatchObject({ stderr: expect.stringContaining('not authorized') });
    const review = { env: { ...env, ADJUDICATION_REVIEWERS: userInfo().username } };
    expect(JSON.parse((await run(process.execPath, ['--import', 'tsx', cli, 'list'], review)).stdout))
      .toEqual([expect.objectContaining({ game_id: id, status: 'review' })]);
    const concurrent = await Promise.allSettled([1, 2].map(() =>
      run(process.execPath, ['--import', 'tsx', cli, 'resolve', id, witness], review)));
    expect(concurrent.map(result => result.status).sort()).toEqual(['fulfilled', 'rejected']);
    expect(await readCase(id)).toMatchObject({ status: 'resolved', decided_by: `operator:${userInfo().username}`,
      mate_line: foolsMate, decided_at: expect.any(Date) });
    expect((await get(app, black.who, `/games/${id}`)).json()).toMatchObject({ status: 'finished', version: 2 });
    expect((await loadOrCreateAccountRating(pool, black.id, 'rapid')).ratedGames).toBe(1);
  } finally { await deletePendingProbe(id); }
});

it('recovers a legacy resignation through the authorized CLI once, preserving its original event', async () => {
  const { app, time } = server(true);
  const white = await register(app), black = await register(app);
  const id = await create(app, white.who);
  expect((await accept(app, black.who, id)).statusCode).toBe(200);
  await useLegacyAdjudication(id);
  try {
    for (const [index, [from, to]] of quietOpening.entries()) {
      await play(app, id, index % 2 ? black.who : white.who, index, from, to);
    }
    const key = randomUUID(), command = { expectedVersion: quietOpening.length };
    const reply = await post(app, white.who, `/games/${id}/resign`, command, key);
    expect(reply.json()).toMatchObject({ game: { status: 'pending_adjudication', result: null } });
    const before = (await get(app, black.who, `/games/${id}`)).json();
    await assertNoSettlement(id);
    const lease = await claimAdjudication(pool);
    expect(lease?.game_id).toBe(id);
    const cli = fileURLToPath(new URL('../src/adjudication-cli.ts', import.meta.url));
    const run = (reviewer: string) => promisify(execFile)(process.execPath, ['--import', 'tsx', cli, 'concede', id], {
      env: { ...process.env, DATABASE_URL: testDatabase, ADJUDICATION_REVIEWERS: reviewer },
    });
    await expect(run('')).rejects.toMatchObject({ stderr: expect.stringContaining('not authorized') });
    const reviewer = userInfo().username;
    const decisions = await Promise.all([run(reviewer), run(reviewer)]);
    expect(decisions.map(decision => decision.stdout.trim()).sort()).toEqual([
      'No pending Rated resignation was changed.', 'Resignation recorded as a concession.',
    ]);
    expect(await readCase(id)).toMatchObject({ status: 'resolved', pending_version: before.version, lease_token: null,
      decided_by: `operator:${reviewer}`, policy_version: 'rated-resignation-concession-v1', mate_line: [] });
    await app.close();
    const restarted = server(false, time);
    expect(await restarted.service.finalizeAdjudication(id, foolsMate,
      { leaseToken: lease!.token, metrics: { searchMs: 1, nodesVisited: 2 } })).toBe(false);
    const final = (await get(restarted.app, black.who, `/games/${id}`)).json();
    expect(final).toMatchObject({ status: 'finished', version: before.version + 1, history: before.history,
      clocks: { phase: 'stopped', remainingMs: before.clocks.remainingMs },
      result: { outcome: 'win', winner: 'black', reason: 'resignation' },
      playerRatings: { source: 'settlement', pool: 'rapid' } });
    expect((await post(restarted.app, white.who, `/games/${id}/resign`, command, key)).json()).toEqual(reply.json());
    expect((await pool.query('SELECT kind, side, version FROM chess.game_actions WHERE game_id = $1', [id])).rows)
      .toEqual([{ kind: 'resign', side: 'white', version: before.version }]);
    expect((await pool.query('SELECT final_result FROM chess.game_rating_settlements WHERE game_id = $1', [id])).rows)
      .toEqual([{ final_result: final.result }]);
    for (const account of [white, black]) {
      expect((await loadOrCreateAccountRating(pool, account.id, 'rapid')).ratedGames).toBe(1);
    }
  } finally { await deletePendingProbe(id); }
});

it('rolls back a final ruling when rating history fails and recovers after the retry delay', async () => {
  const { app, service } = server(true);
  const white = await register(app), black = await register(app);
  const id = await create(app, white.who);
  expect((await accept(app, black.who, id)).statusCode).toBe(200);
  await useLegacyAdjudication(id);
  try {
    expect((await post(app, white.who, `/games/${id}/resign`, { expectedVersion: 0 })).statusCode).toBe(200);
    const processor = createRatedAdjudicationProcessor(pool, service);
    await pool.query(`ALTER TABLE chess.game_rating_settlements ADD CONSTRAINT adjudication_failure_probe
      CHECK (game_id <> '${id}') NOT VALID`);
    try {
      await expect(processor.poll()).rejects.toThrow('Rated adjudication failed');
      await processor.poll();
      expect(await readCase(id)).toMatchObject({ status: 'retry', attempts: 1, mate_line: null,
        diagnostic: 'processing_failed' });
      expect((await get(app, black.who, `/games/${id}`)).json()).toMatchObject({ status: 'pending_adjudication', version: 1 });
      await assertNoSettlement(id);
      expect((await pool.query('SELECT 1 FROM chess.account_ratings WHERE account_id IN ($1, $2)', [white.id, black.id])).rowCount)
        .toBe(0);
    } finally {
      await pool.query('ALTER TABLE chess.game_rating_settlements DROP CONSTRAINT adjudication_failure_probe');
    }
    await pool.query("UPDATE chess.rated_adjudications SET due_at = clock_timestamp() WHERE game_id = $1", [id]);
    await processor.poll();
    expect(await readCase(id)).toMatchObject({ status: 'resolved', attempts: 2 });
    expect((await get(app, black.who, `/games/${id}`)).json()).toMatchObject({ status: 'finished', version: 2 });
  } finally { await deletePendingProbe(id); }
});

it.each(['resignation', 'timeout'] as const)('settles a Rated %s draw immediately when the opponent cannot mate', async kind => {
  const { app, time, service } = server(true);
  const white = await register(app), black = await register(app);
  const id = await create(app, white.who);
  expect((await accept(app, black.who, id)).statusCode).toBe(200);
  const fen = '4k3/8/8/8/8/8/8/R3K3 w - - 0 1';
  await pool.query('UPDATE chess.games SET starting_fen = $2, fen = $2 WHERE id = $1', [id, fen]);
  if (kind === 'resignation') {
    expect((await post(app, white.who, `/games/${id}/resign`, { expectedVersion: 0 })).statusCode).toBe(200);
  } else {
    await pool.query(`UPDATE chess.games SET ready_white = true, ready_black = true, version = 2,
      clock_start_mode = 'readiness', clock_phase = 'running', white_first_move_deadline_at = NULL,
      turn_started_at = $2, deadline_at = $3 WHERE id = $1`, [id, new Date(time.value), new Date(time.value + 600_000)]);
    time.value += 600_000;
    await service.heartbeat();
  }
  const final = (await get(app, white.who, `/games/${id}`)).json();
  expect(final).toMatchObject({ status: 'finished', result: { outcome: 'draw', reason: `${kind}_no_mating_possibility` } });
  expect(await readCase(id)).toBeUndefined();
  expect((await pool.query('SELECT final_result FROM chess.game_rating_settlements WHERE game_id = $1', [id])).rows)
    .toEqual([{ final_result: final.result }]);
  expect(await loadOrCreateAccountRating(pool, white.id, 'rapid')).toMatchObject({ rating: 1500, ratedGames: 1 });
  expect(await loadOrCreateAccountRating(pool, black.id, 'rapid')).toMatchObject({ rating: 1500, ratedGames: 1 });
});

it('retains both authoritative clock balances after 1. d4 d5 2. c4 c6 3. Nc3 flags Black in Bullet', async () => {
  const { app, service, time } = server(true);
  const white = await register(app), black = await register(app);
  const id = await create(app, white.who, { timeControl: '1+0', rated: true });
  expect((await accept(app, black.who, id)).statusCode).toBe(200);
  const start = time.value;
  const moves = [['d2', 'd4', 0], ['d7', 'd5', 4_000], ['c2', 'c4', 7_000],
    ['c7', 'c6', 10_000], ['b1', 'c3', 16_000]] as const;
  for (const [index, [from, to, offset]] of moves.entries()) {
    time.value = start + offset;
    await play(app, id, index % 2 ? black.who : white.who, index, from, to);
  }
  const before = (await get(app, white.who, `/games/${id}`)).json();
  expect(before.clocks.remainingMs).toEqual({ white: 51_000, black: 53_000 });
  time.value = before.clocks.deadlineMs;
  await service.pollDueGames();
  const finalized = (await get(app, white.who, `/games/${id}`)).json();
  expect(finalized).toMatchObject({ status: 'finished', history: before.history,
    result: { winner: 'white', reason: 'timeout' }, playerRatings: { source: 'settlement', pool: 'bullet' },
    clocks: { phase: 'flagged', activeSide: null, flaggedSide: 'black', remainingMs: { white: 51_000, black: 0 } } });
  await app.close();
  const restarted = server(false, time);
  expect((await get(restarted.app, black.who, `/games/${id}`)).json()).toMatchObject({
    status: 'finished', result: finalized.result, clocks: finalized.clocks,
  });
});

async function presenceGame(control = '10+2', rated = true, played = true) {
  const { app, service, time } = server(true, clock(), true);
  const white = await register(app), black = await register(app);
  const id = await create(app, white.who, { timeControl: control, rated });
  expect((await accept(app, black.who, id)).statusCode).toBe(200);
  const path = `/games/${id}`;
  const start = time.value;
  const ping = (who: Browser, instance = app) => post(instance, who, path + '/presence');
  const read = async (who: Browser = white.who, instance = app) => (await get(instance, who, path)).json();
  if (rated) {
    expect((await ping(white.who)).statusCode).toBe(204);
    expect((await ping(black.who)).statusCode).toBe(204);
  }
  if (played) {
    await play(app, id, white.who, 0, 'e2', 'e4');
    await play(app, id, black.who, 1, 'e7', 'e5');
  }
  const at = async (offset: number, who = white.who, instance = app) => {
    time.value = start + offset;
    expect((await ping(who, instance)).statusCode).toBe(204);
  };
  const through = async (offset: number, who = white.who, instance = app) => {
    // Send samples at most 10 seconds apart without waiting in real time.
    for (let next = time.value - start + 10_000; next < offset; next += 10_000) await at(next, who, instance);
    await at(offset, who, instance);
  };
  return { app, service, time, white, black, id, path, start, ping, read, at, through };
}

it('authenticates heartbeat requests against the frozen seat and leaves Casual games untouched', async () => {
  const game = await presenceGame();
  const outsider = await register(game.app);
  const guest = await browser(game.app);
  expect((await game.ping(outsider.who)).statusCode).toBe(403);
  expect((await game.ping(guest)).statusCode).toBe(401);
  const noCsrf = await game.app.inject({ method: 'POST', url: game.path + '/presence',
    headers: { cookie: cookie(game.white.who) } });
  expect(noCsrf.json()).toEqual({ error: 'invalid_csrf_token' });
  expect((await post(game.app, game.white.who, game.path + '/presence', {
    accountId: game.black.id, receivedAtMs: 123,
  })).statusCode).toBe(400);
  await pool.query("UPDATE chess.account_sessions SET expires_at = now() - interval '1 second' WHERE account_id = $1", [game.black.id]);
  expect((await game.ping(game.black.who)).statusCode).toBe(401);
  const casual = await presenceGame('10+2', false);
  expect((await casual.ping(casual.white.who)).statusCode).toBe(403);
  expect(await casual.read()).not.toHaveProperty('disconnect');
  expect((await pool.query('SELECT 1 FROM chess.rated_game_presence WHERE game_id = $1', [casual.id])).rowCount).toBe(0);
});

it('observes continued streams despite quiet client timers and cancels grace across two sessions without changing the game', async () => {
  const game = await presenceGame();
  await game.at(20_000);
  await game.at(27_000, game.black.who);
  await game.through(90_000);
  expect((await game.read()).disconnect.opponentDeadlineMs).toBeNull();
  await game.service.recordPresence(game.id, game.black.id, 'activity', game.time.value);
  await game.through(160_000);
  expect((await game.read()).disconnect.opponentDeadlineMs).toBeNull();
  await game.through(165_000);
  const before = await game.read();
  const deadline = game.start + 165_000 + disconnectTiming.graceMs.rapid;
  expect(before.disconnect.opponentDeadlineMs).toBe(deadline);
  expect(before.clocks).toMatchObject({ activeSide: 'white', remainingMs: { white: 435_000, black: 602_000 } });
  const reconnected = await browser(game.app);
  await auth(game.app, reconnected, 'login', game.black.username);
  await game.through(deadline - game.start - 1);
  await game.at(deadline - game.start - 1, reconnected);
  const restored = await game.read();
  expect(restored).toMatchObject({ status: 'active', version: before.version, position: before.position,
    history: before.history, drawOffer: before.drawOffer, disconnect: { opponentDeadlineMs: null },
    clocks: { deadlineMs: before.clocks.deadlineMs, activeSide: 'white' } });
  await game.at(deadline - game.start + 1);
  await game.service.pollDueGames();
  await assertNoSettlement(game.id);
});

it.each([
  { control: '1+0', poolName: 'bullet', graceMs: 30_000, moveAt: 55_000, whiteMs: 5_000, blackMs: 10_000 },
  { control: '3+0', poolName: 'blitz', graceMs: 45_000, moveAt: 75_000, whiteMs: 105_000, blackMs: 135_000 },
  { control: '10+2', poolName: 'rapid', graceMs: 60_000, moveAt: 75_000, whiteMs: 527_000, blackMs: 542_000 },
  { control: '20+0', poolName: 'classical', graceMs: 90_000, moveAt: 75_000, whiteMs: 1_125_000, blackMs: 1_110_000 },
] as const)('settles a $poolName disconnect once and lets the opponent move while the game remains active', async test => {
  const game = await presenceGame(test.control);
  await game.through(test.moveAt);
  await play(game.app, game.id, game.white.who, 2, 'g1', 'f3');
  await game.through(75_000);
  const deadline = game.start + 75_000 + test.graceMs;
  expect((await game.read()).disconnect.opponentDeadlineMs).toBe(deadline);
  const before = await game.read();
  expect(before.clocks.activeSide).toBe('black');
  await game.through(deadline - game.start - 1);
  expect((await game.read()).status).toBe('active');
  await assertNoSettlement(game.id);
  await game.at(deadline - game.start);
  const other = server(false, game.time, true);
  await other.app.ready();
  await Promise.all([game.service.pollDueGames(), other.service.pollDueGames()]);
  const final = await game.read(game.black.who, other.app);
  const result = { outcome: 'win', winner: 'white', reason: 'disconnect_forfeit', disconnectedSide: 'black', deadlineMs: deadline };
  expect(final).toMatchObject({ status: 'finished', result, history: before.history, version: before.version + 1,
    clocks: { phase: 'stopped', activeSide: null, flaggedSide: null, remainingMs: { white: test.whiteMs, black: test.blackMs } } });
  expect(final).not.toHaveProperty('disconnect');
  await game.at(deadline - game.start + 1, game.black.who, other.app);
  await other.service.pollDueGames();
  expect((await game.read()).result).toEqual(result);
  expect((await pool.query('SELECT pool, final_result FROM chess.game_rating_settlements WHERE game_id = $1', [game.id])).rows)
    .toEqual([{ pool: test.poolName, final_result: result }]);
  for (const player of [game.white, game.black]) {
    expect((await loadOrCreateAccountRating(pool, player.id, test.poolName)).ratedGames).toBe(1);
  }
});

it('requires fresh activity after both players go offline during grace and after an API restart', async () => {
  const game = await presenceGame();
  await game.through(75_000);
  expect((await game.read()).disconnect.opponentDeadlineMs).toBe(game.start + 135_000);
  await game.app.close();
  game.time.value = game.start + 140_000;
  const restarted = server(false, game.time, true);
  await restarted.app.ready();
  await restarted.service.pollDueGames();
  expect(await game.read(game.white.who, restarted.app)).toMatchObject({ status: 'active', version: 2,
    disconnect: { opponentDeadlineMs: null }, clocks: { activeSide: 'white', deadlineMs: game.start + 600_000 } });
  await game.at(140_000, game.white.who, restarted.app);
  expect((await game.read(game.white.who, restarted.app)).disconnect.opponentDeadlineMs).toBeNull();
  await game.at(150_000, game.white.who, restarted.app);
  expect((await game.read(game.white.who, restarted.app)).disconnect.opponentDeadlineMs).toBe(game.start + 210_000);
  await game.at(150_001, game.black.who, restarted.app);
  expect((await game.read(game.white.who, restarted.app)).disconnect.opponentDeadlineMs).toBeNull();
  await assertNoSettlement(game.id);
});

it('preserves the first-move abort and gives an earlier chess timeout priority over forfeiture', async () => {
  const unstarted = await presenceGame('1+0', true, false);
  unstarted.time.value += 90_000;
  await unstarted.service.pollDueGames();
  expect(await unstarted.read()).toMatchObject({ status: 'aborted', result: { reason: 'first_move_deadline' } });
  await assertNoSettlement(unstarted.id);
  await unstarted.app.close();

  const game = await presenceGame('3+0');
  await game.through(75_000);
  // Leave White just 1 ms short of the disconnect confirmation when its clock flags.
  await pool.query(`UPDATE chess.games SET white_remaining_ms = 119999,
    deadline_at = turn_started_at + interval '119.999 seconds' WHERE id = $1`, [game.id]);
  await game.through(120_000);
  await game.service.pollDueGames();
  expect(await game.read()).toMatchObject({ status: 'finished',
    result: { reason: 'timeout', winner: 'black', flaggedSide: 'white', deadlineMs: game.start + 119_999 } });
});


it('rolls back a disconnect result with its rating changes and safely retries the confirmed deadline', async () => {
  const game = await presenceGame();
  await game.through(75_000);
  await game.through(135_000);
  await pool.query(`ALTER TABLE chess.game_rating_settlements ADD CONSTRAINT disconnect_failure_probe
    CHECK (game_id <> '${game.id}') NOT VALID`);
  try {
    await expect(game.service.pollDueGames()).rejects.toMatchObject({ code: '23514', constraint: 'disconnect_failure_probe' });
    expect((await pool.query('SELECT status, version, result FROM chess.games WHERE id = $1', [game.id])).rows)
      .toEqual([{ status: 'active', version: 2, result: null }]);
    await assertNoSettlement(game.id);
    expect((await pool.query('SELECT 1 FROM chess.account_ratings WHERE account_id IN ($1, $2)',
      [game.white.id, game.black.id])).rowCount).toBe(0);
    expect((await pool.query('SELECT confirmed_at FROM chess.rated_game_presence WHERE game_id = $1', [game.id])).rows)
      .toEqual([{ confirmed_at: new Date(game.start + 135_000) }]);
  } finally {
    await pool.query('ALTER TABLE chess.game_rating_settlements DROP CONSTRAINT disconnect_failure_probe');
  }
  await game.service.pollDueGames();
  expect(await game.read()).toMatchObject({ status: 'finished', version: 3,
    result: { reason: 'disconnect_forfeit' }, playerRatings: { source: 'settlement', pool: 'rapid' } });
  expect((await pool.query('SELECT 1 FROM chess.rated_game_presence WHERE game_id = $1', [game.id])).rowCount).toBe(0);
});

it('requires a fresh grace period after database failures interrupt presence writes', async () => {
  const game = await presenceGame();
  await game.through(75_000);
  await pool.query(`ALTER TABLE chess.rated_game_presence ADD CONSTRAINT presence_failure_probe
    CHECK (game_id <> '${game.id}') NOT VALID`);
  try {
    for (const offset of [90_000, 110_000, 135_000]) {
      game.time.value = game.start + offset;
      expect((await game.ping(game.white.who)).statusCode).toBe(500);
    }
  } finally {
    await pool.query('ALTER TABLE chess.rated_game_presence DROP CONSTRAINT presence_failure_probe');
  }
  await game.service.pollDueGames();
  expect(await game.read()).toMatchObject({ status: 'active', disconnect: { opponentDeadlineMs: null } });
  await game.at(136_000, game.black.who);
  await game.at(136_000);
  expect(await game.read()).toMatchObject({ status: 'active', disconnect: { opponentDeadlineMs: null } });
  await assertNoSettlement(game.id);
});

it('never creates presence or settles a disconnect while a strict legacy result is pending', async () => {
  const game = await presenceGame();
  await useLegacyAdjudication(game.id);
  try {
    const reply = await post(game.app, game.white.who, game.path + '/resign', { expectedVersion: 2 });
    expect(reply.json()).toMatchObject({ game: { status: 'pending_adjudication' } });
    await game.through(150_000);
    await game.service.pollDueGames();
    expect(await game.read()).toMatchObject({ status: 'pending_adjudication', result: null, clocks: { phase: 'stopped' } });
    expect((await pool.query('SELECT 1 FROM chess.rated_game_presence WHERE game_id = $1', [game.id])).rowCount).toBe(0);
    await assertNoSettlement(game.id);
  } finally {
    await deletePendingProbe(game.id);
  }
});


it.each(['reconnection', 'resignation'] as const)(
  'honors a %s received before confirmation even when it is admitted afterward', async command => {
    const game = await presenceGame();
    await game.through(75_000);
    await game.through(134_999);
    const arrival = game.service.beginReceipt();
    try {
      await game.at(135_000);
      expect(await game.service.pollDueGames()).toBe(0);
      await assertNoSettlement(game.id);
      if (command === 'reconnection') {
        expect((await game.service.recordPresence(game.id, game.black.id, 'heartbeat', arrival.receivedAtMs)).status).toBe(204);
      } else {
        const { rows: [seat] } = await pool.query('SELECT acceptor_guest_id FROM chess.challenges WHERE id = $1', [game.id]);
        const result = await game.service.action(game.id, seat.acceptor_guest_id, randomUUID(), 'resign',
          { expectedVersion: 2 }, arrival);
        expect(result).toMatchObject({ status: 200, body: { game: { status: 'finished',
          result: { reason: 'resignation', winner: 'white' } } } });
      }
    } finally {
      await arrival.release();
    }
    await game.service.pollDueGames();
    const final = await game.read();
    if (command === 'reconnection') {
      expect(final).toMatchObject({ status: 'active', version: 2, result: null,
        disconnect: { opponentDeadlineMs: null }, clocks: { deadlineMs: game.start + 600_000 } });
      await assertNoSettlement(game.id);
    } else {
      expect(final).toMatchObject({ status: 'finished', version: 3, result: { reason: 'resignation' } });
    }
  });
