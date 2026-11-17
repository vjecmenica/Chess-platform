import { randomUUID } from 'node:crypto';
import type pg from 'pg';
import type { GameSnapshot, MateLine, MoveRecord } from '@chess/domain';

export const adjudicationPolicy = 'rated-mate-witness-v1';
export const maxAdjudicationAttempts = 3;

export type PendingDecision = Extract<GameSnapshot, { status: 'pending_adjudication' }>['pending'];
export interface AdjudicationPosition {
  readonly startingFen: string;
  readonly moves: readonly MoveRecord[];
  readonly pending: PendingDecision;
}
export interface SearchMetrics { readonly nodesVisited: number; readonly searchMs: number }
export type AdjudicationAuthority =
  | { readonly leaseToken: string; readonly metrics: SearchMetrics }
  | { readonly reviewer: string };
export interface AdjudicationCase {
  pending_version: number;
  kind: PendingDecision['kind'];
  status: 'queued' | 'processing' | 'retry' | 'review' | 'resolved';
  lease_token: string | null;
  lease_valid: boolean | null;
  mate_line: MateLine | null;
  decided_by: string | null;
  decided_at: Date | null;
  policy_version: string | null;
}
interface Claim { game_id: string; token: string; attempts: number }

export async function claimAdjudication(pool: pg.Pool): Promise<Claim | null> {
  const token = randomUUID();
  const { rows } = await pool.query<Claim & { status: string }>(`
    WITH candidate AS (
      SELECT game_id FROM chess.rated_adjudications WHERE due_at <= statement_timestamp()
      ORDER BY due_at, game_id LIMIT 1 FOR UPDATE SKIP LOCKED
    )
    UPDATE chess.rated_adjudications a SET
      status = CASE WHEN a.attempts >= $2 THEN 'review' ELSE 'processing' END,
      attempts = LEAST(a.attempts + 1, $2),
      due_at = CASE WHEN a.attempts >= $2 THEN NULL ELSE clock_timestamp() + interval '60 seconds' END,
      lease_token = CASE WHEN a.attempts >= $2 THEN NULL ELSE $1::uuid END,
      diagnostic = CASE WHEN a.attempts >= $2 THEN 'worker_lease_expired' ELSE a.diagnostic END
    FROM candidate WHERE a.game_id = candidate.game_id
    RETURNING a.game_id, a.attempts, a.status, a.lease_token AS token`, [token, maxAdjudicationAttempts]);
  return rows[0]?.status === 'processing' ? rows[0] : null;
}

export async function deferAdjudication(pool: pg.Pool, claim: Claim,
  diagnostic: string, metrics?: { nodesVisited: number | null; searchMs: number }): Promise<void> {
  const review = metrics !== undefined || claim.attempts >= maxAdjudicationAttempts;
  const backoffSeconds = 5 * 2 ** (claim.attempts - 1);
  await pool.query(`UPDATE chess.rated_adjudications SET
    status = $3, due_at = CASE WHEN $3 = 'review' THEN NULL ELSE clock_timestamp() + make_interval(secs => $4) END,
    diagnostic = $5, nodes_visited = $6, search_ms = $7, lease_token = NULL
    WHERE game_id = $1 AND lease_token = $2 AND status = 'processing'`,
  [claim.game_id, claim.token, review ? 'review' : 'retry', backoffSeconds, diagnostic,
    metrics?.nodesVisited ?? null, metrics?.searchMs ?? null]);
}
