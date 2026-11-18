import { randomUUID } from 'node:crypto';
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import type pg from 'pg';
import type { ChallengeSummary, GuestSessionResponse } from '@chess/contracts';
import { defaultTimeControl, isTimeControlId, ratingPoolByTimeControl, timeControlPresets, type TimeControlId } from '@chess/contracts';
import { STANDARD_STARTING_FEN } from '@chess/domain';
import { createGuest, currentGuest, requireGuest } from './guest-session.js';
import { newChallengeSeat, participantGuestId } from './account-session.js';

const uuid = '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$';
const idParams = { type: 'object', required: ['id'], additionalProperties: false,
  properties: { id: { type: 'string', pattern: uuid } } } as const;
const createHeaders = { type: 'object', required: ['idempotency-key'],
  properties: { 'idempotency-key': { type: 'string', pattern: uuid } } } as const;

interface ChallengeRow {
  id: string;
  creator_guest_id: string;
  acceptor_guest_id: string | null;
  created_at: Date;
  time_control: TimeControlId;
  rated: boolean;
  rated_creator_account_id: string | null;
  game_status: 'waiting' | 'active' | 'pending_adjudication' | 'finished' | 'aborted' | null;
  game_rated: boolean | null;
  clock_mode: 'legacy_untimed' | 'five_plus_three' | null;
}
type ChallengeTerms = Pick<ChallengeRow, 'id' | 'creator_guest_id' | 'time_control' | 'rated'>;

function writeError(request: FastifyRequest, reply: FastifyReply, error: unknown) {
  const status = (error as { statusCode?: number } | null)?.statusCode;
  if (status === 401) return reply.code(401).send({ error: 'account_required' });
  if (status === 409) return reply.code(409).send({ error: 'session_changed' });
  request.log.error({ err: error }, 'Challenge write failed');
  return reply.code(500).send({ error: 'challenge_unavailable' });
}

function summary(row: ChallengeRow, guestId: string): ChallengeSummary {
  return {
    id: row.id,
    path: `/challenge/${row.id}`,
    status: row.acceptor_guest_id === null ? 'open' : 'accepted',
    yourSeat: row.creator_guest_id === guestId ? 'white'
      : row.acceptor_guest_id === guestId ? 'black' : null,
    seats: { white: 'occupied', black: row.acceptor_guest_id === null ? 'open' : 'occupied' },
    game: { id: row.game_status === null ? null : row.id,
      status: row.game_status ?? 'not_created',
      clocks: row.clock_mode === 'five_plus_three' ? 'authoritative' : 'not_integrated',
      rated: row.game_rated ?? row.rated, ...timeControlPresets[row.time_control] },
    createdAt: row.created_at.toISOString(),
  };
}

async function findChallenge(query: Pick<pg.Pool, 'query'>, id: string): Promise<ChallengeRow | null> {
  const { rows } = await query.query<ChallengeRow>(
    `SELECT c.id, c.creator_guest_id, c.acceptor_guest_id, c.created_at, c.time_control, c.rated, c.rated_creator_account_id,
      g.status AS game_status, g.rated AS game_rated, g.clock_mode
      FROM chess.challenges c LEFT JOIN chess.games g ON g.id = c.id WHERE c.id = $1`, [id],
  );
  const row = rows[0];
  if (row && row.acceptor_guest_id !== null && row.game_status === null) {
    throw new Error('An accepted challenge has no game.');
  }
  return row ?? null;
}

export function registerChallengeRoutes(app: FastifyInstance, pool: pg.Pool,
  secureCookies: boolean, trustedNowMs: () => number, ratedChallengesEnabled: boolean): void {
  app.get<{ Reply: GuestSessionResponse }>('/guest-session', async (request, reply) => {
    reply.header('Cache-Control', 'no-store');
    const guest = await currentGuest(pool, request) ?? await createGuest(pool, reply, secureCookies);
    return { csrfToken: guest.csrfToken, ...(ratedChallengesEnabled ? { ratedChallengesEnabled: true } : {}) };
  });

  app.post('/challenges', { schema: { headers: createHeaders } }, async (request, reply) => {
    reply.header('Cache-Control', 'no-store');
    const guest = await requireGuest(pool, request, reply, true);
    if (guest === null) return;
    const body = request.body === undefined ? { timeControl: defaultTimeControl } : request.body;
    if (typeof body !== 'object' || body === null || Array.isArray(body) || !('timeControl' in body)
      || Object.keys(body).some(key => key !== 'timeControl' && key !== 'rated')) {
      return reply.code(400).send({ error: 'invalid_time_control' });
    }
    const { timeControl } = body;
    if (!isTimeControlId(timeControl)) return reply.code(400).send({ error: 'invalid_time_control' });
    if ('rated' in body && typeof body.rated !== 'boolean') {
      return reply.code(400).send({ error: 'invalid_challenge_mode' });
    }
    const rated = 'rated' in body && body.rated === true;
    const requestId = request.headers['idempotency-key'];
    if (typeof requestId !== 'string') return reply.code(400).send({ error: 'invalid_idempotency_key' });
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      const actor = await newChallengeSeat(client, request, guest);
      // A retry of a pre-login guest creation remains that guest's challenge, never an implicit link.
      let saved = (await client.query<ChallengeTerms>(
        `SELECT id, creator_guest_id, time_control, rated FROM chess.challenges
          WHERE creator_guest_id IN ($1, $2) AND create_request_id = $3
          ORDER BY (creator_guest_id = $1) DESC LIMIT 1`, [guest.id, actor.id, requestId])).rows[0];
      if (!saved) {
        if (rated && !ratedChallengesEnabled) return reply.code(403).send({ error: 'rated_challenges_disabled' });
        if (rated && !actor.accountId) return reply.code(401).send({ error: 'rated_account_required' });
        saved = (await client.query<ChallengeTerms>(
          `INSERT INTO chess.challenges (id, creator_guest_id, create_request_id, time_control, rated, rated_creator_account_id)
            VALUES ($1, $2, $3, $4, $5, $6)
            ON CONFLICT (creator_guest_id, create_request_id)
            DO UPDATE SET create_request_id = EXCLUDED.create_request_id
            RETURNING id, creator_guest_id, time_control, rated`,
          [randomUUID(), actor.id, requestId, timeControl, rated, rated ? actor.accountId : null])).rows[0]!;
      }
      if (saved.time_control !== timeControl || saved.rated !== rated)
        return reply.code(409).send({ error: 'request_id_conflict' });
      const row = await findChallenge(client, saved.id);
      if (row === null) throw new Error('The created challenge could not be read.');
      await client.query('COMMIT');
      return reply.code(200).send(summary(row, saved.creator_guest_id));
    } catch (error) {
      return writeError(request, reply, error);
    } finally { try { await client.query('ROLLBACK'); } finally { client.release(); } }
  });

  app.get<{ Params: { id: string } }>('/challenges/:id', { schema: { params: idParams } },
    async (request, reply) => {
      reply.header('Cache-Control', 'no-store');
      const guest = await requireGuest(pool, request, reply);
      if (guest === null) return;
      const row = await findChallenge(pool, request.params.id);
      if (row === null) return reply.code(404).send({ error: 'challenge_not_found' });
      const seatId = await participantGuestId(pool, request, guest, row.id);
      if (row.acceptor_guest_id !== null && row.creator_guest_id !== seatId
        && row.acceptor_guest_id !== seatId) {
        return reply.code(403).send({ error: 'not_a_participant' });
      }
      return summary(row, seatId);
    });

  app.post<{ Params: { id: string } }>('/challenges/:id/accept',
    { schema: { params: idParams } }, async (request, reply) => {
      reply.header('Cache-Control', 'no-store');
      const guest = await requireGuest(pool, request, reply, true);
      if (guest === null) return;
      if (request.body !== undefined) return reply.code(400).send({ error: 'unexpected_body' });
      const client = await pool.connect();
      try {
        await client.query('BEGIN');
        const actor = await newChallengeSeat(client, request, guest);
        const seatId = await participantGuestId(client, request, guest, request.params.id);
        const existing = await findChallenge(client, request.params.id);
        if (existing === null) return reply.code(404).send({ error: 'challenge_not_found' });
        if (existing.rated && !actor.accountId) return reply.code(401).send({ error: 'rated_account_required' });
        if (existing.creator_guest_id === seatId || (existing.rated && existing.rated_creator_account_id === actor.accountId)) {
          return reply.code(403).send({ error: 'cannot_accept_own_challenge' });
        }
        if (existing.rated && existing.acceptor_guest_id === null) {
          if (!ratedChallengesEnabled) return reply.code(403).send({ error: 'rated_challenges_disabled' });
          const creator = await client.query(`SELECT 1 FROM chess.guest_sessions
            WHERE id = $1 AND account_id = $2 AND account_play_seat`,
          [existing.creator_guest_id, existing.rated_creator_account_id]);
          if (!creator.rowCount) return reply.code(409).send({ error: 'rated_creator_unavailable' });
        }
        const changed = await client.query<{ time_control: TimeControlId }>(
          `UPDATE chess.challenges SET acceptor_guest_id = $2, accepted_at = now()
            WHERE id = $1 AND acceptor_guest_id IS NULL AND creator_guest_id <> $2
            RETURNING time_control`, [request.params.id, actor.id],
        );
        if (changed.rowCount === 1) {
          const acceptedAtMs = trustedNowMs();
          const control = changed.rows[0]!.time_control;
          const preset = timeControlPresets[control];
          await client.query(
            `INSERT INTO chess.games (id, starting_fen, fen, side_to_move, status,
                clock_mode, clock_phase, clock_start_mode, white_first_move_deadline_at,
                white_remaining_ms, black_remaining_ms, rated, rated_white_account_id, rated_black_account_id, rating_pool)
              VALUES ($1, $2, $2, 'white', 'active', 'five_plus_three',
                'awaiting_first_move', 'first_move_grace', $3, $4, $4, $5, $6, $7, $8)`,
            [request.params.id, STANDARD_STARTING_FEN, new Date(acceptedAtMs + 30_000), preset.initialMs,
              existing.rated, existing.rated_creator_account_id, existing.rated ? actor.accountId : null,
              existing.rated ? ratingPoolByTimeControl[control] : null],
          );
        }
        const row = await findChallenge(client, request.params.id);
        if (row === null) return reply.code(404).send({ error: 'challenge_not_found' });
        const acceptedSeat = await participantGuestId(client, request, guest, row.id);
        if (row.acceptor_guest_id !== acceptedSeat) return reply.code(409).send({ error: 'seat_taken' });
        await client.query('COMMIT');
        return summary(row, acceptedSeat);
      } catch (error) {
        return writeError(request, reply, error);
      } finally {
        try { await client.query('ROLLBACK'); } finally { client.release(); }
      }
    });
}

export async function checkChallengeSchema(pool: pg.Pool): Promise<void> {
  try {
    await pool.query('SELECT id, account_play_seat FROM chess.guest_sessions LIMIT 0');
    await pool.query('SELECT token_hash FROM chess.account_sessions LIMIT 0');
    await pool.query('SELECT verified_email, pending_email FROM chess.accounts LIMIT 0');
    await pool.query('SELECT token_hash FROM chess.account_email_tokens LIMIT 0');
    await pool.query('SELECT id, time_control, rated, rated_creator_account_id FROM chess.challenges LIMIT 0');
    await pool.query(`SELECT id, clock_mode, clock_start_mode, deadline_at,
      white_first_move_deadline_at, black_first_move_deadline_at, rated,
      rated_white_account_id, rated_black_account_id, rating_pool, resignation_policy, timeout_policy
      FROM chess.games LIMIT 0`);
    await pool.query('SELECT game_id FROM chess.game_rating_settlements LIMIT 0');
    await pool.query('SELECT game_id, due_at FROM chess.rated_adjudications LIMIT 0');
    await pool.query('SELECT game_id, confirmed_at FROM chess.rated_game_presence LIMIT 0');
    await pool.query('SELECT admission_id, applied FROM chess.game_move_receipts LIMIT 0');
    await pool.query('SELECT instance_id FROM chess.clock_ingress_watermarks LIMIT 0');
    await pool.query('SELECT kind, event_key FROM chess.game_chat_messages LIMIT 0');
    await pool.query('SELECT id, sender_seat, status FROM chess.game_rematches LIMIT 0');
    await pool.query('SELECT muted, version FROM chess.game_chat_preferences LIMIT 0');
    await pool.query('SELECT request_id FROM chess.game_chat_mute_receipts LIMIT 0');
  } catch {
    throw new Error('The game schema is missing or inaccessible. Run npm run db:migrate and check database permissions.');
  }
}
