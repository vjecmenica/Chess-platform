import { randomUUID } from 'node:crypto';
import type pg from 'pg';
import type { GameSide } from '@chess/contracts';

/** The caller holds the game lock; notification is delivered only on commit. */
export async function appendSystemChat(client: pg.PoolClient, gameId: string,
  side: GameSide, key: string, text: string): Promise<void> {
  const row = (await client.query<{ id: string }>(`INSERT INTO chess.game_chat_messages
    (game_id, sender_side, request_id, body, kind, event_key)
    VALUES ($1,$2,$3,$4,'system',$5)
    ON CONFLICT (game_id,event_key) WHERE event_key IS NOT NULL DO NOTHING RETURNING id`,
  [gameId, side, randomUUID(), text, key])).rows[0];
  if (row) await client.query("SELECT pg_notify('chess_game_updates',$1)",
    [JSON.stringify({ id: gameId, chatId: row.id })]);
}
