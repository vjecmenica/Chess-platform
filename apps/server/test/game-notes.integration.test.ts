import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import type pg from 'pg';
import { loadEnvironment, databaseUrl } from '../src/config.js';
import { createPool } from '../src/database.js';
import { migrate } from '../src/migrations.js';
import { buildApp } from '../src/app.js';

let pool: pg.Pool;
const apps: FastifyInstance[] = [];
beforeAll(async () => { loadEnvironment(); pool = createPool(databaseUrl(process.env.TEST_DATABASE_URL)); await migrate(pool); });
afterAll(async () => { for (const app of apps) await app.close(); await pool.end(); });
function server() { const app = buildApp(async () => {}, false, { pool, secureCookies: false }); apps.push(app); return app; }
async function browser(app: FastifyInstance) {
  const response = await app.inject('/guest-session');
  return { cookie: response.cookies.map(c => `${c.name}=${c.value}`).join('; '), csrf: response.json().csrfToken as string };
}
type Browser = Awaited<ReturnType<typeof browser>>;
const headers = (who: Browser) => ({ cookie: who.cookie, 'x-csrf-token': who.csrf, 'idempotency-key': randomUUID() });
const password = 'A synthetic strong test passphrase';
async function auth(app: FastifyInstance, who: Browser, action: string, username?: string) {
  const response = await app.inject({ method: 'POST', url: `/account/${action}`, headers: headers(who),
    ...(username ? { payload: { username, password } } : {}) });
  expect(response.statusCode).toBe(200);
  const jar = new Map(who.cookie.split('; ').map(c => c.split('=') as [string, string]));
  for (const c of response.cookies) c.value ? jar.set(c.name, c.value) : jar.delete(c.name);
  who.cookie = [...jar].map(([k,v]) => `${k}=${v}`).join('; ');
  who.csrf = response.json().csrfToken;
}
async function game(app: FastifyInstance, white: Browser, black: Browser) {
  const id = (await app.inject({ method: 'POST', url: '/challenges', headers: headers(white) })).json().id;
  expect((await app.inject({ method: 'POST', url: `/challenges/${id}/accept`, headers: headers(black) })).statusCode).toBe(200);
  return `/games/${id}/notes`;
}
const read = (app: FastifyInstance, who: Browser, url: string) => app.inject({ url, headers: headers(who) });
const save = (app: FastifyInstance, who: Browser, url: string, note: object, text: string) =>
  app.inject({ method: 'PUT', url, headers: headers(who), payload: { ...note, text } });

it('persists guest notes across restart, isolates participants, validates CSRF and prevents lost updates', async () => {
  const app = server(), white = await browser(app), black = await browser(app), outsider = await browser(app);
  const url = await game(app, white, black);
  const initial = (await read(app, white, url)).json();
  const body = { owner: initial.owner, version: initial.version };
  expect((await save(app, white, url, body, '<plain> private')).statusCode).toBe(200);
  expect((await read(server(), white, url)).json()).toMatchObject({ text: '<plain> private', version: 1, scope: 'guest' });
  expect((await read(app, black, url)).json()).toMatchObject({ text: '', version: 0 });
  expect((await read(app, outsider, url)).statusCode).toBe(403);
  expect((await save(app, outsider, url, body, 'stolen')).statusCode).toBe(403);
  expect((await save(app, black, url, body, 'stolen')).statusCode).toBe(409);
  expect((await save(app, white, url, body, 'stale')).statusCode).toBe(409);
  expect((await save(app, white, url, { owner: initial.owner, version: 1 }, 'x'.repeat(10001))).statusCode).toBe(400);
  expect((await app.inject({ method: 'PUT', url, headers: { cookie: white.cookie }, payload: { ...body, text: 'bad' } })).statusCode).toBe(403);
  expect((await read(app, white, url)).headers['cache-control']).toBe('no-store');
  expect((await read(app, black, url.replace('/notes', '/chat'))).body).not.toContain('private');
  expect((await read(app, black, url.replace('/notes', ''))).body).not.toContain('private');
  expect((await app.inject({ method: 'POST', url: url.replace('/notes', '/resign'),
    headers: headers(black), payload: { expectedVersion: 0 } })).statusCode).toBe(200);
  expect((await save(app, white, url, { owner: initial.owner, version: 1 }, 'after game')).statusCode).toBe(200);
});

it('keeps account notes across browsers and never transfers guest notes on login or account switching', async () => {
  const app = server(), white = await browser(app), black = await browser(app);
  const url = await game(app, white, black);
  const guestNote = (await read(app, white, url)).json();
  await save(app, white, url, { owner: guestNote.owner, version: 0 }, 'guest secret');
  const name = `n_${randomUUID().replaceAll('-', '').slice(0, 18)}`;
  await auth(app, white, 'register', name);
  const accountNote = (await read(app, white, url)).json();
  expect(accountNote).toMatchObject({ scope: 'account', text: '', version: 0 });
  expect((await save(app, white, url, { owner: guestNote.owner, version: 0 }, 'transfer')).statusCode).toBe(409);
  await save(app, white, url, { owner: accountNote.owner, version: 0 }, 'account secret');
  await auth(app, white, 'logout');
  expect((await read(app, white, url)).json().text).toBe('guest secret');
  await auth(app, white, 'register', `n_${randomUUID().replaceAll('-', '').slice(0, 18)}`);
  expect((await read(app, white, url)).json().text).toBe('');
  // New account-owned games are accessible in a second authenticated browser.
  const ownUrl = await game(app, white, await browser(app));
  const own = (await read(app, white, ownUrl)).json();
  await save(app, white, ownUrl, { owner: own.owner, version: 0 }, 'cross browser');
  const account = (await app.inject({ url: '/account', headers: headers(white) })).json().account;
  const second = await browser(app); await auth(app, second, 'login', account.username);
  expect((await read(server(), second, ownUrl)).json().text).toBe('cross browser');
});
