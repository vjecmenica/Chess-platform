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

async function readCase(id: string) {
  return (await pool.query('SELECT * FROM chess.rated_adjudications WHERE game_id = $1', [id])).rows[0];
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

it('recovers a ply-zero resignation after restart, publishes the final version and settles once', async () => {
  const { app, time } = server(true);
  const white = await register(app), black = await register(app);
  const id = await create(app, white.who);
  expect((await accept(app, black.who, id)).statusCode).toBe(200);
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

it('resolves a resignation after opening moves and keeps an earlier receipt ahead of the flag', async () => {
  const { app, service, time } = server(true);
  const white = await register(app), black = await register(app);
  const id = await create(app, white.who);
  expect((await accept(app, black.who, id)).statusCode).toBe(200);
  try {
    await play(app, id, white.who, 0, 'e2', 'e4');
    await play(app, id, black.who, 1, 'e7', 'e5');
    await play(app, id, white.who, 2, 'f1', 'c4');
    const read = () => get(app, white.who, `/games/${id}`);
    const deadline = (await read()).json().clocks.deadlineMs as number;
    time.value = deadline - 1;
    expect((await post(app, black.who, `/games/${id}/resign`, { expectedVersion: 3 })).json()).toMatchObject({
      game: { status: 'pending_adjudication', pending: { kind: 'resignation' } },
    });
    time.value = deadline + 500;
    await service.heartbeat();
    const paused = (await read()).json();
    expect(paused).toMatchObject({ status: 'pending_adjudication', clocks: { phase: 'stopped', flaggedSide: null } });
    expect((await post(app, black.who, `/games/${id}/moves`, { expectedVersion: 4, from: 'b8', to: 'c6' })).json())
      .toEqual({ error: 'adjudication_pending' });
    await createRatedAdjudicationProcessor(pool, service).poll();
    expect((await read()).json()).toMatchObject({ version: 5, history: paused.history,
      result: { outcome: 'win', winner: 'white', reason: 'resignation' } });
  } finally { await deletePendingProbe(id); }
});

it('recovers an expired timeout lease under concurrent pollers, preserving the flag and clock history', async () => {
  const { app, time, service } = server(true);
  const white = await register(app), black = await register(app);
  const id = await create(app, white.who);
  expect((await accept(app, black.who, id)).statusCode).toBe(200);
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

it('rolls back a final ruling when rating history fails and recovers after the retry delay', async () => {
  const { app, service } = server(true);
  const white = await register(app), black = await register(app);
  const id = await create(app, white.who);
  expect((await accept(app, black.who, id)).statusCode).toBe(200);
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
