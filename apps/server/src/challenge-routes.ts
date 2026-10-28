import { randomUUID } from 'node:crypto';
import type { FastifyInstance } from 'fastify';
import type pg from 'pg';
import type { ChallengeSummary, GuestSessionResponse } from '@chess/contracts';
import { defaultTimeControl, isTimeControlId, timeControlPresets, type TimeControlId } from '@chess/contracts';
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
  game_status: 'waiting' | 'active' | 'pending_adjudication' | 'finished' | 'aborted' | null;
  clock_mode: 'legacy_untimed' | 'five_plus_three' | null;
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
      rated: false, ...timeControlPresets[row.time_control] },
    createdAt: row.created_at.toISOString(),
  };
}

async function findChallenge(query: Pick<pg.Pool, 'query'>, id: string): Promise<ChallengeRow | null> {
  const { rows } = await query.query<ChallengeRow>(
    `SELECT c.id, c.creator_guest_id, c.acceptor_guest_id, c.created_at, c.time_control,
      g.status AS game_status, g.clock_mode
      FROM chess.challenges c LEFT JOIN chess.games g ON g.id = c.id WHERE c.id = $1`, [id],
  );
  const row = rows[0];
  if (row && row.acceptor_guest_id !== null && row.game_status === null) {
    throw new Error('An accepted challenge has no game.');
  }
  return row ?? null;
}

export function registerChallengeRoutes(app: FastifyInstance, pool: pg.Pool,
  secureCookies: boolean, trustedNowMs: () => number): void {
  app.get<{ Reply: GuestSessionResponse }>('/guest-session', async (request, reply) => {
    reply.header('Cache-Control', 'no-store');
    const guest = await currentGuest(pool, request) ?? await createGuest(pool, reply, secureCookies);
    return { csrfToken: guest.csrfToken };
  });

  app.post('/challenges', { schema: { headers: createHeaders } }, async (request, reply) => {
    reply.header('Cache-Control', 'no-store');
    const guest = await requireGuest(pool, request, reply, true);
    if (guest === null) return;
    const body = request.body;
    const timeControl = body === undefined ? defaultTimeControl
      : typeof body === 'object' && body !== null && !Array.isArray(body)
        && Object.keys(body).length === 1 && 'timeControl' in body ? body.timeControl : null;
    if (!isTimeControlId(timeControl)) return reply.code(400).send({ error: 'invalid_time_control' });
    const requestId = request.headers['idempotency-key'];
    if (typeof requestId !== 'string') return reply.code(400).send({ error: 'invalid_idempotency_key' });
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      const newSeatId = await newChallengeSeat(client, request, guest);
      // A retry of a pre-login guest creation remains that guest's challenge, never an implicit link.
      const earlier = (await client.query<{ id: string }>(`SELECT id FROM chess.challenges
        WHERE creator_guest_id = $1 AND create_request_id = $2`, [guest.id, requestId])).rows[0];
      const creatorId = earlier ? guest.id : newSeatId;
      const { rows } = await client.query<ChallengeRow>(
        `INSERT INTO chess.challenges (id, creator_guest_id, create_request_id, time_control)
          VALUES ($1, $2, $3, $4)
          ON CONFLICT (creator_guest_id, create_request_id)
          DO UPDATE SET create_request_id = EXCLUDED.create_request_id
          RETURNING id, creator_guest_id, acceptor_guest_id, created_at, time_control`,
        [randomUUID(), creatorId, requestId, timeControl],
      );
      if (rows[0]!.time_control !== timeControl)
        return reply.code(409).send({ error: 'request_id_conflict' });
      const row = await findChallenge(client, rows[0]!.id);
      if (row === null) throw new Error('The created challenge could not be read.');
      await client.query('COMMIT');
      return reply.code(200).send(summary(row, creatorId));
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
      let row: ChallengeRow | null;
      try {
        await client.query('BEGIN');
        const newSeatId = await newChallengeSeat(client, request, guest);
        const seatId = await participantGuestId(client, request, guest, request.params.id);
        const existing = await findChallenge(client, request.params.id);
        if (existing?.creator_guest_id === seatId) {
          await client.query('ROLLBACK');
          return reply.code(403).send({ error: 'cannot_accept_own_challenge' });
        }
        const changed = await client.query<{ id: string; time_control: TimeControlId }>(
          `UPDATE chess.challenges SET acceptor_guest_id = $2, accepted_at = now()
            WHERE id = $1 AND acceptor_guest_id IS NULL AND creator_guest_id <> $2
            RETURNING id, time_control`, [request.params.id, newSeatId],
        );
        if (changed.rowCount === 1) {
          const acceptedAtMs = trustedNowMs();
          const preset = timeControlPresets[changed.rows[0]!.time_control];
          await client.query(
            `INSERT INTO chess.games (id, starting_fen, fen, side_to_move, status,
                clock_mode, clock_phase, clock_start_mode, white_first_move_deadline_at,
                white_remaining_ms, black_remaining_ms)
              VALUES ($1, $2, $2, 'white', 'active', 'five_plus_three',
                'awaiting_first_move', 'first_move_grace', $3, $4, $4)`,
            [request.params.id, STANDARD_STARTING_FEN, new Date(acceptedAtMs + 30_000), preset.initialMs],
          );
        }
        row = await findChallenge(client, request.params.id);
        await client.query('COMMIT');
      } catch (error) {
        await client.query('ROLLBACK');
        throw error;
      } finally {
        client.release();
      }
      if (row === null) return reply.code(404).send({ error: 'challenge_not_found' });
      const seatId = await participantGuestId(pool, request, guest, row.id);
      if (row.creator_guest_id === seatId) return reply.code(403).send({ error: 'cannot_accept_own_challenge' });
      if (row.acceptor_guest_id !== seatId) return reply.code(409).send({ error: 'seat_taken' });
      return summary(row, seatId);
    });
}

export async function checkChallengeSchema(pool: pg.Pool): Promise<void> {
  try {
    await pool.query('SELECT id, account_play_seat FROM chess.guest_sessions LIMIT 0');
    await pool.query('SELECT token_hash FROM chess.account_sessions LIMIT 0');
    await pool.query('SELECT id, time_control FROM chess.challenges LIMIT 0');
    await pool.query(`SELECT id, clock_mode, clock_start_mode, deadline_at,
      white_first_move_deadline_at, black_first_move_deadline_at FROM chess.games LIMIT 0`);
    await pool.query('SELECT admission_id, applied FROM chess.game_move_receipts LIMIT 0');
    await pool.query('SELECT instance_id FROM chess.clock_ingress_watermarks LIMIT 0');
  } catch {
    throw new Error('The game schema is missing or inaccessible. Run npm run db:migrate and check database permissions.');
  }
}
