import { randomUUID } from 'node:crypto';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import type pg from 'pg';
import { databaseUrl, loadEnvironment } from '../src/config.js';
import { checkDatabase, createPool } from '../src/database.js';
import { migrate } from '../src/migrations.js';
import { buildApp } from '../src/app.js';

interface Guest { cookie: string; csrf: string }

describe('confirmed game update stream against PostgreSQL', () => {
  let pool: pg.Pool;
  const apps: FastifyInstance[] = [];

  beforeAll(async () => {
    loadEnvironment();
    pool = createPool(databaseUrl(process.env.TEST_DATABASE_URL, 'TEST_DATABASE_URL'));
    await checkDatabase(pool);
    await migrate(pool);
  });
  afterEach(async () => { for (const app of apps.splice(0)) await app.close(); });
  afterAll(async () => { if (pool) await pool.end(); });

  function app() {
    const server = buildApp(() => checkDatabase(pool), false, { pool, secureCookies: false });
    apps.push(server);
    return server;
  }

  async function guest(server: FastifyInstance): Promise<Guest> {
    const response = await server.inject('/guest-session');
    return { cookie: String(response.headers['set-cookie']).split(';')[0]!,
      csrf: response.json().csrfToken as string };
  }

  it('authorizes subscriptions and notifies the other server after a confirmed move', async () => {
    const writer = app();
    const readerServer = app();
    const white = await guest(writer);
    const black = await guest(writer);
    const outsider = await guest(writer);
    const created = await writer.inject({ method: 'POST', url: '/challenges',
      headers: { cookie: white.cookie, 'x-csrf-token': white.csrf, 'idempotency-key': randomUUID() } });
    const id = created.json().id as string;
    expect((await writer.inject({ method: 'POST', url: `/challenges/${id}/accept`,
      headers: { cookie: black.cookie, 'x-csrf-token': black.csrf } })).statusCode).toBe(200);
    expect((await readerServer.inject(`/games/${id}/events`)).statusCode).toBe(401);
    expect((await readerServer.inject({ url: `/games/${id}/events`,
      headers: { cookie: outsider.cookie } })).statusCode).toBe(403);

    const origin = await readerServer.listen({ host: '127.0.0.1', port: 0 });
    const abort = new AbortController();
    const timeout = setTimeout(() => abort.abort(), 2_000);
    try {
      const stream = await fetch(`${origin}/games/${id}/events`,
        { headers: { cookie: black.cookie }, signal: abort.signal });
      expect(stream.status).toBe(200);
      expect(stream.headers.get('content-type')).toContain('text/event-stream');
      const body = stream.body!.getReader();
      expect(new TextDecoder().decode((await body.read()).value)).toContain(': connected');

      const event = (async () => {
        let text = '';
        for (;;) {
          const chunk = await body.read();
          if (chunk.done) throw new Error('The confirmed game stream closed before a move arrived.');
          text += new TextDecoder().decode(chunk.value);
          const match = /event: game\ndata: (\{[^\n]+\})\n\n/.exec(text);
          if (match) return JSON.parse(match[1]!) as { version: number };
        }
      })();
      const move = await writer.inject({ method: 'POST', url: `/games/${id}/moves`,
        headers: { cookie: white.cookie, 'x-csrf-token': white.csrf,
          'idempotency-key': randomUUID() },
        payload: { expectedVersion: 0, from: 'e2', to: 'e4' } });
      expect(move.statusCode).toBe(200);
      expect(await event).toEqual({ version: 1 });
      const confirmed = await readerServer.inject({ url: `/games/${id}`,
        headers: { cookie: black.cookie } });
      expect(confirmed.json()).toMatchObject({ version: 1,
        position: { sideToMove: 'black' }, history: [{ from: 'e2', to: 'e4' }] });
    } finally {
      clearTimeout(timeout);
      abort.abort();
    }
  });
});
