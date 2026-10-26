import type pg from 'pg';
import type { AccountGame, AccountGames, AccountIdentity } from '@chess/contracts';

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

export async function accountGames(pool: pg.Pool, account: AccountIdentity, cursor: Cursor | null): Promise<AccountGames> {
  // Both the page and summary use one statement/snapshot. Only explicitly linked seats qualify.
  const { rows } = await pool.query<{ games: AccountGame[]; summary: AccountGames['summary'] }>(`
    WITH seats AS (
      SELECT c.*, 'white'::text AS side, c.acceptor_guest_id AS opponent_id
      FROM chess.guest_sessions s JOIN chess.challenges c ON c.creator_guest_id = s.id WHERE s.account_id = $1
      UNION ALL
      SELECT c.*, 'black'::text AS side, c.creator_guest_id AS opponent_id
      FROM chess.guest_sessions s JOIN chess.challenges c ON c.acceptor_guest_id = s.id WHERE s.account_id = $1
    ), owned AS (
      SELECT s.id, s.created_at, s.side, s.opponent_id, g.status, g.result,
        CASE WHEN g.clock_mode = 'legacy_untimed' THEN NULL ELSE s.time_control END AS time_control
      FROM seats s JOIN chess.games g ON g.id = s.id
    ), page AS (
      SELECT o.*, a.username AS opponent FROM owned o
      JOIN chess.guest_sessions opponent_guest ON opponent_guest.id = o.opponent_id
      LEFT JOIN chess.accounts a ON a.id = opponent_guest.account_id
      WHERE ($2::timestamptz IS NULL OR (o.created_at, o.id) < ($2::timestamptz, $3::uuid))
      ORDER BY o.created_at DESC, o.id DESC LIMIT 21
    )
    SELECT (SELECT COALESCE(jsonb_agg(jsonb_build_object(
      'id', id, 'side', side, 'createdAt', to_char(created_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"'),
      'status', status, 'result', result, 'opponent', opponent, 'timeControl', time_control)
      ORDER BY created_at DESC, id DESC), '[]') FROM page) AS games,
      jsonb_build_object(
        'wins', count(*) FILTER (WHERE status = 'finished' AND result->>'outcome' = 'win' AND result->>'winner' = side),
        'draws', count(*) FILTER (WHERE status = 'finished' AND result->>'outcome' = 'draw'),
        'losses', count(*) FILTER (WHERE status = 'finished' AND result->>'outcome' = 'win' AND result->>'winner' <> side)
      ) AS summary FROM owned`, [account.id, cursor?.createdAt ?? null, cursor?.id ?? null]);
  const { games, summary } = rows[0]!;
  const last = games[19];
  // Keep all six PostgreSQL fractional digits; Date.toISOString() would lose cursor precision.
  const next = games.length > 20 && last
    ? Buffer.from(JSON.stringify({ createdAt: last.createdAt, id: last.id })).toString('base64url') : null;
  return { account, games: games.slice(0, 20), summary, next };
}
