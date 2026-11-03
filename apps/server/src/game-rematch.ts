import { randomUUID } from 'node:crypto';
import type { FastifyInstance } from 'fastify';
import type pg from 'pg';
import { timeControlPresets, type TimeControlId, type GameSide, type GameRematchOffer, type GameRematchResponse } from '@chess/contracts';
import { STANDARD_STARTING_FEN } from '@chess/domain';
import { requireGuest } from './guest-session.js';
import { newChallengeSeat, participantGuestId } from './account-session.js';
import { appendSystemChat as event } from './game-chat-events.js';
interface Offer {
  id: string;
  sender_side: GameSide;
  sender_seat: string;
  status: GameRematchOffer['status'];
  new_game_id: string | null;
  expires_at: Date;
}
export function registerRematches(app: FastifyInstance, pool: pg.Pool, now: () => number) {
  const params = { type: 'object', required: ['id'], additionalProperties: false, properties: { id: { type: 'string', format: 'uuid' } } } as const;
  for (const method of ['GET', 'POST'] as const)
    app.route<{
      Params: {
        id: string;
      };
      Body: {
        action: 'offer' | 'accept' | 'decline';
        offerId?: string;
      };
    }>({
      method, url: '/games/:id/rematch', schema: { params, ...(method === 'POST' ? { headers: { type: 'object', required: ['idempotency-key'], properties: { 'idempotency-key': { type: 'string', format: 'uuid' } } }, body: { type: 'object', additionalProperties: false, required: ['action'], properties: { action: { enum: ['offer', 'accept', 'decline'] }, offerId: { type: 'string', format: 'uuid' } } } } : {}) }, handler: async (request, reply) => {
        reply.header('Cache-Control', 'no-store');
        const guest = await requireGuest(pool, request, reply, method === 'POST');
        if (!guest)
          return;
        const client = await pool.connect();
        try {
          await client.query('BEGIN');
          // Account/guest locks precede the game lock, matching normal challenge acquisition.
          const newSeat = method === 'POST' ? await newChallengeSeat(client, request, guest) : null;
          const seat = await participantGuestId(client, request, guest, request.params.id);
          const game = (await client.query<{
            status: string;
            creator_guest_id: string;
            acceptor_guest_id: string;
            time_control: TimeControlId;
          }>(`SELECT g.status,c.creator_guest_id,c.acceptor_guest_id,c.time_control FROM chess.games g JOIN chess.challenges c ON c.id=g.id WHERE g.id=$1 FOR UPDATE OF g`, [request.params.id])).rows[0];
          if (!game)
            return reply.code(404).send({ error: 'game_not_found' });
          const side = seat === game.creator_guest_id ? 'white' : seat === game.acceptor_guest_id ? 'black' : null;
          if (!side)
            return reply.code(403).send({ error: 'not_a_participant' });
          let offer = (await client.query<Offer>('SELECT * FROM chess.game_rematches WHERE game_id=$1 ORDER BY created_at DESC,id DESC LIMIT 1', [request.params.id])).rows[0];
          if (offer?.status === 'pending' && offer.expires_at.getTime() <= Date.now()) {
            await client.query("UPDATE chess.game_rematches SET status='expired' WHERE id=$1", [offer.id]);
            offer.status = 'expired';
            await event(client, request.params.id, offer.sender_side, offer.id + ':expired', 'rematch offer expired (no acceptance received).');
          }
          if (method === 'POST') {
            if (game.status !== 'finished')
              return reply.code(409).send({ error: 'game_not_finished' });
            const action = request.body.action;
            if (action === 'offer') {
              const previous = (await client.query<Offer>('SELECT * FROM chess.game_rematches WHERE game_id=$1 AND sender_side=$2 AND request_id=$3', [request.params.id, side, request.headers['idempotency-key']])).rows[0];
              if (previous)
                offer = previous;
              else if (offer?.status === 'pending')
                return reply.code(409).send({ error: 'rematch_already_pending' });
              else {
                const opponent = side === 'white' ? game.acceptor_guest_id : game.creator_guest_id;
                if (!(await client.query('SELECT id FROM chess.guest_sessions WHERE id=$1 AND (account_id IS NOT NULL OR expires_at>now())', [opponent])).rowCount)
                  return reply.code(409).send({ error: 'opponent_unavailable' });
                if (Number((await client.query<{
                  count: string;
                }>("SELECT count(*) FROM chess.game_rematches WHERE game_id=$1 AND created_at>now()-interval '10 minutes'", [request.params.id])).rows[0]!.count) >= 5)
                  return reply.code(429).send({ error: 'rematch_rate_limited' });
                offer = (await client.query<Offer>("INSERT INTO chess.game_rematches(id,game_id,sender_side,sender_seat,request_id,status) VALUES($1,$2,$3,$4,$5,'pending') RETURNING *", [randomUUID(), request.params.id, side, newSeat, request.headers['idempotency-key']])).rows[0]!;
                await event(client, request.params.id, side, offer.id + ':offer', 'offered a rematch.');
              }
            }
            else {
              if (!offer || request.body.offerId !== offer.id || side === offer.sender_side)
                return reply.code(409).send({ error: 'invalid_rematch_offer' });
              const wanted = action === 'accept' ? 'accepted' : 'declined';
              if (offer.status !== wanted) {
                if (offer.status !== 'pending')
                  return reply.code(409).send({ error: 'rematch_offer_closed' });
                if (action === 'accept') {
                  const owners = (await client.query<{
                    id: string;
                    account_id: string | null;
                  }>('SELECT id,account_id FROM chess.guest_sessions WHERE id IN ($1,$2)', [newSeat, offer.sender_seat])).rows;
                  if (newSeat === offer.sender_seat || owners.length !== 2 || owners[0]!.account_id !== null && owners[0]!.account_id === owners[1]!.account_id)
                    return reply.code(403).send({ error: 'cannot_play_both_sides' });
                  const id = randomUUID();
                  // Swap colors; occupy only after the invited original opponent accepts.
                  await client.query('INSERT INTO chess.challenges(id,creator_guest_id,acceptor_guest_id,create_request_id,time_control,accepted_at) VALUES($1,$2,$3,$4,$5,now())', [id, offer.sender_side === 'white' ? newSeat : offer.sender_seat, offer.sender_side === 'white' ? offer.sender_seat : newSeat, offer.id, game.time_control]);
                  await client.query(`INSERT INTO chess.games(id,starting_fen,fen,side_to_move,status,clock_mode,clock_phase,clock_start_mode,white_first_move_deadline_at,white_remaining_ms,black_remaining_ms)
        VALUES($1,$2,$2,'white','active','five_plus_three','awaiting_first_move','first_move_grace',$3,$4,$4)`, [id, STANDARD_STARTING_FEN, new Date(now() + 30000), timeControlPresets[game.time_control].initialMs]);
                  offer.new_game_id = id;
                }
                offer.status = wanted;
                await client.query('UPDATE chess.game_rematches SET status=$2,new_game_id=$3 WHERE id=$1', [offer.id, wanted, offer.new_game_id]);
                await event(client, request.params.id, side, offer.id + ':response', wanted + ' the rematch offer.');
              }
            }
          }
          await client.query('COMMIT');
          return { offer: offer ? { id: offer.id, side: offer.sender_side, status: offer.status, newGameId: offer.new_game_id, expiresAt: offer.expires_at.toISOString() } : null } satisfies GameRematchResponse;
        }
        finally {
          try {
            await client.query('ROLLBACK');
          }
          finally {
            client.release();
          }
        }
      }
    });
}
