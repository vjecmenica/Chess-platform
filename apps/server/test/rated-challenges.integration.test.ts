import { randomInt, randomUUID } from 'node:crypto';
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

interface Browser { cookies: Map<string, string>; csrf: string; ip: string }
const password = 'a synthetic rated challenge password';
const subnet = `127.${randomInt(1, 255)}.${randomInt(1, 255)}`;
const clock = () => ({ value: 1_950_000_000_000, nowMs() { return this.value; } });
const apps: FastifyInstance[] = [];
const terms = { timeControl: '10+2', rated: true };
let browserCount = 0;
let pool: pg.Pool;

beforeAll(async () => {
  loadEnvironment();
  pool = createPool(databaseUrl(process.env.TEST_DATABASE_URL, 'TEST_DATABASE_URL'));
  await migrate(pool);
});
afterEach(async () => { for (const app of apps.splice(0)) await app.close(); });
afterAll(async () => { await pool?.end(); });

function server(ratedChallengesEnabled?: boolean, time = clock()) {
  const service = createGameService(pool, time);
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
  await assertNoSettlement(id);
  expect((await pool.query('SELECT 1 FROM chess.account_ratings WHERE account_id IN ($1, $2)', [white.id, black.id])).rows)
    .toEqual([]);
});

it('keeps an unproven Rated resignation pending rather than assigning a rating result or abort', async () => {
  const { app } = server(true);
  const white = await register(app), black = await register(app);
  const id = await create(app, white.who);
  expect((await accept(app, black.who, id)).statusCode).toBe(200);
  try {
    expect((await post(app, black.who, `/games/${id}/resign`, { expectedVersion: 0 })).json())
      .toMatchObject({ game: { rated: true, status: 'pending_adjudication', result: null,
        pending: { kind: 'resignation', resigningSide: 'black' }, clocks: { phase: 'stopped' } } });
    expect((await get(app, white.who, `/games/${id}`)).json()).toMatchObject({ status: 'pending_adjudication' });
    await assertNoSettlement(id);
  } finally {
    // Keep this fixture away from tests that replay historical Casual adjudication migrations.
    await pool.query('DELETE FROM chess.game_move_receipts WHERE game_id = $1', [id]);
    await pool.query('DELETE FROM chess.game_actions WHERE game_id = $1', [id]);
    await pool.query('DELETE FROM chess.games WHERE id = $1', [id]);
    await pool.query('DELETE FROM chess.challenges WHERE id = $1', [id]);
  }
});
