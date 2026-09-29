import { isDeepStrictEqual } from 'node:util';
import type { FastifyInstance } from 'fastify';
import type pg from 'pg';
import { createGame, STANDARD_STARTING_FEN } from '@chess/domain';
import type { ChessGame, GameResult, MoveRecord, Promotion, Side } from '@chess/domain';
import type { GameReadResponse, GameState, MoveAcceptedResponse } from '@chess/contracts';
import { requireGuest } from './guest-session.js';

const uuid = '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$';
const square = '^[a-h][1-8]$';
const idParams = { type: 'object', required: ['id'], additionalProperties: false,
  properties: { id: { type: 'string', pattern: uuid } } } as const;
const requestHeaders = { type: 'object', required: ['idempotency-key'],
  properties: { 'idempotency-key': { type: 'string', pattern: uuid } } } as const;
const moveBody = { type: 'object', required: ['expectedVersion', 'from', 'to'], additionalProperties: false,
  properties: { expectedVersion: { type: 'integer', minimum: 0, maximum: 2147483646 },
    from: { type: 'string', pattern: square }, to: { type: 'string', pattern: square },
    promotion: { type: 'string', enum: ['q', 'r', 'b', 'n'] } } } as const;

interface MoveBody {
  expectedVersion: number;
  from: string;
  to: string;
  promotion?: Promotion;
}

interface GameRow {
  id: string;
  creator_guest_id: string;
  acceptor_guest_id: string;
  starting_fen: string;
  fen: string;
  side_to_move: Side;
  status: 'active' | 'finished';
  result: GameResult | null;
  version: number;
}

interface StoredMove { ply: number; record: MoveRecord }
interface Receipt { payload: MoveBody; response: MoveAcceptedResponse }
interface HttpResult { status: number; body: unknown }

async function loadGame(client: pg.PoolClient, id: string, lock = false): Promise<GameRow | null> {
  const { rows } = await client.query<GameRow>(
    `SELECT g.id, g.starting_fen, g.fen, g.side_to_move, g.status, g.result, g.version,
      c.creator_guest_id, c.acceptor_guest_id
      FROM chess.games g JOIN chess.challenges c ON c.id = g.id WHERE g.id = $1
      ${lock ? 'FOR UPDATE OF g' : ''}`, [id],
  );
  return rows[0] ?? null;
}

function seat(row: GameRow, guestId: string): Side | null {
  if (row.creator_guest_id === guestId) return 'white';
  if (row.acceptor_guest_id === guestId) return 'black';
  return null;
}

async function reconstruct(client: pg.PoolClient, row: GameRow): Promise<ChessGame> {
  if (row.starting_fen !== STANDARD_STARTING_FEN) throw new Error('Unsupported saved starting position.');
  const game = createGame();
  const { rows } = await client.query<StoredMove>(
    'SELECT ply, record FROM chess.game_moves WHERE game_id = $1 ORDER BY ply', [row.id],
  );
  for (const [index, stored] of rows.entries()) {
    if (stored.ply !== index + 1 || !stored.record || typeof stored.record !== 'object') {
      throw new Error('Saved move history is incomplete.');
    }
    const move = stored.record;
    const replayed = game.submitMove({ side: move.side, from: move.from, to: move.to,
      ...(move.promotion === undefined ? {} : { promotion: move.promotion }) });
    if (!replayed.accepted || !isDeepStrictEqual(replayed.move, move)) {
      throw new Error('Saved move history does not replay.');
    }
  }
  const state = game.getState();
  if (state.status === 'pending_adjudication' || row.version !== rows.length
    || row.fen !== state.position.fen || row.side_to_move !== state.position.sideToMove
    || row.status !== state.status || !isDeepStrictEqual(row.result, state.result)) {
    throw new Error('Saved game state does not match its history.');
  }
  return game;
}

function stateResponse(row: GameRow, game: ChessGame, yourSeat: Side, version = row.version): GameState {
  const state = game.getState();
  if (state.status === 'pending_adjudication') throw new Error('Unexpected pending game.');
  return { id: row.id, version, status: state.status, position: state.position, result: state.result,
    clocks: null, clockStatus: 'not_integrated',
    timeControl: { initialMs: 300_000, incrementMs: 3_000 }, rated: false, yourSeat };
}

async function readSavedGame(pool: pg.Pool, id: string, guestId: string): Promise<HttpResult> {
  const client = await pool.connect();
  try {
    await client.query('BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY');
    const row = await loadGame(client, id);
    if (row === null) {
      await client.query('COMMIT');
      return { status: 404, body: { error: 'game_not_found' } };
    }
    const yourSeat = seat(row, guestId);
    if (yourSeat === null) {
      await client.query('COMMIT');
      return { status: 403, body: { error: 'not_a_participant' } };
    }
    const game = await reconstruct(client, row);
    const body: GameReadResponse = { ...stateResponse(row, game, yourSeat), history: game.getHistory() };
    await client.query('COMMIT');
    return { status: 200, body };
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}

async function submitSavedMove(pool: pg.Pool, id: string, guestId: string,
  requestId: string, body: MoveBody): Promise<HttpResult> {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const row = await loadGame(client, id, true);
    let result: HttpResult;
    if (row === null) result = { status: 404, body: { error: 'game_not_found' } };
    else {
      const yourSeat = seat(row, guestId);
      if (yourSeat === null) result = { status: 403, body: { error: 'not_a_participant' } };
      else {
        const game = await reconstruct(client, row);
        const { rows: receipts } = await client.query<Receipt>(
          `SELECT payload, response FROM chess.game_move_receipts
            WHERE game_id = $1 AND guest_id = $2 AND request_id = $3`, [id, guestId, requestId],
        );
        const payload = { expectedVersion: body.expectedVersion, from: body.from, to: body.to,
          ...(body.promotion === undefined ? {} : { promotion: body.promotion }) };
        const receipt = receipts[0];
        if (receipt) result = isDeepStrictEqual(receipt.payload, payload)
          ? { status: 200, body: receipt.response }
          : { status: 409, body: { error: 'request_id_conflict' } };
        else if (body.expectedVersion !== row.version) {
          result = { status: 409, body: { error: 'stale_version', currentVersion: row.version } };
        } else if (row.status === 'finished') result = { status: 409, body: { error: 'game_finished' } };
        else {
          const submitted = game.submitMove({ side: yourSeat, from: body.from, to: body.to,
            ...(body.promotion === undefined ? {} : { promotion: body.promotion }) });
          if (!submitted.accepted) {
            result = { status: submitted.reason === 'wrong_turn' ? 409 : 422,
              body: { error: submitted.reason, message: submitted.message } };
          } else {
            const next = game.getState();
            if (next.status === 'pending_adjudication') throw new Error('Unexpected pending move result.');
            const version = row.version + 1;
            const response: MoveAcceptedResponse = { accepted: true, move: submitted.move,
              game: stateResponse(row, game, yourSeat, version) };
            await client.query(
              'INSERT INTO chess.game_moves (game_id, ply, record) VALUES ($1, $2, $3::jsonb)',
              [id, version, JSON.stringify(submitted.move)],
            );
            await client.query(
              `UPDATE chess.games SET fen = $2, side_to_move = $3, status = $4,
                result = $5::jsonb, version = $6, updated_at = now() WHERE id = $1`,
              [id, next.position.fen, next.position.sideToMove, next.status,
                next.result === null ? null : JSON.stringify(next.result), version],
            );
            await client.query(
              `INSERT INTO chess.game_move_receipts (game_id, guest_id, request_id, payload, response)
                VALUES ($1, $2, $3, $4::jsonb, $5::jsonb)`,
              [id, guestId, requestId, JSON.stringify(payload), JSON.stringify(response)],
            );
            result = { status: 200, body: response };
          }
        }
      }
    }
    await client.query('COMMIT');
    return result;
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}

export function registerGameRoutes(app: FastifyInstance, pool: pg.Pool): void {
  app.get<{ Params: { id: string } }>('/games/:id', { schema: { params: idParams } },
    async (request, reply) => {
      reply.header('Cache-Control', 'no-store');
      const guest = await requireGuest(pool, request, reply);
      if (guest === null) return;
      const result = await readSavedGame(pool, request.params.id, guest.id);
      return reply.code(result.status).send(result.body);
    });

  app.post<{ Params: { id: string }; Body: MoveBody }>('/games/:id/moves',
    { schema: { params: idParams, headers: requestHeaders, body: moveBody } },
    async (request, reply) => {
      reply.header('Cache-Control', 'no-store');
      const guest = await requireGuest(pool, request, reply, true);
      if (guest === null) return;
      const requestId = request.headers['idempotency-key'];
      if (typeof requestId !== 'string') return reply.code(400).send({ error: 'invalid_idempotency_key' });
      const result = await submitSavedMove(pool, request.params.id, guest.id, requestId, request.body);
      return reply.code(result.status).send(result.body);
    });
}
