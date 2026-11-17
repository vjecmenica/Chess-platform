import type pg from 'pg';
import type { RatingPool } from '@chess/contracts';
import { initialRatingState, isRatingState } from '@chess/domain';
import type { RatingState } from '@chess/domain';

interface RatingRow {
  rating: number;
  rd: number;
  volatility: number;
  rated_games: number;
  last_rated_at: Date | null;
}

/** Initialize only the requested pool, leaving any existing account and pool state intact. */
export function loadOrCreateAccountRating(db: pg.Pool | pg.PoolClient, accountId: string,
  pool: RatingPool): Promise<RatingState> {
  return loadRating(db, accountId, pool, false);
}

/** Initialize and lock this rating through the caller's transaction. */
export function lockAccountRating(client: pg.PoolClient, accountId: string, pool: RatingPool): Promise<RatingState> {
  return loadRating(client, accountId, pool, true);
}

async function loadRating(db: pg.Pool | pg.PoolClient, accountId: string, pool: RatingPool,
  lock: boolean): Promise<RatingState> {
  const read = () => db.query<RatingRow>(`SELECT rating, rd, volatility, rated_games, last_rated_at
    FROM chess.account_ratings WHERE account_id = $1 AND pool = $2${lock ? ' FOR NO KEY UPDATE' : ''}`, [accountId, pool]);
  let row = (await read()).rows[0];
  if (!row) {
    const initial = initialRatingState();
    const inserted = await db.query(`INSERT INTO chess.account_ratings
      (account_id, pool, rating, rd, volatility, rated_games, last_rated_at)
      VALUES ($1, $2, $3, $4, $5, $6, NULL)
      ON CONFLICT (account_id, pool) DO NOTHING`,
    [accountId, pool, initial.rating, initial.rd, initial.volatility, initial.ratedGames]);
    if (inserted.rowCount === 1) return initial;
    // A concurrent insert may be visible only to a fresh statement under READ COMMITTED.
    row = (await read()).rows[0];
  }
  if (!row) throw new Error('Account rating disappeared during initialization.');
  const state = { rating: row.rating, rd: row.rd, volatility: row.volatility,
    ratedGames: row.rated_games, lastRatedAtMs: row.last_rated_at?.getTime() ?? null };
  if (!isRatingState(state)) throw new Error('Invalid stored account rating.');
  return state;
}
