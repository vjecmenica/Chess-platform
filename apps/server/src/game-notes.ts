import type { FastifyInstance } from 'fastify';
import type pg from 'pg';
import { requireGuest } from './guest-session.js';
import { currentAccount, participantGuestId } from './account-session.js';

export function registerGameNotes(app: FastifyInstance, pool: pg.Pool) {
  const params = { type: 'object', required: ['id'], additionalProperties: false,
    properties: { id: { type: 'string', pattern: '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' } } };
  for (const method of ['GET', 'PUT'] as const) {
    app.route<{ Params: { id: string }; Body: { owner: string; text: string; version: number } }>({
      method, url: '/games/:id/notes', schema: { params, ...(method === 'PUT' ? { body: {
        type: 'object', required: ['owner', 'text', 'version'], additionalProperties: false,
        properties: { owner: { type: 'string', maxLength: 50 }, text: { type: 'string', maxLength: 10000 },
          version: { type: 'integer', minimum: 0, maximum: 2147483646 } },
      } } : {}) }, handler: async (request, reply) => {
        reply.header('Cache-Control', 'no-store');
        const guest = await requireGuest(pool, request, reply, method === 'PUT');
        if (!guest) return;
        const seat = await participantGuestId(pool, request, guest, request.params.id);
        const access = await pool.query(`SELECT 1 FROM chess.games g JOIN chess.challenges c ON c.id=g.id
          WHERE g.id=$1 AND $2 IN (c.creator_guest_id, c.acceptor_guest_id)`, [request.params.id, seat]);
        if (!access.rowCount) return reply.code(403).send({ error: 'not_a_participant' });
        const account = await currentAccount(pool, request, guest);
        const owner = account ? `account:${account.id}` : `guest:${guest.id}`;
        if (method === 'GET') {
          const row = (await pool.query<{ body: string; version: number }>(
            'SELECT body, version FROM chess.game_notes WHERE game_id=$1 AND owner=$2', [request.params.id, owner])).rows[0];
          return { owner, scope: account ? 'account' : 'guest', text: row?.body ?? '', version: row?.version ?? 0 };
        }
        if (request.body.owner !== owner) return reply.code(409).send({ error: 'note_owner_changed' });
        // Atomic compare-and-swap also makes a repeated save safe without move receipts/events.
        const row = (await pool.query<{ version: number }>(`INSERT INTO chess.game_notes (game_id, owner, body, version)
          SELECT $1, $2, $3, 1 WHERE $4::integer=0
          ON CONFLICT (game_id, owner) DO NOTHING RETURNING version`,
        [request.params.id, owner, request.body.text, request.body.version])).rows[0]
          ?? (await pool.query<{ version: number }>(`UPDATE chess.game_notes SET body=$3, version=version+1
            WHERE game_id=$1 AND owner=$2 AND version=$4 RETURNING version`,
          [request.params.id, owner, request.body.text, request.body.version])).rows[0];
        if (!row) return reply.code(409).send({ error: 'note_conflict' });
        return { version: row.version };
      },
    });
  }
}
