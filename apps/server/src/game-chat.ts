import type { FastifyInstance } from 'fastify';
import type pg from 'pg';
import { gameChatPresets, type GameChatHistory, type GameChatPreset, type GameChatMessage, type GameSide } from '@chess/contracts';
import { appendSystemChat } from './game-chat-events.js';
import { requireGuest } from './guest-session.js';
import { participantGuestId } from './account-session.js';

const uuid = '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$';
const params = { type: 'object', required: ['id'], additionalProperties: false,
  properties: { id: { type: 'string', pattern: uuid } } } as const;
interface Access { status: string; creator_guest_id: string; acceptor_guest_id: string }
interface MessageRow { id: string; sender_side: GameSide; body: string; kind: 'user' | 'system'; created_at: Date }
function message(row: MessageRow): GameChatMessage {
  return { id: row.id, side: row.sender_side, text: row.body, sentAt: row.created_at.toISOString(), ...(row.kind === 'system' ? { kind: 'system' as const } : {}) };
}
function canSendChat(status: string): boolean {
  return status === 'active' || status === 'finished';
}

const presetTexts = gameChatPresets.map(item => item.text);
async function history(db: pg.PoolClient, gameId: string, side: GameSide, status: string, after = '0'): Promise<GameChatHistory> {
  const { rows } = await db.query<MessageRow>(`SELECT id, sender_side, body, kind, created_at
    FROM chess.game_chat_messages WHERE game_id = $1 AND id > $2::bigint ORDER BY id DESC LIMIT 100`, [gameId, after]);
  const pref = (await db.query<{ muted: boolean; version: number }>(
    'SELECT muted, version FROM chess.game_chat_preferences WHERE game_id=$1 AND side=$2', [gameId, side])).rows[0];
  const used = await db.query<{ body: GameChatPreset }>(`SELECT DISTINCT body FROM chess.game_chat_messages
    WHERE game_id=$1 AND sender_side=$2 AND kind='user'
      AND body IN ('good game','well played','thank you','got to go','goodbye')`, [gameId, side]);
  return { messages: rows.reverse().map(message), canSend: canSendChat(status),
    muted: pref?.muted ?? false, muteVersion: pref?.version ?? 0, usedPresets: used.rows.map(item => item.body) };
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
      const side = seatId === access.creator_guest_id ? 'white' : 'black';
      const client = await pool.connect();
      try {
        // A single snapshot keeps the shared history and mute state consistent.
        await client.query('BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY');
        const result = await history(client, request.params.id, side, access.status, after);
        await client.query('COMMIT');
        return result;
      } catch (error) {
        await client.query('ROLLBACK');
        throw error;
      } finally { client.release(); }
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
        const previous = (await client.query<MessageRow>(`SELECT id, sender_side, body, kind, created_at
          FROM chess.game_chat_messages WHERE game_id = $1 AND sender_side = $2 AND request_id = $3`,
        [request.params.id, side, requestId])).rows[0];
        if (previous) {
          if (previous.kind !== 'user' || previous.body !== text) return reply.code(409).send({ error: 'request_id_conflict' });
          return message(previous);
        }
        if (!canSendChat(access.status)) return reply.code(409).send({ error: 'chat_read_only' });
        if (presetTexts.includes(text as GameChatPreset)) {
          const used = await client.query(`SELECT 1 FROM chess.game_chat_messages
            WHERE game_id=$1 AND sender_side=$2 AND kind='user' AND body=$3 LIMIT 1`, [request.params.id, side, text]);
          if (used.rowCount) return reply.code(409).send({ error: 'chat_preset_used' });
        }
        const recent = await client.query(`SELECT id FROM chess.game_chat_messages
          WHERE game_id = $1 AND sender_side = $2 AND kind = 'user' AND created_at > clock_timestamp() - interval '10 seconds'
          ORDER BY created_at DESC LIMIT 5`, [request.params.id, side]);
        if (recent.rows.length >= 5) {
          reply.header('Retry-After', '10');
          return reply.code(429).send({ error: 'chat_rate_limited' });
        }
        const row = (await client.query<MessageRow>(`INSERT INTO chess.game_chat_messages
          (game_id, sender_side, request_id, body) VALUES ($1, $2, $3, $4)
          RETURNING id, sender_side, body, kind, created_at`, [request.params.id, side, requestId, text])).rows[0]!;
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

  app.post<{ Params: { id: string }; Body: { muted: boolean } }>('/games/:id/chat/mute',
    { schema: { params, headers: { type: 'object', required: ['idempotency-key'],
      properties: { 'idempotency-key': { type: 'string', pattern: uuid } } },
    body: { type: 'object', required: ['muted'], additionalProperties: false,
      properties: { muted: { type: 'boolean' } } } } }, async (request, reply) => {
      reply.header('Cache-Control', 'no-store');
      const guest = await requireGuest(pool, request, reply, true);
      if (!guest) return;
      const seatId = await participantGuestId(pool, request, guest, request.params.id);
      const client = await pool.connect(); let committed = false;
      try {
        await client.query('BEGIN');
        const access = (await client.query<Access>(`SELECT g.status,c.creator_guest_id,c.acceptor_guest_id
          FROM chess.games g JOIN chess.challenges c ON c.id=g.id WHERE g.id=$1 FOR UPDATE OF g`, [request.params.id])).rows[0];
        if (!access) return reply.code(404).send({ error: 'game_not_found' });
        const side = seatId === access.creator_guest_id ? 'white' : seatId === access.acceptor_guest_id ? 'black' : null;
        if (!side) return reply.code(403).send({ error: 'not_a_participant' });
        const requestId = request.headers['idempotency-key'] as string;
        const previous = (await client.query<{ muted: boolean }>(`SELECT muted FROM chess.game_chat_mute_receipts
          WHERE game_id=$1 AND side=$2 AND request_id=$3`, [request.params.id, side, requestId])).rows[0];
        if (previous && previous.muted !== request.body.muted) return reply.code(409).send({ error: 'request_id_conflict' });
        if (!previous) {
          const recent = await client.query(`SELECT 1 FROM chess.game_chat_mute_receipts
            WHERE game_id=$1 AND side=$2 AND created_at > clock_timestamp()-interval '10 seconds' LIMIT 5`, [request.params.id, side]);
          if (recent.rows.length >= 5) { reply.header('Retry-After', '10'); return reply.code(429).send({ error: 'chat_rate_limited' }); }

          const pref = (await client.query<{ muted: boolean }>(`SELECT muted FROM chess.game_chat_preferences
            WHERE game_id=$1 AND side=$2`, [request.params.id, side])).rows[0];
          if ((pref?.muted ?? false) !== request.body.muted) {
            await client.query(`INSERT INTO chess.game_chat_preferences(game_id,side,muted,version) VALUES($1,$2,$3,1)
              ON CONFLICT(game_id,side) DO UPDATE SET muted=EXCLUDED.muted,version=game_chat_preferences.version+1`,
            [request.params.id, side, request.body.muted]);
            await appendSystemChat(client, request.params.id, side, `mute:${side}:${requestId}`,
              request.body.muted ? 'has muted the chat' : 'has unmuted the chat');
          }
          await client.query(`INSERT INTO chess.game_chat_mute_receipts(game_id,side,request_id,muted) VALUES($1,$2,$3,$4)`,
            [request.params.id, side, requestId, request.body.muted]);
        }
        const result = await history(client, request.params.id, side, access.status);
        await client.query('COMMIT'); committed = true;
        return result;
      } finally { try { if (!committed) await client.query('ROLLBACK'); } finally { client.release(); } }
    });
}
