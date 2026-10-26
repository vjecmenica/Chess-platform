import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { hash, verify } from '@node-rs/argon2';
import type { FastifyInstance } from 'fastify';
import type pg from 'pg';
import { accountGames, parseGameCursor } from './account-games.js';
import { accountCookie, currentAccount, type Account } from './account-session.js';
import { cookieToken, createGuest, requireGuest, rotateGuest, setSessionCookie, tokenHash } from './guest-session.js';

const passwordOptions = { algorithm: 2 as const, memoryCost: 19456, timeCost: 2, parallelism: 1 };
// One dummy hash per process makes unknown-user logins take the same hashing path.
let dummyHash: Promise<string> | undefined;
const credentials = { type: 'object', required: ['username', 'password'], additionalProperties: false,
  properties: { username: { type: 'string', pattern: '^[A-Za-z0-9_]{3,24}$' },
    password: { type: 'string', minLength: 15, maxLength: 128 } } } as const;

async function rateAllowed(pool: pg.Pool, key: string, limit: number): Promise<boolean> {
  const keyHash = createHash('sha256').update(key).digest();
  const { rows } = await pool.query<{ attempts: number }>(`INSERT INTO chess.account_auth_limits
    (key_hash, attempts, resets_at) VALUES ($1, 1, now() + interval '15 minutes')
    ON CONFLICT (key_hash) DO UPDATE SET
      attempts = CASE WHEN account_auth_limits.resets_at <= now() THEN 1 ELSE account_auth_limits.attempts + 1 END,
      resets_at = CASE WHEN account_auth_limits.resets_at <= now() THEN now() + interval '15 minutes'
        ELSE account_auth_limits.resets_at END RETURNING attempts`, [keyHash]);
  return rows[0]!.attempts <= limit;
}

export function registerAccountRoutes(app: FastifyInstance, pool: pg.Pool, secure: boolean): void {
  app.get('/account', async (request, reply) => {
    reply.header('Cache-Control', 'no-store');
    const guest = await requireGuest(pool, request, reply);
    if (!guest) return;
    const account = await currentAccount(pool, request, guest);
    const owner = (await pool.query<{ account_id: string | null }>(
      'SELECT account_id FROM chess.guest_sessions WHERE id = $1', [guest.id])).rows[0]!;
    return { account, guestLinked: account !== null && owner.account_id === account.id };
  });

  for (const mode of ['register', 'login'] as const) {
    app.post<{ Body: { username: string; password: string } }>(`/account/${mode}`,
      { schema: { body: credentials }, bodyLimit: 4096 }, async (request, reply) => {
        reply.header('Cache-Control', 'no-store');
        const guest = await requireGuest(pool, request, reply, true);
        if (!guest) return;
        const username = request.body.username.toLowerCase();
        // Durable, cross-process limits. Do not trust forwarded IPs without a reviewed proxy configuration.
        const ipAllowed = await rateAllowed(pool, `ip:${request.ip}`, 30);
        const nameAllowed = await rateAllowed(pool, `name:${username}`, 10);
        if (!ipAllowed || !nameAllowed) {
          reply.header('Retry-After', '900');
          return reply.code(429).send({ error: 'account_rate_limited' });
        }
        let account: Account | null = null;
        let passwordHash: string | null = null;
        if (mode === 'register') {
          passwordHash = await hash(request.body.password, passwordOptions);
        } else {
          const row = (await pool.query<Account & { password_hash: string }>(
            'SELECT id, username, password_hash FROM chess.accounts WHERE username = $1', [username])).rows[0];
          dummyHash ??= hash(randomBytes(32).toString('hex'), passwordOptions);
          const valid = await verify(row?.password_hash ?? await dummyHash, request.body.password);
          if (!row || !valid) return reply.code(401).send({ error: 'invalid_credentials' });
          account = { id: row.id, username: row.username };
        }
        const client = await pool.connect();
        try {
          await client.query('BEGIN');
          // Serialize logins/linking on this bearer session and reject an already rotated request.
          const locked = (await client.query<{ account_id: string | null; csrf_token: string }>(
            'SELECT account_id, csrf_token FROM chess.guest_sessions WHERE id = $1 FOR UPDATE', [guest.id])).rows[0]!;
          if (locked.csrf_token !== guest.csrfToken) return reply.code(409).send({ error: 'session_changed' });
          if (mode === 'register') {
            const { rows } = await client.query<Account>(`INSERT INTO chess.accounts (id, username, password_hash)
              VALUES ($1, $2, $3) ON CONFLICT (username) DO NOTHING RETURNING id, username`,
            [randomUUID(), username, passwordHash]);
            if (!rows[0]) return reply.code(409).send({ error: 'username_unavailable' });
            account = rows[0];
          }
          if (!account) throw new Error('An authenticated account was not established.');
          const previous = cookieToken(request.headers.cookie, accountCookie);
          if (previous) await client.query('DELETE FROM chess.account_sessions WHERE token_hash = $1', [tokenHash(previous)]);
          // Switching accounts must not carry the previous account's guest bearer into the new session.
          const nextGuest = locked.account_id !== null && locked.account_id !== account.id
            ? await createGuest(client, reply, secure) : await rotateGuest(client, reply, secure, guest);
          if (nextGuest.id !== guest.id) await client.query(`UPDATE chess.guest_sessions
            SET token_hash = $2, csrf_token = $3 WHERE id = $1`,
          [guest.id, tokenHash(randomBytes(32).toString('hex')), randomBytes(32).toString('hex')]);
          const token = randomBytes(32).toString('hex');
          await client.query(`INSERT INTO chess.account_sessions (token_hash, account_id, guest_id, expires_at)
            VALUES ($1, $2, $3, now() + interval '30 days')`, [tokenHash(token), account.id, nextGuest.id]);
          await client.query('COMMIT');
          setSessionCookie(reply, accountCookie, token, secure);
          return { account, csrfToken: nextGuest.csrfToken };
        } finally {
          try { await client.query('ROLLBACK'); } finally { client.release(); }
        }
      });
  }

  app.post('/account/link-guest', async (request, reply) => {
    reply.header('Cache-Control', 'no-store');
    const guest = await requireGuest(pool, request, reply, true);
    if (!guest) return;
    if (request.body !== undefined) return reply.code(400).send({ error: 'unexpected_body' });
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      const account = await currentAccount(client, request, guest);
      if (!account) return reply.code(401).send({ error: 'account_required' });
      // A single account lock orders links from different browsers, including opposite seats.
      await client.query('SELECT id FROM chess.accounts WHERE id = $1 FOR UPDATE', [account.id]);
      const owner = (await client.query<{ account_id: string | null; csrf_token: string }>(
        'SELECT account_id, csrf_token FROM chess.guest_sessions WHERE id = $1 FOR UPDATE', [guest.id])).rows[0]!;
      if (owner.csrf_token !== guest.csrfToken) return reply.code(409).send({ error: 'session_changed' });
      if (owner.account_id !== null && owner.account_id !== account.id)
        return reply.code(409).send({ error: 'guest_already_linked' });
      const conflict = await client.query(`SELECT c.id FROM chess.challenges c
        JOIN chess.guest_sessions other ON other.id = CASE WHEN c.creator_guest_id = $1
          THEN c.acceptor_guest_id ELSE c.creator_guest_id END
        WHERE (c.creator_guest_id = $1 OR c.acceptor_guest_id = $1)
          AND other.account_id = $2 LIMIT 1`, [guest.id, account.id]);
      if (conflict.rowCount) return reply.code(409).send({ error: 'opposite_seat_linked' });
      await client.query('UPDATE chess.guest_sessions SET account_id = $2 WHERE id = $1', [guest.id, account.id]);
      // Seat display metadata changed; refresh connected participants without changing move versions.
      if (owner.account_id === null) await client.query(`SELECT pg_notify('chess_game_updates',
        json_build_object('id', g.id, 'version', g.version)::text)
        FROM chess.games g JOIN chess.challenges c ON c.id = g.id
        WHERE c.creator_guest_id = $1 OR c.acceptor_guest_id = $1`, [guest.id]);
      await client.query('COMMIT');
      return { account, guestLinked: true };
    } finally {
      try { await client.query('ROLLBACK'); } finally { client.release(); }
    }
  });

  app.post('/account/logout', async (request, reply) => {
    reply.header('Cache-Control', 'no-store');
    const guest = await requireGuest(pool, request, reply, true);
    if (!guest) return;
    if (request.body !== undefined) return reply.code(400).send({ error: 'unexpected_body' });
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      const owner = (await client.query<{ account_id: string | null; csrf_token: string }>(
        'SELECT account_id, csrf_token FROM chess.guest_sessions WHERE id = $1 FOR UPDATE', [guest.id])).rows[0]!;
      if (owner.csrf_token !== guest.csrfToken) return reply.code(409).send({ error: 'session_changed' });
      const token = cookieToken(request.headers.cookie, accountCookie);
      if (token) await client.query('DELETE FROM chess.account_sessions WHERE token_hash = $1', [tokenHash(token)]);
      const nextGuest = owner.account_id !== null ? await createGuest(client, reply, secure)
        : await rotateGuest(client, reply, secure, guest);
      // Invalidate the linked guest bearer too; otherwise logout could retain the same private seat.
      if (owner.account_id !== null) await client.query(`UPDATE chess.guest_sessions
        SET token_hash = $2, csrf_token = $3 WHERE id = $1`,
      [guest.id, tokenHash(randomBytes(32).toString('hex')), randomBytes(32).toString('hex')]);
      await client.query('COMMIT');
      setSessionCookie(reply, accountCookie, '', secure, 0);
      return { account: null, csrfToken: nextGuest.csrfToken };
    } finally {
      try { await client.query('ROLLBACK'); } finally { client.release(); }
    }
  });

  app.get<{ Querystring: { before?: string } }>('/account/games', { schema: { querystring: {
    type: 'object', additionalProperties: false, properties: { before: { type: 'string', minLength: 1, maxLength: 256 } },
  } } }, async (request, reply) => {
    reply.header('Cache-Control', 'no-store');
    const guest = await requireGuest(pool, request, reply);
    if (!guest) return;
    const account = await currentAccount(pool, request, guest);
    if (!account) return reply.code(401).send({ error: 'account_required' });
    let cursor;
    try { cursor = parseGameCursor(request.query.before); }
    catch { return reply.code(400).send({ error: 'invalid_game_cursor' }); }
    return accountGames(pool, account, cursor);
  });
}
