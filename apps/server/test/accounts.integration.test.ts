import { randomInt, randomUUID } from 'node:crypto';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import type pg from 'pg';
import { databaseUrl, loadEnvironment } from '../src/config.js';
import { createPool } from '../src/database.js';
import { migrate } from '../src/migrations.js';
import { buildApp } from '../src/app.js';

interface Browser { cookie: string; csrf: string; ip: string }
const password = 'A long synthetic test passphrase';
const username = () => `u_${randomUUID().replaceAll('-', '').slice(0, 20)}`;
describe('accounts and original guest seats against PostgreSQL', () => {
  let pool: pg.Pool;
  let browserNumber = 0;
  const subnet = `127.${randomInt(1, 255)}.${randomInt(1, 255)}`;
  const apps: FastifyInstance[] = [];
  beforeAll(async () => { loadEnvironment(); pool = createPool(databaseUrl(process.env.TEST_DATABASE_URL, 'TEST_DATABASE_URL')); await migrate(pool); });
  afterEach(async () => { for (const app of apps.splice(0)) await app.close(); });
  afterAll(async () => { await pool?.end(); });
  function server(secureCookies = false) {
    const app = buildApp(async () => {}, false, { pool, secureCookies }); apps.push(app); return app;
  }
  async function browser(app: FastifyInstance): Promise<Browser> {
    const response = await app.inject('/guest-session');
    return { cookie: response.cookies.map(c => `${c.name}=${c.value}`).join('; '), csrf: response.json().csrfToken,
      ip: `${subnet}.${++browserNumber}` };
  }
  function headers(who: Browser, id: string = randomUUID()) { return { cookie: who.cookie, 'x-csrf-token': who.csrf, 'idempotency-key': id }; }
  async function auth(app: FastifyInstance, who: Browser, path: string, payload?: object) {
    const response = await app.inject({ method: 'POST', url: `/account/${path}`, headers: headers(who),
      remoteAddress: who.ip, ...(payload ? { payload } : {}) });
    const jar = new Map(who.cookie.split('; ').map(c => c.split('=') as [string, string]));
    for (const c of response.cookies) c.value ? jar.set(c.name, c.value) : jar.delete(c.name);
    who.cookie = [...jar].map(([k, v]) => `${k}=${v}`).join('; ');
    if (response.statusCode === 200 && response.json().csrfToken) who.csrf = response.json().csrfToken;
    return response;
  }
  async function setup() {
    const app = server(); const white = await browser(app), black = await browser(app), outsider = await browser(app);
    const created = await app.inject({ method: 'POST', url: '/challenges', headers: headers(white) });
    const id = created.json().id as string;
    expect((await app.inject({ method: 'POST', url: `/challenges/${id}/accept`, headers: headers(black) })).statusCode).toBe(200);
    return { app, white, black, outsider, id };
  }
  const read = (app: FastifyInstance, who: Browser, path: string) => app.inject({ url: path, headers: headers(who) });
  const post = (app: FastifyInstance, who: Browser, path: string, payload?: object, id?: string) => app.inject({ method: 'POST', url: path,
    headers: headers(who, id), ...(payload ? { payload } : {}) });

  it('requires current credentials for renames and updates linked display names without changing archive ownership', async () => {
    const { app, white, black, outsider, id } = await setup();
    const original = username(), taken = username(), renamed = username();
    await auth(app, white, 'register', { username: original, password }); await auth(app, white, 'link-guest');
    await auth(app, outsider, 'register', { username: taken, password });
    const message = (await post(app, black, `/games/${id}/chat`, { text: 'History stays unchanged.' })).json();
    const hashBefore = (await pool.query('SELECT password_hash FROM chess.accounts WHERE username=$1', [original])).rows[0].password_hash;
    const details = (await read(app, white, '/account')).json();
    expect(details.guestLinked).toBe(true); expect(Date.parse(details.createdAt)).toBeGreaterThan(0);
    expect(JSON.stringify(details)).not.toContain('password_hash');
    expect((await auth(app, black, 'username', { username: renamed, currentPassword: password })).statusCode).toBe(401);
    expect((await app.inject({ method: 'POST', url: '/account/username', headers: { cookie: white.cookie },
      payload: { username: renamed, currentPassword: password } })).statusCode).toBe(403);
    expect((await auth(app, white, 'username', { username: renamed, currentPassword: 'wrong' })).json().error).toBe('incorrect_current_password');
    expect((await auth(app, white, 'username', { username: taken, currentPassword: password })).statusCode).toBe(409);
    expect((await auth(app, white, 'username', { username: 'x', currentPassword: password })).statusCode).toBe(400);
    const before = { ...white };
    expect((await auth(app, white, 'username', { username: renamed.toUpperCase(), currentPassword: password })).statusCode).toBe(200);
    expect((await read(app, before, '/account')).statusCode).toBe(401);
    expect((await read(app, white, '/account')).json().account.username).toBe(renamed);
    expect((await read(app, black, `/games/${id}`)).json().playerNames.white).toBe(renamed);
    expect((await read(app, white, `/games/${id}/chat`)).json().messages).toEqual([message]);
    expect((await read(app, white, '/account/games')).json().games[0].id).toBe(id);
    expect((await pool.query('SELECT password_hash FROM chess.accounts WHERE username=$1', [renamed])).rows[0].password_hash).toBe(hashBefore);
  });

  it('rate limits current-password attempts durably across server instances', async () => {
    const app = server(), who = await browser(app);
    await auth(app, who, 'register', { username: username(), password });
    for (let attempt = 0; attempt < 10; attempt++) expect((await auth(app, who, 'password', {
      currentPassword: 'wrong', newPassword: password, confirmPassword: password,
    })).statusCode).toBe(401);
    const limited = await auth(server(), who, 'username', { username: username(), currentPassword: password });
    expect(limited.statusCode).toBe(429); expect(limited.headers['retry-after']).toBe('900');
  });

  it('confirms and hashes new passwords, rotates the current session, and revokes other guest/account bearers', async () => {
    const { app, white, id } = await setup(); const name = username();
    await auth(app, white, 'register', { username: name, password }); await auth(app, white, 'link-guest');
    const elsewhere = await browser(app), third = await browser(app);
    for (const who of [elsewhere, third]) {
      await auth(app, who, 'login', { username: name, password }); await auth(app, who, 'link-guest');
    }
    const replacement = 'Another long synthetic passphrase';
    const body = { currentPassword: password, newPassword: replacement, confirmPassword: replacement };
    expect((await auth(app, white, 'password', { ...body, currentPassword: 'wrong' })).json().error).toBe('incorrect_current_password');
    expect((await auth(app, white, 'password', { ...body, confirmPassword: password })).json().error).toBe('password_confirmation_mismatch');
    expect((await auth(app, white, 'password', { ...body, newPassword: 'short', confirmPassword: 'short' })).statusCode).toBe(400);
    const before = { ...white };
    const changed = await auth(app, white, 'password', body); expect(changed.statusCode).toBe(200);
    expect(changed.body).not.toContain(replacement);
    const stored = (await pool.query('SELECT password_hash FROM chess.accounts WHERE username=$1', [name])).rows[0].password_hash;
    expect(stored).toMatch(/^\$argon2id\$/); expect(stored).not.toContain(replacement);
    for (const who of [before, elsewhere, third]) {
      expect((await read(app, who, '/account')).statusCode).toBe(401);
      expect((await read(app, who, `/games/${id}/chat`)).statusCode).toBe(401);
    }
    expect((await read(app, white, `/games/${id}`)).statusCode).toBe(200);
    const fresh = await browser(app);
    expect((await auth(app, fresh, 'login', { username: name, password })).statusCode).toBe(401);
    expect((await auth(app, fresh, 'login', { username: name, password: replacement })).statusCode).toBe(200);
    expect((await read(app, fresh, '/account/games')).json().games[0].id).toBe(id);
    expect((await read(app, fresh, `/games/${id}/chat`)).statusCode).toBe(200);
  });

  it('keeps the archive private and maps saved results, opponents, and totals for both original seats', async () => {
    const { app, white, black, outsider, id } = await setup();
    expect((await read(app, outsider, '/account/games')).statusCode).toBe(401);
    const whiteName = username(), blackName = username();
    await auth(app, white, 'register', { username: whiteName, password });
    expect((await read(app, white, '/account/games')).json()).toMatchObject({ games: [], summary: { wins: 0, draws: 0, losses: 0 } });
    await auth(app, white, 'link-guest');
    expect((await read(app, white, '/account/games')).json().games[0]).toMatchObject({ id, opponent: null, side: 'white', timeControl: '5+3' });
    await auth(app, black, 'register', { username: blackName, password });
    await auth(app, black, 'link-guest');
    const outcomes = [
      { outcome: 'win', winner: 'white', reason: 'checkmate' },
      { outcome: 'win', winner: 'black', reason: 'resignation' },
      { outcome: 'draw', reason: 'agreement' },
      { outcome: 'aborted', reason: 'first_move_deadline' },
      null,
    ];
    for (const result of outcomes) {
      const status = result?.outcome === 'aborted' ? 'aborted' : result ? 'finished' : 'pending_adjudication';
      await pool.query('UPDATE chess.games SET status = $2, result = $3 WHERE id = $1', [id, status, result]);
      for (const [who, side, opponent] of [[white, 'white', blackName], [black, 'black', whiteName]] as const) {
        const response = await read(app, who, '/account/games'); expect(response.statusCode).toBe(200);
        expect(response.headers['cache-control']).toBe('no-store');
        expect(response.json().games).toEqual([expect.objectContaining({ id, side, opponent, status, result })]);
        expect(response.json().summary).toEqual({
          wins: Number(result?.outcome === 'win' && result.winner === side),
          losses: Number(result?.outcome === 'win' && result.winner !== side),
          draws: Number(result?.outcome === 'draw'),
        });
      }
    }
    await auth(app, outsider, 'register', { username: username(), password });
    expect((await read(app, outsider, '/account/games')).json().games).toEqual([]);
    await auth(app, white, 'logout');
    expect((await read(app, white, '/account/games')).statusCode).toBe(401);
  });

  it('paginates by timestamp and ID without losing equal-time or microsecond-boundary games', async () => {
    const { app, white, id } = await setup();
    await auth(app, white, 'register', { username: username(), password });
    await auth(app, white, 'link-guest');
    await pool.query("UPDATE chess.challenges SET created_at = '2020-01-01' WHERE id = $1", [id]);
    const expected: { id: string; createdAt: string }[] = [];
    for (let i = 0; i < 24; i++) {
      const nextId = randomUUID();
      const createdAt = `2026-01-01T00:00:00.${i < 22 ? '000999' : '000998'}Z`;
      expected.push({ id: nextId, createdAt });
      await pool.query(`INSERT INTO chess.challenges (id, creator_guest_id, acceptor_guest_id, create_request_id, created_at, accepted_at, time_control)
        SELECT $2, creator_guest_id, acceptor_guest_id, $3, $4, $4, '3+2' FROM chess.challenges WHERE id = $1`,
      [id, nextId, randomUUID(), createdAt]);
      await pool.query(`INSERT INTO chess.games (id, starting_fen, fen, side_to_move, status, result)
        SELECT $2, starting_fen, starting_fen, 'white', 'finished', '{"outcome":"draw","reason":"agreement"}'
        FROM chess.games WHERE id = $1`, [id, nextId]);
    }
    expected.sort((a, b) => b.createdAt.localeCompare(a.createdAt) || b.id.localeCompare(a.id));
    expected.push({ id, createdAt: '2020-01-01T00:00:00.000000Z' });
    const first = (await read(app, white, '/account/games')).json();
    expect(first.games.map((g: { id: string }) => g.id)).toEqual(expected.slice(0, 20).map(g => g.id));
    expect(first.summary).toEqual({ wins: 0, draws: 24, losses: 0 });
    expect(first.games[0].timeControl).toBeNull(); // Legacy untimed rows must not invent a clock.
    // A newly created challenge without a game must not appear, even on a fresh page.
    await post(app, white, '/challenges');
    const restarted = server();
    const second = (await read(restarted, white, `/account/games?before=${first.next}`)).json();
    expect(second.games.map((g: { id: string }) => g.id)).toEqual(expected.slice(20).map(g => g.id));
    expect(second.next).toBeNull();
    expect(second.summary).toEqual(first.summary);
    expect(new Set([...first.games, ...second.games].map(g => g.id)).size).toBe(25);
    expect((await read(app, white, `/account/games?before=${first.next}`)).json()).toEqual(second);
    expect((await read(app, white, '/account/games?before=not-a-cursor')).statusCode).toBe(400);
    expect((await read(app, white, '/account/games?accountId=someone-else')).statusCode).toBe(400);
  });

  it('validates credentials and CSRF, hashes passwords, and rotates HttpOnly/SameSite/Secure sessions', async () => {
    const app = server(true), who = await browser(app), name = username(); const old = { ...who };
    expect((await app.inject({ method: 'POST', url: '/account/register', headers: { cookie: who.cookie }, payload: { username: name, password } })).statusCode).toBe(403);
    for (const payload of [{ username: 'x', password }, { username: name, password: 'short' }, { username: name, password, guestId: randomUUID() }]) {
      expect((await auth(app, who, 'register', payload)).statusCode).toBe(400);
    }
    const response = await auth(app, who, 'register', { username: name.toUpperCase(), password });
    expect(response.statusCode).toBe(200); expect(response.json().account.username).toBe(name);
    expect(who.cookie).not.toBe(old.cookie); expect(who.csrf).not.toBe(old.csrf);
    for (const c of response.cookies) { expect(c.httpOnly).toBe(true); expect(c.secure).toBe(true); expect(c.sameSite).toBe('Lax'); }
    const saved = (await pool.query('SELECT password_hash FROM chess.accounts WHERE username = $1', [name])).rows[0].password_hash as string;
    expect(saved).toMatch(/^\$argon2id\$v=19\$m=19456,t=2,p=1\$/); expect(saved).not.toContain(password);
    expect(response.body).not.toContain(saved);
    expect((await read(app, old, '/account')).statusCode).toBe(401);
    expect((await auth(app, await browser(app), 'register', { username: name, password })).statusCode).toBe(409);
    expect((await auth(app, await browser(app), 'login', { username: name, password: 'A different invalid password' })).json()).toEqual({ error: 'invalid_credentials' });
    expect((await auth(app, await browser(app), 'login', { username: username(), password })).json()).toEqual({ error: 'invalid_credentials' });
  });

  it('links only the current guest, restores game/chat/receipts in another browser and after restart', async () => {
    const { app, white, black, outsider, id } = await setup(); const name = username();
    const sent = await post(app, black, `/games/${id}/chat`, { text: 'Private conversation' }); expect(sent.statusCode).toBe(201);
    expect((await auth(app, white, 'register', { username: name, password })).statusCode).toBe(200);
    const second = await browser(app); expect((await auth(app, second, 'login', { username: name, password })).statusCode).toBe(200);
    expect((await read(app, second, `/games/${id}`)).statusCode).toBe(403);
    expect((await auth(app, white, 'link-guest', { guestId: randomUUID() })).statusCode).toBe(400);
    expect((await auth(app, white, 'link-guest')).statusCode).toBe(200);
    expect((await auth(app, white, 'link-guest')).statusCode).toBe(200);
    const restarted = server();
    expect((await read(restarted, second, `/challenges/${id}`)).json().yourSeat).toBe('white');
    expect((await read(restarted, second, `/games/${id}`)).json().yourSeat).toBe('white');
    expect((await read(restarted, second, `/games/${id}/chat`)).json().messages).toEqual([sent.json()]);
    const origin = await restarted.listen({ host: '127.0.0.1', port: 0 });
    const abort = new AbortController();
    const timeout = setTimeout(() => abort.abort(), 3000);
    try {
      const stream = await fetch(`${origin}/games/${id}/events`, { headers: { cookie: second.cookie }, signal: abort.signal });
      expect(stream.status).toBe(200);
      const reader = stream.body!.getReader();
      expect(new TextDecoder().decode((await reader.read()).value)).toContain(': connected');
      const pushed = await post(app, black, `/games/${id}/chat`, { text: 'Account stream delivery' });
      expect(pushed.statusCode).toBe(201);
      let text = '';
      while (!text.includes('event: chat')) text += new TextDecoder().decode((await reader.read()).value);
      expect(text).toContain(JSON.stringify({ messageId: pushed.json().id }));
      await reader.cancel();
    } finally { clearTimeout(timeout); abort.abort(); }
    const retry = randomUUID();
    const moved = await post(restarted, second, `/games/${id}/moves`, { expectedVersion: 0, from: 'e2', to: 'e4' }, retry);
    expect(moved.statusCode).toBe(200);
    expect((await post(app, white, `/games/${id}/moves`, { expectedVersion: 0, from: 'e2', to: 'e4' }, retry)).json()).toEqual(moved.json());
    expect((await post(restarted, second, `/games/${id}/chat`, { text: 'Back in another browser' })).json().side).toBe('white');
    expect((await read(restarted, second, '/account/games')).json().games).toContainEqual(expect.objectContaining({ id, side: 'white' }));
    for (const path of [`/challenges/${id}`, `/games/${id}`, `/games/${id}/chat`, `/games/${id}/events`])
      expect((await read(restarted, outsider, path)).statusCode).toBe(403);
    expect((await post(restarted, outsider, `/games/${id}/chat`, { text: 'Take over' })).statusCode).toBe(403);
    expect((await post(restarted, outsider, `/games/${id}/resign`, { expectedVersion: 1 })).statusCode).toBe(403);
    // An account cookie copied without its bound guest session cannot authenticate.
    const mixed = { ...outsider, cookie: `${outsider.cookie}; ${second.cookie.split('; ').find(c => c.startsWith('chess_account='))}` };
    expect((await read(restarted, mixed, `/games/${id}/chat`)).statusCode).toBe(403);
  });

  it('never links a browser implicitly on login or transfers a previously linked guest', async () => {
    const { app, white, black, id } = await setup(); const name = username();
    expect((await auth(app, white, 'register', { username: name, password })).statusCode).toBe(200);
    const elsewhere = await browser(app); await auth(app, elsewhere, 'login', { username: name, password });
    expect((await read(app, elsewhere, `/games/${id}`)).statusCode).toBe(403);
    await auth(app, white, 'link-guest');
    // Black may log in to this account, but that does not link Black's guest-owned seat.
    await auth(app, black, 'login', { username: name, password });
    expect((await auth(app, black, 'link-guest')).json()).toEqual({ error: 'opposite_seat_linked' });
    const beforeSwitch = { ...white };
    const other = username(); expect((await auth(app, white, 'register', { username: other, password })).statusCode).toBe(200);
    expect((await read(app, white, `/games/${id}`)).statusCode).toBe(403);
    await auth(app, white, 'link-guest');
    expect((await read(app, white, `/games/${id}/chat`)).statusCode).toBe(403);
    expect((await read(app, beforeSwitch, '/account')).statusCode).toBe(401);
  });

  it('logs out durably, revokes old bearers, preserves another login and unlinked guest play', async () => {
    const { app, white, id } = await setup(); const name = username();
    await auth(app, white, 'register', { username: name, password }); await auth(app, white, 'link-guest');
    const second = await browser(app); await auth(app, second, 'login', { username: name, password });
    const old = { ...white }; expect((await auth(app, white, 'logout')).statusCode).toBe(200);
    expect((await read(app, white, `/games/${id}`)).statusCode).toBe(403);
    expect((await read(app, old, `/games/${id}`)).statusCode).toBe(401);
    expect((await read(app, second, `/games/${id}`)).statusCode).toBe(200);
    await auth(app, white, 'login', { username: name, password });
    expect((await read(app, white, `/games/${id}/chat`)).statusCode).toBe(200);
    const unlinked = await setup(); await auth(unlinked.app, unlinked.white, 'register', { username: username(), password });
    await auth(unlinked.app, unlinked.white, 'logout');
    expect((await read(unlinked.app, unlinked.white, `/games/${unlinked.id}`)).statusCode).toBe(200);
  });

  it('keeps links after guest/session expiry but requires a fresh login', async () => {
    const { app, white, id } = await setup(); const name = username();
    const registered = await auth(app, white, 'register', { username: name, password }); await auth(app, white, 'link-guest');
    await pool.query("UPDATE chess.account_sessions SET expires_at = now() - interval '1 second' WHERE account_id = $1", [registered.json().account.id]);
    const another = await browser(app); await auth(app, another, 'login', { username: name, password });
    expect((await read(app, another, `/games/${id}`)).statusCode).toBe(200);
    expect((await read(app, white, '/account')).json().account).toBeNull();
    // Expire the original guest bearer without deleting its durable seat or account link.
    await pool.query(`UPDATE chess.guest_sessions SET created_at = now() - interval '31 days',
      expires_at = now() - interval '1 second' WHERE account_id = $1`, [registered.json().account.id]);
    expect((await read(app, white, `/games/${id}`)).statusCode).toBe(401);
    expect((await read(app, another, `/games/${id}`)).statusCode).toBe(200);
  });

  it('prevents an account accepting its own linked challenge from a second browser', async () => {
    const app = server(), first = await browser(app), second = await browser(app), name = username();
    const challenge = await post(app, first, '/challenges'); const id = challenge.json().id as string;
    await auth(app, first, 'register', { username: name, password }); await auth(app, first, 'link-guest');
    await auth(app, second, 'login', { username: name, password });
    expect((await post(app, second, `/challenges/${id}/accept`)).json()).toEqual({ error: 'cannot_accept_own_challenge' });
    const other = await browser(app); expect((await post(app, other, `/challenges/${id}/accept`)).statusCode).toBe(200);
    expect((await read(app, second, `/games/${id}`)).json().yourSeat).toBe('white');
  });

  it('orders concurrent opposite-seat links so exactly one succeeds', async () => {
    const { app, white, black } = await setup(), name = username();
    await auth(app, white, 'register', { username: name, password }); await auth(app, black, 'login', { username: name, password });
    const responses = await Promise.all([auth(app, white, 'link-guest'), auth(server(), black, 'link-guest')]);
    expect(responses.map(r => r.statusCode).sort()).toEqual([200, 409]);
    expect(responses.find(r => r.statusCode === 409)!.json()).toEqual({ error: 'opposite_seat_linked' });
  });

  it('enforces durable login throttles, bounded game queries, and CSRF on account mutations', async () => {
    const app = server(), who = await browser(app), name = username();
    await auth(app, who, 'register', { username: name, password });
    for (const path of ['logout', 'link-guest']) expect((await app.inject({ method: 'POST', url: `/account/${path}`, headers: { cookie: who.cookie } })).statusCode).toBe(403);
    expect((await read(app, who, '/account/games?limit=10000')).statusCode).toBe(400);
    for (let n = 0; n < 9; n++) expect((await auth(app, who, 'login', { username: name, password: 'An incorrect long password' })).statusCode).toBe(401);
    const limited = await auth(server(), who, 'login', { username: name, password });
    expect(limited.statusCode).toBe(429); expect(limited.headers['retry-after']).toBe('900');
  });

  it('omits unaccepted challenges from the game archive', async () => {
    const app = server(), who = await browser(app), name = username();
    const registered = await auth(app, who, 'register', { username: name, password });
    await auth(app, who, 'link-guest');
    const owner = (await pool.query('SELECT id FROM chess.guest_sessions WHERE account_id = $1', [registered.json().account.id])).rows[0].id;
    await pool.query(`INSERT INTO chess.challenges (id, creator_guest_id, create_request_id)
      SELECT gen_random_uuid(), $1, gen_random_uuid() FROM generate_series(1, 21)`, [owner]);
    const first = (await read(app, who, '/account/games')).json();
    expect(first.games).toEqual([]); expect(first.next).toBeNull();
    expect(first.summary).toEqual({ wins: 0, draws: 0, losses: 0 });
    expect((await read(app, await browser(app), '/account/games')).statusCode).toBe(401);
  });

  it('returns both explicit seat names to participants in live and finished reads and pushes a link refresh', async () => {
    const { app, white, black, outsider, id } = await setup(); const whiteName = username(), blackName = username();
    await auth(app, white, 'register', { username: whiteName, password });
    await auth(app, black, 'register', { username: blackName, password });
    expect((await read(app, white, `/games/${id}`)).json().playerNames).toEqual({ white: null, black: null });
    await auth(app, white, 'link-guest');
    expect((await read(app, black, `/games/${id}`)).json().playerNames).toEqual({ white: whiteName, black: null });
    const origin = await app.listen({ host: '127.0.0.1', port: 0 });
    const abort = new AbortController(); const timeout = setTimeout(() => abort.abort(), 3000);
    try {
      const response = await fetch(`${origin}/games/${id}/events`, { headers: { cookie: white.cookie }, signal: abort.signal });
      const stream = response.body!.getReader(); await stream.read();
      expect((await auth(app, black, 'link-guest')).statusCode).toBe(200);
      let event = '';
      while (!event.includes('event: game')) event += new TextDecoder().decode((await stream.read()).value);
      expect(event).toContain('"version":0');
      await stream.cancel();
    } finally { clearTimeout(timeout); abort.abort(); }
    const playerNames = { white: whiteName, black: blackName };
    for (const who of [white, black]) expect((await read(app, who, `/games/${id}`)).json()).toMatchObject({ version: 0, status: 'active', playerNames });
    const denied = await read(app, outsider, `/games/${id}`);
    expect(denied.statusCode).toBe(403); expect(denied.body).not.toContain(whiteName); expect(denied.body).not.toContain(blackName);
    expect((await post(app, white, `/games/${id}/resign`, { expectedVersion: 0 })).statusCode).toBe(200);
    const restarted = server();
    for (const who of [white, black]) expect((await read(restarted, who, `/games/${id}`)).json()).toMatchObject({ status: 'finished', playerNames });
    // Signing out and switching accounts changes access, never the account already linked to the seat.
    await auth(app, black, 'logout');
    await auth(app, black, 'register', { username: username(), password });
    expect((await read(app, black, `/games/${id}`)).statusCode).toBe(403);
    expect((await read(app, white, `/games/${id}`)).json().playerNames).toEqual(playerNames);
  });

  it('keeps an unlinked seat unnamed after account switching and logout', async () => {
    const { app, white, black, id } = await setup(); const whiteName = username();
    await auth(app, white, 'register', { username: whiteName, password }); await auth(app, white, 'link-guest');
    const firstName = username(), secondName = username();
    await auth(app, black, 'register', { username: firstName, password });
    await auth(app, black, 'register', { username: secondName, password });
    const expected = { white: whiteName, black: null };
    const switched = await read(app, black, `/games/${id}`);
    expect(switched.json().playerNames).toEqual(expected);
    expect(switched.body).not.toContain(firstName); expect(switched.body).not.toContain(secondName);
    await auth(app, black, 'logout');
    expect((await read(app, black, `/games/${id}`)).json().playerNames).toEqual(expected);
  });
});
