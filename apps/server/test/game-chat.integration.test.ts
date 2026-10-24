import { randomUUID } from 'node:crypto';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import type pg from 'pg';
import type { GameChatHistory, GameChatMessage } from '@chess/contracts';
import { databaseUrl, loadEnvironment } from '../src/config.js';
import { checkDatabase, createPool } from '../src/database.js';
import { migrate } from '../src/migrations.js';
import { buildApp } from '../src/app.js';

interface Guest { cookie: string; csrf: string }
describe('participant game chat against PostgreSQL', () => {
  let pool: pg.Pool;
  const apps: FastifyInstance[] = [];
  beforeAll(async () => {
    loadEnvironment();
    pool = createPool(databaseUrl(process.env.TEST_DATABASE_URL, 'TEST_DATABASE_URL'));
    await migrate(pool);
  });
  afterEach(async () => { for (const server of apps.splice(0)) await server.close(); });
  afterAll(async () => { await pool?.end(); });
  function app() {
    const server = buildApp(() => checkDatabase(pool), false, { pool, secureCookies: false });
    apps.push(server);
    return server;
  }
  async function guest(server: FastifyInstance): Promise<Guest> {
    const response = await server.inject('/guest-session');
    return { cookie: String(response.headers['set-cookie']).split(';')[0]!, csrf: response.json().csrfToken as string };
  }
  const headers = (who: Guest, requestId = randomUUID()) => ({ cookie: who.cookie,
    'x-csrf-token': who.csrf, 'idempotency-key': requestId });
  async function setup() {
    const server = app();
    const white = await guest(server), black = await guest(server), outsider = await guest(server);
    const created = await server.inject({ method: 'POST', url: '/challenges', headers: headers(white) });
    const id = created.json().id as string;
    await server.inject({ method: 'POST', url: `/challenges/${id}/accept`, headers: headers(black) });
    return { server, white, black, outsider, id, url: `/games/${id}/chat` };
  }
  function send(server: FastifyInstance, url: string, who: Guest, text: string, requestId = randomUUID()) {
    return server.inject({ method: 'POST', url, headers: headers(who, requestId), payload: { text } });
  }

  it('requires participant sessions and CSRF, validates text, and derives the sender on the server', async () => {
    const { server, white, black, outsider, url } = await setup();
    expect((await server.inject(url)).statusCode).toBe(401);
    expect((await server.inject({ url, headers: { cookie: outsider.cookie } })).statusCode).toBe(403);
    expect((await send(server, url, outsider, 'Hello')).statusCode).toBe(403);
    expect((await server.inject({ method: 'POST', url, headers: { cookie: white.cookie,
      'idempotency-key': randomUUID() }, payload: { text: 'Hello' } })).statusCode).toBe(403);
    for (const text of ['', ' \n\t ', 'x'.repeat(501)]) {
      expect((await send(server, url, white, text)).statusCode).toBe(400);
    }
    expect((await server.inject({ method: 'POST', url, headers: headers(white),
      payload: { text: 'Spoof', side: 'black' } })).statusCode).toBe(400);
    const sent = await send(server, url, white, '  <script>alert(1)</script>  ');
    expect(sent.statusCode).toBe(201);
    expect(sent.json()).toMatchObject({ side: 'white', text: '<script>alert(1)</script>' });
    const history = await server.inject({ url, headers: { cookie: black.cookie } });
    expect(history.json<GameChatHistory>()).toMatchObject({ canSend: true, messages: [sent.json()] });
    expect((await server.inject({ url: `${url}?after=9999999999999999999`,
      headers: { cookie: white.cookie } })).statusCode).toBe(400);
    expect((await server.inject({ url: `${url}?limit=100000`,
      headers: { cookie: white.cookie } })).statusCode).toBe(400);
  });

  it('preserves concurrent retry protection and independent rate limits after a game finishes', async () => {
    const { server, white, black, id, url } = await setup();
    expect((await server.inject({ method: 'POST', url: `/games/${id}/resign`,
      headers: headers(white), payload: { expectedVersion: 0 } })).statusCode).toBe(200);
    const otherServer = app();
    const requestId = randomUUID();
    const replies = await Promise.all([send(server, url, white, 'Hello', requestId),
      send(otherServer, url, white, 'Hello', requestId)]);
    expect(replies.map(reply => reply.statusCode).sort()).toEqual([200, 201]);
    expect(replies[0]!.json()).toEqual(replies[1]!.json());
    expect((await send(server, url, white, 'Different', requestId)).statusCode).toBe(409);
    const burst = await Promise.all(Array.from({ length: 5 }, (_, i) => send(otherServer, url, white, `More ${i}`)));
    expect(burst.filter(reply => reply.statusCode === 201)).toHaveLength(4);
    expect(burst.find(reply => reply.statusCode === 429)?.headers['retry-after']).toBe('10');
    expect((await send(server, url, black, 'Reply')).statusCode).toBe(201);
    const history = (await server.inject({ url, headers: { cookie: white.cookie } })).json<GameChatHistory>();
    expect(history.messages).toHaveLength(6);
    expect(history.messages.map(item => BigInt(item.id))).toEqual(history.messages.map(item => BigInt(item.id)).sort((a, b) => a < b ? -1 : 1));
    expect((await server.inject({ url: `/games/${id}`, headers: { cookie: white.cookie } })).json().version).toBe(1);
  });

  it('restores bounded ordered history after restart and preserves successful retries after finalization', async () => {
    const { server, white, black, outsider, id, url } = await setup();
    const requestId = randomUUID();
    const first = (await send(server, url, white, 'Good luck', requestId)).json<GameChatMessage>();
    const second = (await send(server, url, black, 'You too')).json<GameChatMessage>();
    await server.close();
    const restarted = app();
    expect((await restarted.inject({ url: `${url}?after=${first.id}`, headers: { cookie: white.cookie } }))
      .json<GameChatHistory>().messages).toEqual([second]);
    const resignation = await restarted.inject({ method: 'POST', url: `/games/${id}/resign`,
      headers: headers(white), payload: { expectedVersion: 0 } });
    expect(resignation.statusCode).toBe(200);
    const conversation = [first, second];
    for (const who of [white, black]) {
      expect((await restarted.inject({ url, headers: { cookie: who.cookie } })).json<GameChatHistory>())
        .toEqual({ canSend: true, messages: [...conversation] });
      const response = await send(restarted, url, who, 'Well played');
      expect(response.statusCode).toBe(201);
      conversation.push(response.json<GameChatMessage>());
    }
    for (const who of [white, black]) expect((await restarted.inject({ url, headers: { cookie: who.cookie } }))
      .json<GameChatHistory>()).toEqual({ canSend: true, messages: conversation });
    expect((await send(restarted, url, outsider, 'Spectator')).statusCode).toBe(403);
    expect((await restarted.inject({ url, headers: { cookie: outsider.cookie } })).statusCode).toBe(403);
    expect((await send(restarted, url, white, 'Good luck', requestId)).json()).toEqual(first);
    // Seed synthetic history to exercise the fixed API cap without relaxing the send rate limit.
    await pool.query(`INSERT INTO chess.game_chat_messages (game_id, sender_side, request_id, body)
      SELECT $1, 'white', gen_random_uuid(), 'Earlier ' || n FROM generate_series(1, 110) n`, [id]);
    expect((await restarted.inject({ url, headers: { cookie: white.cookie } })).json<GameChatHistory>().messages).toHaveLength(100);
  });

  it('orders sends against finalization without changing the game version', async () => {
    const { server, white, black, id, url } = await setup();
    const [sent, finished] = await Promise.all([send(server, url, black, 'Last message'),
      server.inject({ method: 'POST', url: `/games/${id}/resign`, headers: headers(white), payload: { expectedVersion: 0 } })]);
    expect(sent.statusCode).toBe(201);
    expect(finished.statusCode).toBe(200);
    const history = (await server.inject({ url, headers: { cookie: black.cookie } })).json<GameChatHistory>();
    expect(history.canSend).toBe(true);
    expect(history.messages).toHaveLength(1);
    expect((await server.inject({ url: `/games/${id}`, headers: { cookie: black.cookie } })).json().version).toBe(1);
  });

  it.each(['active', 'finished'])('delivers private committed events and reconnect history in a %s game', async status => {
    const { server, white, black, outsider, id, url } = await setup();
    if (status === 'finished') expect((await server.inject({ method: 'POST', url: `/games/${id}/resign`,
      headers: headers(white), payload: { expectedVersion: 0 } })).statusCode).toBe(200);
    const reader = app();
    expect((await reader.inject({ url: `/games/${id}/events`, headers: { cookie: outsider.cookie } })).statusCode).toBe(403);
    const origin = await reader.listen({ host: '127.0.0.1', port: 0 });
    const abort = new AbortController();
    const timeout = setTimeout(() => abort.abort(), 3000);
    try {
      const response = await fetch(`${origin}/games/${id}/events`, { headers: { cookie: black.cookie }, signal: abort.signal });
      const body = response.body!.getReader();
      await body.read();
      const first = (await send(server, url, white, 'Pushed')).json<GameChatMessage>();
      let text = '';
      while (!text.includes('event: chat')) text += new TextDecoder().decode((await body.read()).value);
      expect(text).toContain(`event: chat\ndata: ${JSON.stringify({ messageId: first.id })}`);
      expect(text).not.toContain('event: game');
      expect((await reader.inject({ url, headers: { cookie: black.cookie } })).json<GameChatHistory>().messages).toEqual([first]);
      abort.abort();
      const missed = (await send(server, url, white, 'While disconnected')).json<GameChatMessage>();
      expect((await reader.inject({ url: `${url}?after=${first.id}`, headers: { cookie: black.cookie } }))
        .json<GameChatHistory>().messages).toEqual([missed]);
    } finally { clearTimeout(timeout); abort.abort(); }
  });

  it.each(['checkmate', 'agreement', 'timeout'])('allows both original seats to chat after a %s result', async reason => {
    const { server, white, black, outsider, id, url } = await setup();
    // Chat permissions depend on the durable final status, not the chess result reason.
    const result = reason === 'agreement' ? { outcome: 'draw', reason } : { outcome: 'win', winner: 'black', reason };
    await pool.query(`UPDATE chess.games SET status = 'finished', result = $2::jsonb, clock_phase = 'stopped',
      white_first_move_deadline_at = NULL WHERE id = $1`, [id, JSON.stringify(result)]);
    for (const who of [white, black]) {
      expect((await server.inject({ url, headers: { cookie: who.cookie } })).json<GameChatHistory>().canSend).toBe(true);
      expect((await send(server, url, who, 'Post-game conversation')).statusCode).toBe(201);
    }
    expect((await server.inject({ url, headers: { cookie: white.cookie } })).json<GameChatHistory>().messages
      .map(item => item.side)).toEqual(['white', 'black']);
    expect((await send(server, url, outsider, 'Public comment')).statusCode).toBe(403);
    expect((await server.inject({ url, headers: { cookie: outsider.cookie } })).statusCode).toBe(403);
    expect((await server.inject({ method: 'POST', url, headers: { cookie: white.cookie,
      'idempotency-key': randomUUID() }, payload: { text: 'Missing CSRF' } })).statusCode).toBe(403);
  });

  it.each(['waiting', 'pending_adjudication', 'aborted'])('keeps %s games read-only while preserving history and receipts', async status => {
    const { server, white, black, outsider, id, url } = await setup();
    const requestId = randomUUID();
    const original = (await send(server, url, white, 'Existing history', requestId)).json<GameChatMessage>();
    await pool.query(`UPDATE chess.games SET status = $2, result = $3::jsonb, clock_phase = 'stopped',
      white_first_move_deadline_at = NULL WHERE id = $1`,
    [id, status, status === 'aborted' ? JSON.stringify({ outcome: 'aborted', reason: 'first_move_deadline' }) : null]);
    for (const who of [white, black]) {
      expect((await server.inject({ url, headers: { cookie: who.cookie } })).json<GameChatHistory>())
        .toEqual({ canSend: false, messages: [original] });
      const response = await send(server, url, who, 'Not allowed');
      expect(response.statusCode).toBe(409);
      expect(response.json().error).toBe('chat_read_only');
    }
    expect((await send(server, url, white, 'Existing history', requestId)).json()).toEqual(original);
    expect((await send(server, url, outsider, 'Still private')).statusCode).toBe(403);
  });
});
