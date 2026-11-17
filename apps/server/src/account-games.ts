import type pg from 'pg';
import type { AccountGame, AccountGames, AccountGamesFilter, AccountIdentity } from '@chess/contracts';

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

// The account archive and Favorites both require a linked participant seat and a saved game.
const linkedSeats = `
  SELECT c.id, c.created_at, c.time_control, 'white'::text AS side, c.acceptor_guest_id AS opponent_id
  FROM chess.guest_sessions s JOIN chess.challenges c ON c.creator_guest_id = s.id WHERE s.account_id = $1
  UNION ALL
  SELECT c.id, c.created_at, c.time_control, 'black'::text AS side, c.creator_guest_id AS opponent_id
  FROM chess.guest_sessions s JOIN chess.challenges c ON c.acceptor_guest_id = s.id WHERE s.account_id = $1`;

export async function accountGames(pool: pg.Pool, account: AccountIdentity, cursor: Cursor | null,
  filter: AccountGamesFilter): Promise<AccountGames> {
  // Both the page and summary use one statement/snapshot.
  const { rows } = await pool.query<{ games: AccountGame[]; summary: AccountGames['summary'] }>(`
    WITH seats AS (${linkedSeats}), owned AS (
      SELECT s.id, s.created_at, s.side, s.opponent_id, g.status, g.result,
        CASE WHEN g.clock_mode = 'legacy_untimed' THEN NULL ELSE s.time_control END AS time_control
      FROM seats s JOIN chess.games g ON g.id = s.id
    ), page AS (
      SELECT o.*, a.username AS opponent, f.game_id IS NOT NULL AS favorite FROM owned o
      JOIN chess.guest_sessions opponent_guest ON opponent_guest.id = o.opponent_id
      LEFT JOIN chess.accounts a ON a.id = opponent_guest.account_id
      LEFT JOIN chess.account_game_favorites f ON f.account_id = $1 AND f.game_id = o.id
      WHERE ($2::timestamptz IS NULL OR (o.created_at, o.id) < ($2::timestamptz, $3::uuid))
        AND (NOT $4::boolean OR f.game_id IS NOT NULL)
      ORDER BY o.created_at DESC, o.id DESC LIMIT 21
    )
    SELECT (SELECT COALESCE(jsonb_agg(jsonb_build_object(
      'id', id, 'side', side, 'createdAt', to_char(created_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"'),
      'status', status, 'result', result, 'opponent', opponent, 'timeControl', time_control, 'favorite', favorite)
      ORDER BY created_at DESC, id DESC), '[]') FROM page) AS games,
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
  return { account, games: games.slice(0, 20), summary, next };
}

/** A missing row means the account has no linked seat in this game. */
export async function accountGameFavorite(pool: pg.Pool, accountId: string, gameId: string,
  method: 'GET' | 'PUT' | 'DELETE'): Promise<boolean | null> {
  const owned = `WITH seats AS (${linkedSeats}), owned AS (
    SELECT g.id FROM seats s JOIN chess.games g ON g.id = s.id WHERE g.id = $2 LIMIT 1
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
