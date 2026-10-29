import type pg from 'pg';
import { cookieToken, tokenHash } from '../src/guest-session.js';

/** Seed a relationship that predates removal of guest claiming. Not an application action. */
export async function seedHistoricalGuestLink(pool: pg.Pool, cookie: string) {
  const token = cookieToken(cookie, 'chess_account');
  if (!token) throw new Error('The historical fixture needs an authenticated account.');
  const result = await pool.query(`UPDATE chess.guest_sessions g SET account_id = s.account_id
    FROM chess.account_sessions s WHERE s.token_hash = $1 AND g.id = s.guest_id
      AND NOT g.account_play_seat AND g.account_id IS NULL`, [tokenHash(token)]);
  if (result.rowCount !== 1) throw new Error('Expected one unlinked historical guest fixture.');
}
