import { randomUUID } from 'node:crypto';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import type pg from 'pg';
import { loadEnvironment, databaseUrl } from '../src/config.js';
import { createPool } from '../src/database.js';
import { migrate } from '../src/migrations.js';
import { buildApp } from '../src/app.js';
interface Guest { cookie: string; csrf: string ;}
describe('private rematch lifecycle', () => {
  let pool: pg.Pool; const apps: FastifyInstance[] = [];
  beforeAll(async () => { loadEnvironment(); pool = createPool(databaseUrl(process.env.TEST_DATABASE_URL, 'TEST_DATABASE_URL')); await migrate(pool); });
  afterEach(async () => { for (const app of apps.splice(0)) await app.close(); }); afterAll(async () => { await pool.end(); });
  const app = () => { const server = buildApp(async () => { }, false, { pool, secureCookies: false }); apps.push(server); return server; };
  const headers = (g: Guest, key = randomUUID()) => ({ cookie: g.cookie, 'x-csrf-token': g.csrf, 'idempotency-key': key });
  async function guest(server: FastifyInstance) { const r = await server.inject('/guest-session'); return { cookie: String(r.headers['set-cookie']).split(';')[0]!, csrf: r.json().csrfToken } as Guest; }
  async function setup(finished = true) { const server = app(), white = await guest(server), black = await guest(server), other = await guest(server); const id = (await server.inject({ method: 'POST', url: '/challenges', headers: headers(white), payload: { timeControl: '3+2' } })).json().id; await server.inject({ method: 'POST', url: `/challenges/${id}/accept`, headers: headers(black) }); if (finished) expect((await server.inject({ method: 'POST', url: `/games/${id}/resign`, headers: headers(white), payload: { expectedVersion: 0 } })).statusCode).toBe(200); return { server, white, black, other, id, url: `/games/${id}/rematch` }; }
  it('requires the invited participant, persists a single new game, and survives duplicate/concurrent responses', async () => {
    const { server, white, black, other, id, url } = await setup(); const key = randomUUID(); const body = { action: 'offer' };
    const responses = await Promise.all([server, app()].map(s => s.inject({ method: 'POST', url, headers: headers(white, key), payload: body })));
    expect(responses.map(r => r.statusCode)).toEqual([200, 200]); expect(responses[0]!.json()).toEqual(responses[1]!.json()); const offer = responses[0]!.json().offer;
    expect((await server.inject({ url, headers: { cookie: other.cookie } })).statusCode).toBe(403);
    expect((await server.inject({ method: 'POST', url, headers: headers(other), payload: body })).statusCode).toBe(403);
    expect((await server.inject({ method: 'POST', url, headers: headers(white), payload: { action: 'accept', offerId: offer.id } })).statusCode).toBe(409);
    const accepted = await Promise.all([server, app()].map(s => s.inject({ method: 'POST', url, headers: headers(black), payload: { action: 'accept', offerId: offer.id } })));
    expect(accepted.map(r => r.statusCode)).toEqual([200, 200]); const next = accepted[0]!.json().offer.newGameId; expect(accepted[1]!.json().offer.newGameId).toBe(next);
    const restarted = app(); for (const who of [white, black]) { const state = await restarted.inject({ url: `/games/${next}`, headers: { cookie: who.cookie } }); expect(state.statusCode).toBe(200); expect(state.json().timeControl).toMatchObject({ initialMs: 180000, incrementMs: 2000 }); expect(state.json().clocks.remainingMs.white).toBe(180000); }
    expect((await restarted.inject({ url: `/games/${next}`, headers: { cookie: other.cookie } })).statusCode).toBe(403);
    expect((await restarted.inject({ url: `/games/${next}`, headers: { cookie: black.cookie } })).json().yourSeat).toBe('white');
    const chat = (await restarted.inject({ url: `/games/${id}/chat`, headers: { cookie: white.cookie } })).json(); expect(chat.messages.map((m: { text: string ;}) => m.text)).toEqual(['offered a rematch.', 'accepted the rematch offer.']); expect(chat.messages.every((m: { kind: string ;}) => m.kind === 'system')).toBe(true);
    expect((await restarted.inject({ url: `/games/${id}`, headers: { cookie: white.cookie } })).json().version).toBe(1);
  });
  it('handles decline, expiry, unavailable guests, and active games honestly', async () => {
    const { server, white, black, url, id } = await setup(); let offer = (await server.inject({ method: 'POST', url, headers: headers(black), payload: { action: 'offer' } })).json().offer;
    expect((await server.inject({ method: 'POST', url, headers: headers(white), payload: { action: 'decline', offerId: offer.id } })).json().offer.status).toBe('declined');
    offer = (await server.inject({ method: 'POST', url, headers: headers(white), payload: { action: 'offer' } })).json().offer;
    await pool.query("UPDATE chess.game_rematches SET expires_at=now()-interval '1 second' WHERE id=$1", [offer.id]);
    expect((await app().inject({ url, headers: { cookie: black.cookie } })).json().offer.status).toBe('expired');
    expect((await server.inject({ method: 'POST', url, headers: headers(black), payload: { action: 'accept', offerId: offer.id } })).statusCode).toBe(409);
    await pool.query('UPDATE chess.guest_sessions SET created_at=now()-interval \'2 days\', expires_at=now()-interval \'1 second\' WHERE id=(SELECT acceptor_guest_id FROM chess.challenges WHERE id=$1)', [id]);
    expect((await server.inject({ method: 'POST', url, headers: headers(white), payload: { action: 'offer' } })).json().error).toBe('opponent_unavailable');
    const active = await setup(false); expect((await active.server.inject({ method: 'POST', url: active.url, headers: headers(active.white), payload: { action: 'offer' } })).statusCode).toBe(409);
  });
  it('records accepted draw actions atomically and does not allow clients to impersonate system entries', async () => {
    const { server, white, black, id } = await setup(false);
    for (const [who, from, to, version] of [[white, 'e2', 'e4', 0], [black, 'e7', 'e5', 1]] as const) expect((await server.inject({ method: 'POST', url: `/games/${id}/moves`, headers: headers(who), payload: { from, to, expectedVersion: version } })).statusCode).toBe(200);
    const key = randomUUID(); for (let i = 0;i < 2;i++)expect((await server.inject({ method: 'POST', url: `/games/${id}/draw-offer`, headers: headers(white, key), payload: { expectedVersion: 2 } })).statusCode).toBe(200);
    expect((await server.inject({ method: 'POST', url: `/games/${id}/draw-decline`, headers: headers(black), payload: { expectedVersion: 3 } })).statusCode).toBe(200);
    const history = (await server.inject({ url: `/games/${id}/chat`, headers: { cookie: black.cookie } })).json().messages; expect(history.map((m: { text: string ;}) => m.text)).toEqual(['offered a draw.', 'declined the draw offer.']);
    expect((await server.inject({ method: 'POST', url: `/games/${id}/chat`, headers: headers(white), payload: { text: 'offered a draw.', kind: 'system' } })).statusCode).toBe(400);
  });
  it('keeps account rematches private across browsers with current names and swapped colors', async () => {
    const server = app(), white = await guest(server), black = await guest(server), second = await guest(server);
    const password = 'A synthetic rematch test passphrase';
    const names = [`w_${randomUUID().slice(0, 8)}`, `b_${randomUUID().slice(0, 8)}`];
    async function auth(who: Guest, path: string, name: string) {
      const r = await server.inject({ method: 'POST', url: '/account/' + path, remoteAddress: `127.91.${Math.floor(Math.random() * 250) + 1}.${Math.floor(Math.random() * 250) + 1}`, headers: headers(who), payload: { username: name, password } });
      expect(r.statusCode).toBe(200);
      const cookies = new Map(who.cookie.split('; ').map(c => c.split('=') as [string, string]));
      for (const c of r.cookies) c.value ? cookies.set(c.name, c.value) : cookies.delete(c.name);
      who.cookie = [...cookies].map(([k, v]) => `${k}=${v}`).join('; '); who.csrf = r.json().csrfToken;
    }
    await auth(white, 'register', names[0]!); await auth(black, 'register', names[1]!); await auth(second, 'login', names[0]!);
    const id = (await server.inject({ method: 'POST', url: '/challenges', headers: headers(white), payload: { timeControl: '10+5' } })).json().id;
    await server.inject({ method: 'POST', url: `/challenges/${id}/accept`, headers: headers(black) });
    await server.inject({ method: 'POST', url: `/games/${id}/resign`, headers: headers(white), payload: { expectedVersion: 0 } });
    const url = `/games/${id}/rematch`;
    expect((await server.inject({ method: 'POST', url, headers: { cookie: black.cookie, 'idempotency-key': randomUUID() }, payload: { action: 'offer' } })).statusCode).toBe(403);
    const offer = (await server.inject({ method: 'POST', url, headers: headers(black), payload: { action: 'offer' } })).json().offer;
    const accepted = await server.inject({ method: 'POST', url, headers: headers(second), payload: { action: 'accept', offerId: offer.id } });
    expect(accepted.statusCode).toBe(200); const next = accepted.json().offer.newGameId;
    const state = (await app().inject({ url: `/games/${next}`, headers: { cookie: second.cookie } })).json();
    expect(state).toMatchObject({ yourSeat: 'black', playerNames: { white: names[1], black: names[0] }, timeControl: { initialMs: 600000, incrementMs: 5000 } });
    expect((await server.inject({ url: '/account/games', headers: { cookie: second.cookie } })).json().games.map((g: { id: string ;}) => g.id)).toContain(next);
    expect((await server.inject({ url: `/games/${next}/chat`, headers: { cookie: second.cookie } })).statusCode).toBe(200);
    await server.inject({ method: 'POST', url: '/account/logout', headers: headers(second) });
    expect((await server.inject({ url: `/games/${next}`, headers: { cookie: second.cookie.split('; ')[0] } })).statusCode).toBe(401);
  });
  it('persists a draw acceptance and its system notification after restarting', async () => {
    const { server, white, black, id } = await setup(false);
    for (const [who, from, to, version] of [[white, 'e2', 'e4', 0], [black, 'e7', 'e5', 1]] as const) await server.inject({ method: 'POST', url: `/games/${id}/moves`, headers: headers(who), payload: { from, to, expectedVersion: version } });
    await server.inject({ method: 'POST', url: `/games/${id}/draw-offer`, headers: headers(black), payload: { expectedVersion: 2 } });
    const key = randomUUID(); for (let i = 0;i < 2;i++)expect((await server.inject({ method: 'POST', url: `/games/${id}/draw-accept`, headers: headers(white, key), payload: { expectedVersion: 3 } })).statusCode).toBe(200);
    const history = (await app().inject({ url: `/games/${id}/chat`, headers: { cookie: black.cookie } })).json().messages;
    expect(history.map((m: { side: string; text: string ;}) => [m.side, m.text])).toEqual([['black', 'offered a draw.'], ['white', 'accepted the draw offer.']]);
  });
  it('records an implicit draw decline when the opponent makes a move, once across retries', async () => {
    const { server, white, black, id } = await setup(false);
    for (const [who, from, to, version] of [[white, 'e2', 'e4', 0], [black, 'e7', 'e5', 1]] as const) {
      expect((await server.inject({ method: 'POST', url: `/games/${id}/moves`, headers: headers(who), payload: { from, to, expectedVersion: version } })).statusCode).toBe(200);
    }
    await server.inject({ method: 'POST', url: `/games/${id}/draw-offer`, headers: headers(black), payload: { expectedVersion: 2 } });
    const key = randomUUID();
    for (let i = 0; i < 2; i++) {
      expect((await server.inject({ method: 'POST', url: `/games/${id}/moves`, headers: headers(white, key), payload: { from: 'g1', to: 'f3', expectedVersion: 3 } })).statusCode).toBe(200);
    }
    const history = (await app().inject({ url: `/games/${id}/chat`, headers: { cookie: black.cookie } })).json().messages;
    expect(history.map((m: { text: string }) => m.text)).toEqual(['offered a draw.', 'declined the draw offer by playing a move.']);
  });
});
