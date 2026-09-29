import { randomUUID } from 'node:crypto';
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import type pg from 'pg';
import type { ChallengeSummary, GuestSessionResponse } from '@chess/contracts';
import { createGuest, currentGuest, validCsrf, type GuestSession } from './guest-session.js';

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
}

function summary(row: ChallengeRow, guestId: string): ChallengeSummary {
  return {
    id: row.id,
    path: `/challenge/${row.id}`,
    status: row.acceptor_guest_id === null ? 'open' : 'accepted',
    yourSeat: row.creator_guest_id === guestId ? 'white'
      : row.acceptor_guest_id === guestId ? 'black' : null,
    seats: { white: 'occupied', black: row.acceptor_guest_id === null ? 'open' : 'occupied' },
    game: { status: 'not_started', rated: false, initialMs: 300_000, incrementMs: 3_000 },
    createdAt: row.created_at.toISOString(),
  };
}

async function findChallenge(pool: pg.Pool, id: string): Promise<ChallengeRow | null> {
  const { rows } = await pool.query<ChallengeRow>(
    `SELECT id, creator_guest_id, acceptor_guest_id, created_at
      FROM chess.challenges WHERE id = $1`, [id],
  );
  return rows[0] ?? null;
}

async function requireGuest(pool: pg.Pool, request: FastifyRequest,
  reply: FastifyReply, csrf = false): Promise<GuestSession | null> {
  const guest = await currentGuest(pool, request);
  if (guest === null) {
    reply.code(401).send({ error: 'guest_session_required' });
    return null;
  }
  if (csrf && !validCsrf(request, guest)) {
    reply.code(403).send({ error: 'invalid_csrf_token' });
    return null;
  }
  return guest;
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
    const row = rows[0]!;
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
      const { rows } = await pool.query<ChallengeRow>(
        `UPDATE chess.challenges SET acceptor_guest_id = $2, accepted_at = now()
          WHERE id = $1 AND acceptor_guest_id IS NULL AND creator_guest_id <> $2
          RETURNING id, creator_guest_id, acceptor_guest_id, created_at`,
        [request.params.id, guest.id],
      );
      const row = rows[0] ?? await findChallenge(pool, request.params.id);
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
  } catch {
    throw new Error('The challenge schema is missing or inaccessible. Run npm run db:migrate and check database permissions.');
  }
}
