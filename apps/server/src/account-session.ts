import type { FastifyRequest } from 'fastify';
import type pg from 'pg';
import { cookieToken, tokenHash, type GuestSession } from './guest-session.js';

export const accountCookie = 'chess_account';
export interface Account { id: string; username: string }

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
