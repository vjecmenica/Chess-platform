import type { FastifyInstance } from 'fastify';
import type pg from 'pg';
import type { GameChatMessage, GameSide } from '@chess/contracts';
import { requireGuest } from './guest-session.js';
import { participantGuestId } from './account-session.js';

const uuid = '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$';
const params = { type: 'object', required: ['id'], additionalProperties: false,
  properties: { id: { type: 'string', pattern: uuid } } } as const;
interface Access { status: string; creator_guest_id: string; acceptor_guest_id: string }
interface MessageRow { id: string; sender_side: GameSide; body: string; created_at: Date }
function message(row: MessageRow): GameChatMessage {
  return { id: row.id, side: row.sender_side, text: row.body, sentAt: row.created_at.toISOString() };
}
function canSendChat(status: string): boolean {
  return status === 'active' || status === 'finished';
}

export function registerGameChatRoutes(app: FastifyInstance, pool: pg.Pool): void {
  app.get<{ Params: { id: string }; Querystring: { after?: string } }>('/games/:id/chat',
    { schema: { params, querystring: { type: 'object', additionalProperties: false,
      properties: { after: { type: 'string', pattern: '^[0-9]{1,19}$' } } } } }, async (request, reply) => {
      reply.header('Cache-Control', 'no-store');
      const guest = await requireGuest(pool, request, reply);
      if (!guest) return;
      const seatId = await participantGuestId(pool, request, guest, request.params.id);
      const after = request.query.after ?? '0';
      if (BigInt(after) > 9223372036854775807n) return reply.code(400).send({ error: 'invalid_cursor' });
      const access = (await pool.query<Access>(`SELECT g.status, c.creator_guest_id, c.acceptor_guest_id
        FROM chess.games g JOIN chess.challenges c ON c.id = g.id WHERE g.id = $1`, [request.params.id])).rows[0];
      if (!access) return reply.code(404).send({ error: 'game_not_found' });
      if (seatId !== access.creator_guest_id && seatId !== access.acceptor_guest_id) {
        return reply.code(403).send({ error: 'not_a_participant' });
      }
      // A bounded latest window also catches up after a long disconnection without replaying a backlog.
      const { rows } = await pool.query<MessageRow>(`SELECT id, sender_side, body, created_at
        FROM chess.game_chat_messages WHERE game_id = $1 AND id > $2::bigint ORDER BY id DESC LIMIT 100`,
      [request.params.id, after]);
      return { messages: rows.reverse().map(message), canSend: canSendChat(access.status) };
    });

  app.post<{ Params: { id: string }; Body: { text: string } }>('/games/:id/chat',
    { schema: { params, headers: { type: 'object', required: ['idempotency-key'],
      properties: { 'idempotency-key': { type: 'string', pattern: uuid } } },
    body: { type: 'object', required: ['text'], additionalProperties: false,
      properties: { text: { type: 'string', minLength: 1, maxLength: 500 } } } } }, async (request, reply) => {
      reply.header('Cache-Control', 'no-store');
      const guest = await requireGuest(pool, request, reply, true);
      if (!guest) return;
      const seatId = await participantGuestId(pool, request, guest, request.params.id);
      const text = request.body.text.trim();
      if (!text) return reply.code(400).send({ error: 'empty_message' });
      const requestId = request.headers['idempotency-key'] as string;
      const client = await pool.connect();
      let committed = false;
      try {
        await client.query('BEGIN');
        // Share the game lock with finalization, but never change move versions or clock receipts.
        // This also orders message IDs and serializes the per-seat rate check across server processes.
        const access = (await client.query<Access>(`SELECT g.status, c.creator_guest_id, c.acceptor_guest_id
          FROM chess.games g JOIN chess.challenges c ON c.id = g.id WHERE g.id = $1 FOR UPDATE OF g`,
        [request.params.id])).rows[0];
        if (!access) return reply.code(404).send({ error: 'game_not_found' });
        const side = seatId === access.creator_guest_id ? 'white'
          : seatId === access.acceptor_guest_id ? 'black' : null;
        if (!side) return reply.code(403).send({ error: 'not_a_participant' });
        const previous = (await client.query<MessageRow>(`SELECT id, sender_side, body, created_at
          FROM chess.game_chat_messages WHERE game_id = $1 AND sender_side = $2 AND request_id = $3`,
        [request.params.id, side, requestId])).rows[0];
        if (previous) {
          if (previous.body !== text) return reply.code(409).send({ error: 'request_id_conflict' });
          return message(previous);
        }
        if (!canSendChat(access.status)) return reply.code(409).send({ error: 'chat_read_only' });
        const recent = await client.query(`SELECT id FROM chess.game_chat_messages
          WHERE game_id = $1 AND sender_side = $2 AND created_at > clock_timestamp() - interval '10 seconds'
          ORDER BY created_at DESC LIMIT 5`, [request.params.id, side]);
        if (recent.rows.length >= 5) {
          reply.header('Retry-After', '10');
          return reply.code(429).send({ error: 'chat_rate_limited' });
        }
        const row = (await client.query<MessageRow>(`INSERT INTO chess.game_chat_messages
          (game_id, sender_side, request_id, body) VALUES ($1, $2, $3, $4)
          RETURNING id, sender_side, body, created_at`, [request.params.id, side, requestId, text])).rows[0]!;
        await client.query("SELECT pg_notify('chess_game_updates', $1)",
          [JSON.stringify({ id: request.params.id, chatId: row.id })]);
        await client.query('COMMIT');
        committed = true;
        return reply.code(201).send(message(row));
      } finally {
        // Release locks on every rejected or failed request, including successful duplicate reads.
        try { if (!committed) await client.query('ROLLBACK'); } finally { client.release(); }
      }
    });
}
