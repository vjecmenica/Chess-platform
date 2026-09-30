import { randomUUID } from 'node:crypto';
import type { FastifyInstance } from 'fastify';
import type pg from 'pg';
import type { ChallengeSummary, GuestSessionResponse } from '@chess/contracts';
import { STANDARD_STARTING_FEN } from '@chess/domain';
import { createGuest, currentGuest, requireGuest } from './guest-session.js';

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
  game_status: 'waiting' | 'active' | 'pending_adjudication' | 'finished' | null;
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
      rated: false, initialMs: 300_000, incrementMs: 3_000 },
    createdAt: row.created_at.toISOString(),
  };
}

async function findChallenge(query: Pick<pg.Pool, 'query'>, id: string): Promise<ChallengeRow | null> {
  const { rows } = await query.query<ChallengeRow>(
    `SELECT c.id, c.creator_guest_id, c.acceptor_guest_id, c.created_at,
      g.status AS game_status, g.clock_mode
      FROM chess.challenges c LEFT JOIN chess.games g ON g.id = c.id WHERE c.id = $1`, [id],
  );
  const row = rows[0];
  if (row && row.acceptor_guest_id !== null && row.game_status === null) {
    throw new Error('An accepted challenge has no game.');
  }
  return row ?? null;
}

export function registerChallengeRoutes(app: FastifyInstance, pool: pg.Pool, secureCookies: boolean): void {
  app.get<{ Reply: GuestSessionResponse }>('/guest-session', async (request, reply) => {
    reply.header('Cache-Control', 'no-store');
    const guest = await currentGuest(pool, request) ?? await createGuest(pool, reply, secureCookies);
    return { csrfToken: guest.csrfToken };
  });

  app.post('/challenges', { schema: { headers: createHeaders } }, async (request, reply) => {
    reply.header('Cache-Control', 'no-store');
    const guest = await requireGuest(pool, request, reply, true);
    if (guest === null) return;
    if (request.body !== undefined) return reply.code(400).send({ error: 'unexpected_body' });
    const requestId = request.headers['idempotency-key'];
    if (typeof requestId !== 'string') return reply.code(400).send({ error: 'invalid_idempotency_key' });
    const { rows } = await pool.query<ChallengeRow>(
      `INSERT INTO chess.challenges (id, creator_guest_id, create_request_id)
        VALUES ($1, $2, $3)
        ON CONFLICT (creator_guest_id, create_request_id)
        DO UPDATE SET create_request_id = EXCLUDED.create_request_id
        RETURNING id, creator_guest_id, acceptor_guest_id, created_at`,
      [randomUUID(), guest.id, requestId],
    );
    const row = await findChallenge(pool, rows[0]!.id);
    if (row === null) throw new Error('The created challenge could not be read.');
    return reply.code(200).send(summary(row, guest.id));
  });

  app.get<{ Params: { id: string } }>('/challenges/:id', { schema: { params: idParams } },
    async (request, reply) => {
      reply.header('Cache-Control', 'no-store');
      const guest = await requireGuest(pool, request, reply);
      if (guest === null) return;
      const row = await findChallenge(pool, request.params.id);
      if (row === null) return reply.code(404).send({ error: 'challenge_not_found' });
      if (row.acceptor_guest_id !== null && row.creator_guest_id !== guest.id
        && row.acceptor_guest_id !== guest.id) {
        return reply.code(403).send({ error: 'not_a_participant' });
      }
      return summary(row, guest.id);
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
        const changed = await client.query<{ id: string }>(
          `UPDATE chess.challenges SET acceptor_guest_id = $2, accepted_at = now()
            WHERE id = $1 AND acceptor_guest_id IS NULL AND creator_guest_id <> $2
            RETURNING id`, [request.params.id, guest.id],
        );
        if (changed.rowCount === 1) {
          await client.query(
            `INSERT INTO chess.games (id, starting_fen, fen, side_to_move, status,
                clock_mode, clock_phase, clock_start_mode)
              VALUES ($1, $2, $2, 'white', 'active', 'five_plus_three',
                'awaiting_first_move', 'first_move')`,
            [request.params.id, STANDARD_STARTING_FEN],
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
      if (row.creator_guest_id === guest.id) return reply.code(403).send({ error: 'cannot_accept_own_challenge' });
      if (row.acceptor_guest_id !== guest.id) return reply.code(409).send({ error: 'seat_taken' });
      return summary(row, guest.id);
    });
}

export async function checkChallengeSchema(pool: pg.Pool): Promise<void> {
  try {
    await pool.query('SELECT id FROM chess.guest_sessions LIMIT 0');
    await pool.query('SELECT id FROM chess.challenges LIMIT 0');
    await pool.query('SELECT id, clock_mode, clock_start_mode, deadline_at FROM chess.games LIMIT 0');
    await pool.query('SELECT admission_id, applied FROM chess.game_move_receipts LIMIT 0');
    await pool.query('SELECT instance_id FROM chess.clock_ingress_watermarks LIMIT 0');
  } catch {
    throw new Error('The game schema is missing or inaccessible. Run npm run db:migrate and check database permissions.');
  }
}
