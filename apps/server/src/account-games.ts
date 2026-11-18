import type pg from 'pg';
import type { AccountGame, AccountGames, AccountGamesFilter, AccountIdentity } from '@chess/contracts';
import { settledGameRatings, type SettlementRatingsRow } from './account-ratings.js';

interface Cursor { createdAt: string; id: string }
export function parseGameCursor(value: string | undefined): Cursor | null {
  if (value === undefined) return null;
  try {
    const cursor = JSON.parse(Buffer.from(value, 'base64url').toString('utf8')) as Cursor;
    if (!cursor || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{6}Z$/.test(cursor.createdAt)
      || cursor.createdAt.startsWith('0000') || !Number.isFinite(Date.parse(cursor.createdAt))
      || new Date(cursor.createdAt).toISOString().slice(0, 23) !== cursor.createdAt.slice(0, 23)
      || !/^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/.test(cursor.id)) throw new Error();
    return { createdAt: cursor.createdAt, id: cursor.id };
  } catch { throw new Error('invalid_game_cursor'); }
}

// Rated ownership comes from the saved accounts. Casual games retain historical guest linking.
const accountSeats = `
  SELECT g.id, 'white'::text AS side FROM chess.guest_sessions s
  JOIN chess.challenges c ON c.creator_guest_id = s.id JOIN chess.games g ON g.id = c.id
  WHERE s.account_id = $1 AND NOT g.rated
  UNION ALL
  SELECT g.id, 'black'::text AS side FROM chess.guest_sessions s
  JOIN chess.challenges c ON c.acceptor_guest_id = s.id JOIN chess.games g ON g.id = c.id
  WHERE s.account_id = $1 AND NOT g.rated
  UNION ALL
  SELECT id, 'white'::text FROM chess.games WHERE rated AND rated_white_account_id = $1
  UNION ALL
  SELECT id, 'black'::text FROM chess.games WHERE rated AND rated_black_account_id = $1`;

export async function accountGames(pool: pg.Pool, account: AccountIdentity, cursor: Cursor | null,
  filter: AccountGamesFilter): Promise<AccountGames> {
  // Both the page and summary use one statement/snapshot.
  type ArchiveRow = Omit<AccountGame, 'playerRatings'> & { settlement: SettlementRatingsRow | null };
  const { rows } = await pool.query<{ games: ArchiveRow[]; summary: AccountGames['summary'] }>(`
    WITH seats AS (${accountSeats}), owned AS (
      SELECT DISTINCT ON (s.id) s.id, c.created_at, s.side, g.status, g.result, g.rated,
        CASE WHEN s.side = 'white' THEN c.acceptor_guest_id ELSE c.creator_guest_id END AS opponent_seat,
        CASE WHEN s.side = 'white' THEN g.rated_black_account_id ELSE g.rated_white_account_id END AS rated_opponent,
        CASE WHEN g.clock_mode = 'legacy_untimed' THEN NULL ELSE c.time_control END AS time_control
      FROM seats s JOIN chess.games g ON g.id = s.id JOIN chess.challenges c ON c.id = s.id
      ORDER BY s.id, s.side DESC
    ), page AS (
      SELECT o.*, f.game_id IS NOT NULL AS favorite FROM owned o
      LEFT JOIN chess.account_game_favorites f ON f.account_id = $1 AND f.game_id = o.id
      WHERE ($2::timestamptz IS NULL OR (o.created_at, o.id) < ($2::timestamptz, $3::uuid))
        AND (NOT $4::boolean OR f.game_id IS NOT NULL)
      ORDER BY o.created_at DESC, o.id DESC LIMIT 21
    )
    SELECT (SELECT COALESCE(jsonb_agg(jsonb_build_object(
      'id', p.id, 'side', p.side, 'createdAt', to_char(p.created_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"'),
      'status', p.status, 'result', p.result, 'opponent', a.username, 'timeControl', p.time_control,
      'favorite', p.favorite, 'rated', p.rated, 'settlement', to_jsonb(s))
      ORDER BY p.created_at DESC, p.id DESC), '[]') FROM page p
      JOIN chess.guest_sessions opponent_guest ON opponent_guest.id = p.opponent_seat
      LEFT JOIN chess.accounts a ON a.id = COALESCE(p.rated_opponent, opponent_guest.account_id)
      LEFT JOIN chess.game_rating_settlements s ON s.game_id = p.id AND p.rated AND p.status = 'finished') AS games,
      jsonb_build_object(
        'wins', count(*) FILTER (WHERE status = 'finished' AND result->>'outcome' = 'win' AND result->>'winner' = side),
        'draws', count(*) FILTER (WHERE status = 'finished' AND result->>'outcome' = 'draw'),
        'losses', count(*) FILTER (WHERE status = 'finished' AND result->>'outcome' = 'win' AND result->>'winner' <> side)
      ) AS summary FROM owned`, [account.id, cursor?.createdAt ?? null, cursor?.id ?? null, filter === 'favorites']);
  const { games, summary } = rows[0]!;
  const last = games[19];
  // Keep all six PostgreSQL fractional digits; Date.toISOString() would lose cursor precision.
  const next = games.length > 20 && last
    ? Buffer.from(JSON.stringify({ createdAt: last.createdAt, id: last.id })).toString('base64url') : null;
  return { account, games: games.slice(0, 20).map(({ settlement, ...game }) => ({
    ...game, playerRatings: settlement ? settledGameRatings(settlement) : null,
  })), summary, next };
}

/** A missing row means the account has no linked seat in this game. */
export async function accountGameFavorite(pool: pg.Pool, accountId: string, gameId: string,
  method: 'GET' | 'PUT' | 'DELETE'): Promise<boolean | null> {
  const owned = `WITH seats AS (${accountSeats}), owned AS (
    SELECT id FROM seats WHERE id = $2 LIMIT 1
  )`;
  const query = method === 'GET' ? `${owned}
    SELECT EXISTS (SELECT 1 FROM chess.account_game_favorites WHERE account_id = $1 AND game_id = owned.id) AS favorite
    FROM owned` : method === 'PUT' ? `${owned}, added AS (
    INSERT INTO chess.account_game_favorites (account_id, game_id) SELECT $1, id FROM owned
    ON CONFLICT (account_id, game_id) DO NOTHING
  ) SELECT true AS favorite FROM owned` : `${owned}, removed AS (
    DELETE FROM chess.account_game_favorites WHERE account_id = $1 AND game_id IN (SELECT id FROM owned)
  ) SELECT false AS favorite FROM owned`;
  const { rows } = await pool.query<{ favorite: boolean }>(query, [accountId, gameId]);
  return rows[0]?.favorite ?? null;
}
