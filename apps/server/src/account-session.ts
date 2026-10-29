import type { FastifyRequest } from 'fastify';
import type pg from 'pg';
import { randomBytes, randomUUID } from 'node:crypto';
import { cookieToken, tokenHash, type GuestSession } from './guest-session.js';

export const accountCookie = 'chess_account';
export interface Account { id: string; username: string }

/** Called inside the challenge transaction; lock order matches login. */
export async function newChallengeSeat(client: pg.PoolClient, request: FastifyRequest,
  guest: GuestSession): Promise<string> {
  const account = await currentAccount(client, request, guest);
  if (account) await client.query('SELECT id FROM chess.accounts WHERE id = $1 FOR UPDATE', [account.id]);
  const locked = (await client.query<{ account_id: string | null; csrf_token: string }>(
    'SELECT account_id, csrf_token FROM chess.guest_sessions WHERE id = $1 FOR UPDATE', [guest.id])).rows[0]!;
  if (locked.csrf_token !== guest.csrfToken)
    throw Object.assign(new Error('The browser session changed. Refresh and try again.'), { statusCode: 409 });
  const confirmed = await currentAccount(client, request, guest);
  if (confirmed?.id !== account?.id || (!account && locked.account_id !== null))
    throw Object.assign(new Error('Sign in again before occupying a new seat.'), { statusCode: 401 });
  if (!account) return guest.id;
  const existing = (await client.query<{ id: string }>(
    'SELECT id FROM chess.guest_sessions WHERE account_id = $1 AND account_play_seat', [account.id])).rows[0];
  if (existing) return existing.id;
  const id = randomUUID();
  // These random bearer values are never issued to a browser. Access requires an account session.
  await client.query(`INSERT INTO chess.guest_sessions
    (id, token_hash, csrf_token, expires_at, account_id, account_play_seat)
    VALUES ($1, $2, $3, now() + interval '30 days', $4, true)`,
  [id, tokenHash(randomBytes(32).toString('hex')), randomBytes(32).toString('hex'), account.id]);
  return id;
}

export async function currentAccount(pool: Pick<pg.Pool, 'query'>, request: FastifyRequest,
  guest: GuestSession): Promise<Account | null> {
  const token = cookieToken(request.headers.cookie, accountCookie);
  if (!token) return null;
  const { rows } = await pool.query<Account>(`SELECT a.id, a.username FROM chess.account_sessions s
    JOIN chess.accounts a ON a.id = s.account_id
    WHERE s.token_hash = $1 AND s.guest_id = $2 AND s.expires_at > now()`, [tokenHash(token), guest.id]);
  return rows[0] ?? null;
}

/** Resolve to the original guest seat so durable receipt identities never change. */
export async function participantGuestId(pool: Pick<pg.Pool, 'query'>, request: FastifyRequest,
  guest: GuestSession, gameId: string): Promise<string> {
  const account = await currentAccount(pool, request, guest);
  if (!account) return guest.id;
  const { rows } = await pool.query<{ id: string }>(`SELECT s.id FROM chess.challenges c
    JOIN chess.guest_sessions s ON s.id IN (c.creator_guest_id, c.acceptor_guest_id)
    WHERE c.id = $1 AND (s.id = $2 OR s.account_id = $3)
    ORDER BY (s.id = $2) DESC LIMIT 1`, [gameId, guest.id, account.id]);
  return rows[0]?.id ?? guest.id;
}
