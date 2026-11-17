import { randomInt, randomUUID } from 'node:crypto';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import sharp from 'sharp';
import { afterAll, beforeAll, expect, it } from 'vitest';
import { avatarUploadMaxBytes } from '@chess/contracts';
import { cleanAvatarObjects } from '../src/account-avatars.js';
import { buildApp } from '../src/app.js';
import { localAvatarStorage } from '../src/avatar-storage.js';
import { databaseUrl, loadEnvironment } from '../src/config.js';
import { createPool } from '../src/database.js';
import { migrate } from '../src/migrations.js';

let pool: ReturnType<typeof createPool>;
let app: ReturnType<typeof buildApp>;
let directory: string;
let storage: ReturnType<typeof localAvatarStorage>;
const password = 'A synthetic avatar test password';
const subnet = `127.${randomInt(1, 255)}.${randomInt(1, 255)}`;
let browsers = 0;

beforeAll(async () => {
  loadEnvironment();
  pool = createPool(databaseUrl(process.env.TEST_DATABASE_URL, 'TEST_DATABASE_URL'));
  await migrate(pool);
  directory = await mkdtemp(join(tmpdir(), 'chess-avatar-test-'));
  storage = localAvatarStorage(directory);
  app = buildApp(async () => {}, false, { pool, avatarStorage: storage, secureCookies: false });
});

afterAll(async () => {
  await app?.close();
  await pool?.end();
  if (directory) await rm(directory, { recursive: true, force: true });
});

async function browser() {
  const response = await app.inject('/guest-session');
  return { cookie: response.cookies.map(cookie => `${cookie.name}=${cookie.value}`).join('; '),
    csrf: response.json().csrfToken as string, ip: `${subnet}.${++browsers}` };
}

type Browser = Awaited<ReturnType<typeof browser>>;
const headers = (who: Browser) => ({ cookie: who.cookie, 'x-csrf-token': who.csrf });

async function signIn(who: Browser, mode: 'register' | 'login', username = 'a_' + randomUUID().slice(0, 8)) {
  const response = await app.inject({ method: 'POST', url: `/account/${mode}`, headers: headers(who),
    payload: { username, password }, remoteAddress: who.ip });
  expect(response.statusCode).toBe(200);
  who.cookie = response.cookies.map(cookie => `${cookie.name}=${cookie.value}`).join('; ');
  who.csrf = response.json().csrfToken;
  return response.json().account as { id: string; username: string; avatarUrl?: string };
}

function change(who: Browser, owner: string, image?: Buffer) {
  return app.inject({ method: image ? 'PUT' : 'DELETE', url: '/account/avatar', remoteAddress: who.ip,
    headers: { ...headers(who), 'x-avatar-owner': owner, ...(image ? { 'content-type': 'application/octet-stream' } : {}) },
    ...(image ? { payload: image } : {}) });
}

const image = (color: string) => sharp({ create: { width: 340, height: 200, channels: 3, background: color } }).png().toBuffer();

it('publishes small, versioned public images and shares them only as player metadata on authorized games', async () => {
  const white = await browser(), black = await browser(), guest = await browser();
  const owner = await signIn(white, 'register');
  expect((await change(guest, owner.id, await image('white'))).statusCode).toBe(401);
  expect((await change({ ...white, csrf: '0'.repeat(64) }, owner.id, await image('white'))).statusCode).toBe(403);
  expect((await change(white, owner.id, Buffer.from('<svg/>'))).statusCode).toBe(400);
  expect((await change(white, owner.id, Buffer.alloc(avatarUploadMaxBytes + 1))).statusCode).toBe(413);
  expect((await app.inject('/avatars/not-an-object.webp')).statusCode).toBe(404);

  const first = await change(white, owner.id, await image('brown'));
  expect(first.statusCode).toBe(200);
  const { avatarUrl } = first.json();
  expect(avatarUrl).toMatch(/^\/api\/avatars\/[a-f\d-]+\.webp$/);
  const path = avatarUrl.slice(4);
  const rendered = await app.inject(path);
  expect(rendered.statusCode).toBe(200);
  expect(rendered.headers).toMatchObject({ 'cache-control': 'public, max-age=3600, immutable',
    'content-type': 'image/webp', 'x-content-type-options': 'nosniff' });
  expect(await sharp(rendered.rawPayload).metadata()).toMatchObject({ width: 256, height: 256, format: 'webp' });
  expect((await app.inject({ url: '/account', headers: headers(white) })).json().account).toEqual({ ...owner, avatarUrl });

  const { id } = (await app.inject({ method: 'POST', url: '/challenges',
    headers: { ...headers(white), 'idempotency-key': randomUUID() } })).json();
  await signIn(black, 'register');
  expect((await app.inject({ method: 'POST', url: `/challenges/${id}/accept`, headers: headers(black) })).statusCode).toBe(200);
  const game = () => app.inject({ url: `/games/${id}`, headers: headers(black) });
  expect((await game()).json().playerAvatars).toEqual({ white: { accountId: owner.id, url: avatarUrl }, black: null });
  expect((await app.inject({ url: `/games/${id}`, headers: headers(guest) })).statusCode).toBe(403);
  expect((await change(black, owner.id, await image('blue'))).statusCode).toBe(409);

  expect(await signIn(white, 'login', owner.username)).toEqual({ ...owner, avatarUrl });
  const writes = await Promise.all([change(white, owner.id, await image('purple')), change(white, owner.id, await image('orange'))]);
  expect(writes.map(response => response.statusCode)).toEqual([200, 200]);
  const current = (await game()).json().playerAvatars.white.url;
  const retired = writes.map(response => response.json().avatarUrl).find(url => url !== current);
  expect(current).not.toBe(avatarUrl);
  expect(retired).toBeDefined();
  await cleanAvatarObjects(pool, storage);
  expect((await app.inject(path)).statusCode).toBe(404);
  expect((await app.inject(retired.slice(4))).statusCode).toBe(404);
  expect((await app.inject(current.slice(4))).statusCode).toBe(200);

  const switched = await signIn(white, 'register');
  expect(switched.avatarUrl).toBeUndefined();
  expect((await change(white, owner.id)).statusCode).toBe(409);
  expect((await game()).json().playerAvatars.white.url).toBe(current);
  await signIn(white, 'login', owner.username);
  expect((await change(white, owner.id)).json()).toEqual({ accountId: owner.id, avatarUrl: null });
  expect((await game()).json().playerAvatars.white).toBeNull();
  await cleanAvatarObjects(pool, storage);
  expect((await app.inject(current.slice(4))).statusCode).toBe(404);
});

it('retains failed deletions for retry and rate-limits repeated invalid writes', async () => {
  const who = await browser();
  const { id } = await signIn(who, 'register');
  const uploaded = await change(who, id, await image('teal'));
  const path = uploaded.json().avatarUrl.slice(4);
  const key = path.split('/').at(-1).slice(0, -5);
  expect((await change(who, id)).statusCode).toBe(200);
  await cleanAvatarObjects(pool, { ...storage, remove: async () => { throw new Error('temporary storage failure'); } });
  expect((await app.inject(path)).statusCode).toBe(200);
  expect((await pool.query('SELECT object_key FROM chess.avatar_cleanup WHERE object_key = $1 AND delete_after > now()', [key])).rowCount).toBe(1);
  await pool.query('UPDATE chess.avatar_cleanup SET delete_after = now() WHERE object_key = $1', [key]);
  await cleanAvatarObjects(pool, storage);
  expect((await app.inject(path)).statusCode).toBe(404);
  for (let i = 0; i < 8; i++) expect((await change(who, id, Buffer.from('fake'))).statusCode).toBe(400);
  expect((await change(who, id, Buffer.from('fake'))).statusCode).toBe(429);
});
