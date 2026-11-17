import type pg from 'pg';
import { isTimeControlId, ratingPoolByTimeControl, type RatingPool } from '@chess/contracts';
import { rateGame, type GameResult, type RatingState } from '@chess/domain';
import { lockAccountRating } from './account-ratings.js';

const policyVersion = 'glicko2-immediate-v1';

interface SavedResult {
  rated: boolean;
  status: string;
  result: GameResult | null;
  rated_white_account_id: string | null;
  rated_black_account_id: string | null;
  rating_pool: RatingPool | null;
  time_control: string;
}

async function saveRating(client: pg.PoolClient, accountId: string, pool: RatingPool,
  state: RatingState, settledAt: Date): Promise<void> {
  const updated = await client.query(`UPDATE chess.account_ratings
    SET rating = $3, rd = $4, volatility = $5, rated_games = $6, last_rated_at = $7
    WHERE account_id = $1 AND pool = $2`, [accountId, pool, state.rating, state.rd, state.volatility,
    state.ratedGames, settledAt]);
  if (updated.rowCount !== 1) throw new Error('Locked rating row is missing.');
}

/** Settle the saved authoritative result in the caller's Read Committed game transaction. */
export async function settleGameRatings(client: pg.PoolClient, gameId: string): Promise<boolean> {
  const game = (await client.query<SavedResult>(`SELECT g.rated, g.status, g.result, g.rated_white_account_id,
    g.rated_black_account_id, g.rating_pool, c.time_control
    FROM chess.games g JOIN chess.challenges c ON c.id = g.id WHERE g.id = $1 FOR NO KEY UPDATE OF g`,
  [gameId])).rows[0];
  if (!game?.rated || game.status !== 'finished' || !game.result || game.result.outcome === 'aborted') return false;
  // Read after acquiring the game lock so a waiting retry sees any preceding commit.
  if ((await client.query('SELECT 1 FROM chess.game_rating_settlements WHERE game_id = $1', [gameId])).rowCount) {
    return false;
  }

  const { rated_white_account_id: whiteId, rated_black_account_id: blackId, rating_pool: pool,
    time_control: control, result } = game;
  // The frozen account IDs are protected by foreign keys on the game.
  if (!whiteId || !blackId || whiteId === blackId || !isTimeControlId(control) || pool !== ratingPoolByTimeControl[control]) {
    throw new Error('Invalid rated game terms.');
  }
  if (result.outcome !== 'draw' && (result.outcome !== 'win' || (result.winner !== 'white' && result.winner !== 'black'))) {
    throw new Error('Invalid rated game result.');
  }
  const whiteScore = result.outcome === 'draw' ? 0.5 : result.winner === 'white' ? 1 : 0;

  // Initialize and lock each account in UUID order before touching the next account.
  const whiteFirst = whiteId < blackId;
  const first = await lockAccountRating(client, whiteFirst ? whiteId : blackId, pool);
  const second = await lockAccountRating(client, whiteFirst ? blackId : whiteId, pool);
  const [whiteBefore, blackBefore] = whiteFirst ? [first, second] : [second, first];

  // Sample the database clock after both locks. Preserve monotonic anchors across clock corrections.
  const now = (await client.query<{ now: Date }>('SELECT clock_timestamp() AS now')).rows[0]!.now.getTime();
  const atMs = Math.max(now, whiteBefore.lastRatedAtMs ?? 0, blackBefore.lastRatedAtMs ?? 0);
  const settledAt = new Date(atMs);
  const [whiteAfter, blackAfter] = rateGame(whiteBefore, blackBefore, whiteScore, atMs);
  await saveRating(client, whiteId, pool, whiteAfter, settledAt);
  await saveRating(client, blackId, pool, blackAfter, settledAt);
  await client.query(`INSERT INTO chess.game_rating_settlements
    (game_id, pool, white_account_id, black_account_id, final_result, white_before, white_after,
      black_before, black_after, settled_at, policy_version)
    VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)`,
  [gameId, pool, whiteId, blackId, result, whiteBefore, whiteAfter, blackBefore, blackAfter, settledAt, policyVersion]);
  return true;
}
