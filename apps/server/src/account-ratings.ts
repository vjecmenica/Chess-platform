import type pg from 'pg';
import { ratingPools, type AccountRatingsResponse, type RatingDisplay, type RatingPool,
  type SettledGameRatings } from '@chess/contracts';
import { effectiveRatingDeviation, initialRatingState, isProvisionalRating, isRatingState } from '@chess/domain';
import type { RatingState } from '@chess/domain';

interface RatingRow {
  rating: number;
  rd: number;
  volatility: number;
  rated_games: number;
  last_rated_at: Date | null;
}

function ratingState(row: RatingRow): RatingState {
  const state = { rating: row.rating, rd: row.rd, volatility: row.volatility,
    ratedGames: row.rated_games, lastRatedAtMs: row.last_rated_at?.getTime() ?? null };
  if (!isRatingState(state)) throw new Error('Invalid stored account rating.');
  return state;
}

export function ratingDisplay(state: RatingState, asOf: number): RatingDisplay {
  return { rating: state.rating, provisional: isProvisionalRating(state, asOf) };
}

export async function accountRatings(pool: pg.Pool, accountId: string): Promise<AccountRatingsResponse> {
  const { rows } = await pool.query<RatingRow & { pool: RatingPool }>(`SELECT pool, rating, rd, volatility,
    rated_games, last_rated_at FROM chess.account_ratings WHERE account_id = $1`, [accountId]);
  const byPool = new Map(rows.map(row => [row.pool, ratingState(row)]));
  const now = Date.now();
  const read = (id: RatingPool) => {
    const state = byPool.get(id) ?? initialRatingState();
    const asOf = Math.max(now, state.lastRatedAtMs ?? 0);
    return { ...ratingDisplay(state, asOf), rd: effectiveRatingDeviation(state, asOf), ratedGames: state.ratedGames,
      lastRatedAt: state.lastRatedAtMs === null ? null : new Date(state.lastRatedAtMs).toISOString() };
  };
  return { accountId, ratings: Object.fromEntries(ratingPools.map(id => [id, read(id)])) as AccountRatingsResponse['ratings'] };
}

export async function currentPlayerRatings(client: pg.PoolClient, pool: RatingPool, white: string, black: string) {
  const { rows } = await client.query<RatingRow & { account_id: string }>(`SELECT account_id, rating, rd, volatility,
    rated_games, last_rated_at FROM chess.account_ratings WHERE pool = $1 AND account_id IN ($2, $3)`, [pool, white, black]);
  const byId = new Map(rows.map(row => [row.account_id, ratingState(row)]));
  const now = Date.now();
  const read = (accountId: string) => {
    const state = byId.get(accountId) ?? initialRatingState();
    return ratingDisplay(state, Math.max(now, state.lastRatedAtMs ?? 0));
  };
  return { source: 'current' as const, pool, players: { white: read(white), black: read(black) } };
}

export interface SettlementRatingsRow {
  pool: RatingPool;
  settled_at: Date | string;
  white_before: RatingState;
  white_after: RatingState;
  black_before: RatingState;
  black_after: RatingState;
}

export function settledGameRatings(row: SettlementRatingsRow): SettledGameRatings {
  const settledAt = new Date(row.settled_at).getTime();
  const player = (before: RatingState, after: RatingState) => ({
    before: ratingDisplay(before, settledAt), after: ratingDisplay(after, settledAt),
    change: after.rating - before.rating,
  });
  return { source: 'settlement', pool: row.pool, players: {
    white: player(row.white_before, row.white_after), black: player(row.black_before, row.black_after),
  } };
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
  return ratingState(row);
}
