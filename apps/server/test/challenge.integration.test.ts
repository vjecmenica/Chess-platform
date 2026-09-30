import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import type pg from 'pg';
import { databaseUrl, loadEnvironment } from '../src/config.js';
import { checkDatabase, createPool } from '../src/database.js';
import { migrate } from '../src/migrations.js';
import { buildApp } from '../src/app.js';

interface Guest {
  cookie: string;
  csrf: string;
}

describe('guest challenges against PostgreSQL', () => {
  let pool: pg.Pool;
  let app: FastifyInstance;

  beforeAll(async () => {
    loadEnvironment();
    pool = createPool(databaseUrl(process.env.TEST_DATABASE_URL, 'TEST_DATABASE_URL'));
    await checkDatabase(pool);
    await migrate(pool);
    app = buildApp(() => checkDatabase(pool), false, { pool, secureCookies: true });
  });

  afterAll(async () => {
    if (app) await app.close();
    if (pool) await pool.end();
  });

  async function guest(): Promise<Guest> {
    const response = await app.inject('/guest-session');
    expect(response.statusCode).toBe(200);
    const cookie = String(response.headers['set-cookie']).split(';')[0]!;
    expect(response.headers['set-cookie']).toContain('HttpOnly');
    expect(response.headers['set-cookie']).toContain('SameSite=Lax');
    expect(response.headers['set-cookie']).toContain('Secure');
    expect(response.headers['cache-control']).toBe('no-store');
    const csrf = response.json().csrfToken as string;
    expect(csrf).toMatch(/^[a-f0-9]{64}$/);
    return { cookie, csrf };
  }

  function create(owner: Guest, requestId = randomUUID()) {
    return app.inject({ method: 'POST', url: '/challenges',
      headers: { cookie: owner.cookie, 'x-csrf-token': owner.csrf,
        'idempotency-key': requestId } });
  }

  function accept(id: string, actor: Guest) {
    return app.inject({ method: 'POST', url: `/challenges/${id}/accept`,
      headers: { cookie: actor.cookie, 'x-csrf-token': actor.csrf } });
  }

  function read(id: string, actor?: Guest) {
    return app.inject({ method: 'GET', url: `/challenges/${id}`,
      headers: actor ? { cookie: actor.cookie } : {} });
  }

  it('keeps guest credentials out of public summaries and requires identity and CSRF for writes', async () => {
    const owner = await guest();
    const restored = await app.inject({ url: '/guest-session', headers: { cookie: owner.cookie } });
    expect(restored.json()).toEqual({ csrfToken: owner.csrf });
    expect(restored.headers['set-cookie']).toBeUndefined();

    expect((await app.inject({ method: 'POST', url: '/challenges',
      headers: { 'idempotency-key': randomUUID() } })).statusCode).toBe(401);
    expect((await app.inject({ method: 'POST', url: '/challenges',
      headers: { cookie: owner.cookie, 'idempotency-key': randomUUID() } })).statusCode).toBe(403);
    expect((await app.inject({ method: 'POST', url: '/challenges',
      headers: { cookie: owner.cookie, 'x-csrf-token': owner.csrf,
        'idempotency-key': 'not-a-uuid' } })).statusCode).toBe(400);
    expect((await app.inject({ method: 'POST', url: '/challenges',
      headers: { cookie: owner.cookie, 'x-csrf-token': owner.csrf,
        'idempotency-key': randomUUID() }, payload: { side: 'black' } })).statusCode).toBe(400);

    const created = await create(owner);
    expect(created.statusCode).toBe(200);
    expect(created.json()).toMatchObject({ status: 'open', yourSeat: 'white',
      seats: { white: 'occupied', black: 'open' },
      game: { id: null, status: 'not_created', clocks: 'not_integrated',
        rated: false, initialMs: 300000, incrementMs: 3000 } });
    const body = created.body;
    expect(body).not.toContain(owner.cookie.split('=')[1]);
    expect(body).not.toContain(owner.csrf);
    expect(body).not.toContain('creator_guest_id');
    expect((await read(created.json().id)).statusCode).toBe(401);
    expect((await read(created.json().id, { cookie: `chess_guest=${'0'.repeat(64)}`, csrf: '' }))
      .statusCode).toBe(401);
    expect((await read('invalid-id', owner)).statusCode).toBe(400);
  });

  it('persists both seats, returns the same create and accept results on retries, and blocks outsiders', async () => {
    const owner = await guest();
    const joiner = await guest();
    const outsider = await guest();
    const requestId = randomUUID();
    const first = await create(owner, requestId);
    const repeated = await create(owner, requestId);
    expect(repeated.json().id).toBe(first.json().id);
    const id = first.json().id as string;
    expect((await read(id, outsider)).json().yourSeat).toBeNull();
    expect((await accept(id, owner)).statusCode).toBe(403);
    expect((await app.inject({ method: 'POST', url: `/challenges/${id}/accept`,
      headers: { cookie: joiner.cookie } })).statusCode).toBe(403);
    expect((await app.inject({ method: 'POST', url: `/challenges/${id}/accept`,
      headers: { cookie: joiner.cookie, 'x-csrf-token': joiner.csrf },
      payload: { side: 'white' } })).statusCode).toBe(400);

    const accepted = await accept(id, joiner);
    expect(accepted.statusCode).toBe(200);
    expect(accepted.json()).toMatchObject({ status: 'accepted', yourSeat: 'black',
      seats: { white: 'occupied', black: 'occupied' },
      game: { id, status: 'active', clocks: 'authoritative' } });
    expect((await accept(id, joiner)).json()).toEqual(accepted.json());
    expect((await read(id, owner)).json().yourSeat).toBe('white');
    expect((await read(id, joiner)).json().yourSeat).toBe('black');
    expect((await read(id, outsider)).statusCode).toBe(403);
    expect((await accept(id, outsider)).statusCode).toBe(409);
    expect((await accept(id, owner)).statusCode).toBe(403);
    const { rows } = await pool.query<{ creator_guest_id: string; acceptor_guest_id: string }>(
      'SELECT creator_guest_id, acceptor_guest_id FROM chess.challenges WHERE id = $1', [id]);
    expect(rows).toHaveLength(1);
    expect(rows[0]!.creator_guest_id).not.toBe(rows[0]!.acceptor_guest_id);
    expect((await pool.query('SELECT id FROM chess.games WHERE id = $1', [id])).rowCount).toBe(1);
    const restarted = buildApp(() => checkDatabase(pool), false, { pool, secureCookies: true });
    try {
      const afterRestart = await restarted.inject({ url: `/challenges/${id}`,
        headers: { cookie: joiner.cookie } });
      expect(afterRestart.json()).toEqual(accepted.json());
    } finally {
      await restarted.close();
    }
  });

  it('lets only one of two concurrent guests claim the open seat', async () => {
    const owner = await guest();
    const firstGuest = await guest();
    const secondGuest = await guest();
    const id = (await create(owner)).json().id as string;
    const [first, second] = await Promise.all([
      accept(id, firstGuest), accept(id, secondGuest),
    ]);
    expect([first.statusCode, second.statusCode].sort()).toEqual([200, 409]);
    const winner = first.statusCode === 200 ? firstGuest : secondGuest;
    const loser = first.statusCode === 409 ? firstGuest : secondGuest;
    expect((await read(id, winner)).json().yourSeat).toBe('black');
    expect((await read(id, loser)).statusCode).toBe(403);
    expect((await accept(id, winner)).statusCode).toBe(200);
    expect((await pool.query('SELECT id FROM chess.games WHERE id = $1', [id])).rowCount).toBe(1);
  });

  it('deduplicates concurrent create retries per guest without merging other guests', async () => {
    const owner = await guest();
    const other = await guest();
    const requestId = randomUUID();
    const [first, second, independent] = await Promise.all([
      create(owner, requestId), create(owner, requestId), create(other, requestId),
    ]);
    expect(first.statusCode).toBe(200);
    expect(second.statusCode).toBe(200);
    expect(first.json().id).toBe(second.json().id);
    expect(independent.json().id).not.toBe(first.json().id);
    const count = await pool.query<{ count: string }>(
      'SELECT count(*) FROM chess.challenges WHERE id = $1', [first.json().id]);
    expect(count.rows[0]!.count).toBe('1');
  });
});
