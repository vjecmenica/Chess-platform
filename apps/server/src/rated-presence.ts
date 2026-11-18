import type pg from 'pg';
import type { GameSide, RatingPool } from '@chess/contracts';

export const disconnectTiming = {
  missingMs: 75_000,
  heartbeatContinuityMs: 25_000,
  minimumWriteIntervalMs: 5_000,
  graceMs: { bullet: 30_000, blitz: 45_000, rapid: 60_000, classical: 90_000 } satisfies Record<RatingPool, number>,
};

type Signal = 'heartbeat' | 'activity';
interface Presence {
  white_heartbeat_at: Date | null;
  black_heartbeat_at: Date | null;
  white_activity_at: Date | null;
  black_activity_at: Date | null;
  disconnected_side: GameSide | null;
  grace_deadline_at: Date | null;
  confirmed_at: Date | null;
}

const emptyPresence: Presence = { white_heartbeat_at: null, black_heartbeat_at: null,
  white_activity_at: null, black_activity_at: null, disconnected_side: null, grace_deadline_at: null, confirmed_at: null };
const otherSide = (side: GameSide): GameSide => side === 'white' ? 'black' : 'white';

function recent(stamp: Date | null, nowMs: number, windowMs: number): boolean {
  return stamp !== null && stamp.getTime() > nowMs - windowMs;
}

export async function readPresence(client: pg.PoolClient, id: string): Promise<Presence> {
  const { rows } = await client.query<Presence>('SELECT * FROM chess.rated_game_presence WHERE game_id = $1', [id]);
  return rows[0] ?? emptyPresence;
}

export function observedGrace(presence: Presence, atMs: number) {
  const side = presence.disconnected_side;
  if (side === null || presence.grace_deadline_at === null
    || !recent(presence[`${otherSide(side)}_heartbeat_at`], atMs, disconnectTiming.heartbeatContinuityMs)) return null;
  return { side, graceDeadlineMs: presence.grace_deadline_at.getTime(),
    confirmedAtMs: presence.confirmed_at?.getTime() ?? null };
}

// The caller holds the game lock. Closing one stream never invalidates a seat's other signals.
export async function observePresence(client: pg.PoolClient, gameId: string, pool: RatingPool,
  side: GameSide, source: Signal, arrivalMs: number, eligible: boolean, version: number): Promise<void> {
  const before = await readPresence(client, gameId);
  const field = `${side}_${source}_at` as const;
  const previous = before[field];
  const previousMs = previous?.getTime() ?? -Infinity;
  const newHeartbeat = source === 'heartbeat' && arrivalMs > previousMs;
  const next = { ...before };
  const opponent = otherSide(side);
  const clearGrace = () => {
    next.disconnected_side = null;
    next.grace_deadline_at = null;
    next.confirmed_at = null;
  };

  if (next.disconnected_side === side && (next.confirmed_at === null || arrivalMs < next.confirmed_at.getTime())) {
    // A return before confirmation wins even if another instance recorded confirmation first.
    clearGrace();
  }
  if (newHeartbeat && next.disconnected_side === opponent
    && !recent(previous, arrivalMs, disconnectTiming.heartbeatContinuityMs)) clearGrace();

  if (newHeartbeat && eligible && next.disconnected_side === null
    && recent(previous, arrivalMs, disconnectTiming.heartbeatContinuityMs) && before[`${opponent}_heartbeat_at`]
    && !recent(before[`${opponent}_heartbeat_at`], arrivalMs, disconnectTiming.missingMs)
    && !recent(before[`${opponent}_activity_at`], arrivalMs, disconnectTiming.missingMs)) {
    next.disconnected_side = opponent;
    next.grace_deadline_at = new Date(arrivalMs + disconnectTiming.graceMs[pool]);
  }
  if (newHeartbeat && next.disconnected_side === opponent && next.grace_deadline_at
    && next.confirmed_at === null && arrivalMs >= next.grace_deadline_at.getTime()) {
    next.confirmed_at = new Date(arrivalMs);
  }

  const changed = next.disconnected_side !== before.disconnected_side || next.grace_deadline_at !== before.grace_deadline_at
    || next.confirmed_at !== before.confirmed_at;
  if (!changed && arrivalMs < previousMs + disconnectTiming.minimumWriteIntervalMs) return;
  if (arrivalMs > previousMs) next[field] = new Date(arrivalMs);
  await client.query(`INSERT INTO chess.rated_game_presence (game_id, white_heartbeat_at, black_heartbeat_at,
    white_activity_at, black_activity_at, disconnected_side, grace_deadline_at, confirmed_at)
    VALUES ($1, $2, $3, $4, $5, $6, $7, $8) ON CONFLICT (game_id) DO UPDATE SET
      white_heartbeat_at = EXCLUDED.white_heartbeat_at, black_heartbeat_at = EXCLUDED.black_heartbeat_at,
      white_activity_at = EXCLUDED.white_activity_at, black_activity_at = EXCLUDED.black_activity_at,
      disconnected_side = EXCLUDED.disconnected_side, grace_deadline_at = EXCLUDED.grace_deadline_at,
      confirmed_at = EXCLUDED.confirmed_at`, [gameId, next.white_heartbeat_at, next.black_heartbeat_at,
    next.white_activity_at, next.black_activity_at, next.disconnected_side, next.grace_deadline_at, next.confirmed_at]);
  if (changed) await client.query("SELECT pg_notify('chess_game_updates', $1)", [JSON.stringify({ id: gameId, version })]);
}
