import { isDeepStrictEqual } from 'node:util';
import type pg from 'pg';
import { createGame, FIVE_PLUS_THREE, STANDARD_STARTING_FEN } from '@chess/domain';
import type { ChessGame, GameResult, MoveRecord, MoveRequest, Promotion, Side } from '@chess/domain';
import type { ClockState, GameReadResponse, GameState, MoveAcceptedResponse } from '@chess/contracts';

export interface WallClock { nowMs(): number }
export const systemClock: WallClock = { nowMs: () => Date.now() };
export interface MoveBody { expectedVersion: number; from: string; to: string; promotion?: Promotion }
export interface ServiceResult { status: number; body: unknown }

type Status = 'waiting' | 'active' | 'pending_adjudication' | 'finished';
type ClockPhase = 'legacy_untimed' | 'waiting' | 'running' | 'stopped' | 'flagged';
interface GameRow {
  id: string;
  creator_guest_id: string;
  acceptor_guest_id: string;
  starting_fen: string;
  fen: string;
  side_to_move: Side;
  status: Status;
  result: GameResult | null;
  pending: { kind: 'timeout'; flaggedSide: Side; deadlineMs: number } | null;
  timeout_witness: readonly Omit<MoveRequest, 'side'>[] | null;
  version: number;
  clock_mode: 'legacy_untimed' | 'five_plus_three';
  clock_phase: ClockPhase;
  ready_white: boolean;
  ready_black: boolean;
  white_remaining_ms: number;
  black_remaining_ms: number;
  turn_started_at: Date | null;
  deadline_at: Date | null;
  flagged_side: Side | null;
  flagged_at: Date | null;
}
interface StoredMove { ply: number; record: MoveRecord }
interface Receipt { payload: MoveBody; response: unknown; status_code: number }

function now(clock: WallClock): number {
  const value = clock.nowMs();
  if (!Number.isSafeInteger(value) || value < 0) throw new RangeError('The wall clock must return nonnegative integer milliseconds.');
  return value;
}

function seat(row: GameRow, guestId: string): Side | null {
  if (row.creator_guest_id === guestId) return 'white';
  if (row.acceptor_guest_id === guestId) return 'black';
  return null;
}

async function loadGame(client: pg.PoolClient, id: string): Promise<GameRow | null> {
  const { rows } = await client.query<GameRow>(
    `SELECT g.*, c.creator_guest_id, c.acceptor_guest_id
      FROM chess.games g JOIN chess.challenges c ON c.id = g.id
      WHERE g.id = $1 FOR UPDATE OF g`, [id],
  );
  return rows[0] ?? null;
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
  if (row.flagged_side !== null) {
    if (row.flagged_at === null) throw new Error('Saved flag has no deadline.');
    const flagged = game.flagTimeout({ flaggedSide: row.flagged_side,
      deadlineMs: row.flagged_at.getTime(),
      ...(row.timeout_witness === null ? {} : { mateLine: row.timeout_witness }) });
    if (!flagged.accepted) throw new Error('Saved flag cannot be replayed.');
  }
  const state = game.getState();
  const expectedVersion = rows.length + (row.clock_mode === 'five_plus_three'
    ? Number(row.ready_white) + Number(row.ready_black) + Number(row.flagged_side !== null) : 0);
  const expectedStatus = row.status === 'waiting' ? 'active' : row.status;
  if (row.version !== expectedVersion || row.fen !== state.position.fen
    || row.side_to_move !== state.position.sideToMove || expectedStatus !== state.status
    || !isDeepStrictEqual(row.result, state.result)
    || !isDeepStrictEqual(row.pending, state.status === 'pending_adjudication' ? state.pending : null)) {
    throw new Error('Saved game state does not match its history.');
  }
  if (row.clock_mode === 'five_plus_three') {
    if (row.status === 'waiting' && (row.clock_phase !== 'waiting' || row.ready_white && row.ready_black)
      || row.status === 'active' && (row.clock_phase !== 'running' || !row.ready_white || !row.ready_black
        || row.turn_started_at === null || row.deadline_at === null)
      || row.flagged_side !== null && row.clock_phase !== 'flagged'
      || row.status === 'finished' && row.flagged_side === null && row.clock_phase !== 'stopped') {
      throw new Error('Saved clock state is inconsistent.');
    }
  }
  return game;
}

function clockResponse(row: GameRow, atMs: number): ClockState | null {
  if (row.clock_mode === 'legacy_untimed') return null;
  const remaining = { white: row.white_remaining_ms, black: row.black_remaining_ms };
  const activeSide = row.clock_phase === 'running' ? row.side_to_move : null;
  if (activeSide !== null && row.turn_started_at !== null) {
    remaining[activeSide] = Math.max(0, remaining[activeSide] - Math.max(0, atMs - row.turn_started_at.getTime()));
  }
  return { phase: row.clock_phase as ClockState['phase'],
    ready: { white: row.ready_white, black: row.ready_black }, remainingMs: remaining,
    activeSide, deadlineMs: row.deadline_at?.getTime() ?? null,
    flaggedSide: row.flagged_side, flaggedAtMs: row.flagged_at?.getTime() ?? null,
    serverNowMs: atMs, outagePolicy: 'continues_through_server_outage' };
}

function gameState(row: GameRow, game: ChessGame, yourSeat: Side, atMs: number): GameState {
  const state = game.getState();
  return { id: row.id, version: row.version, status: row.status, position: state.position,
    result: row.result, ...(row.pending === null ? {} : { pending: row.pending }),
    clocks: clockResponse(row, atMs),
    clockStatus: row.clock_mode === 'five_plus_three' ? 'authoritative' : 'not_integrated',
    timeControl: { initialMs: FIVE_PLUS_THREE.initialMs, incrementMs: FIVE_PLUS_THREE.incrementMs },
    rated: false, yourSeat };
}

function gameRead(row: GameRow, game: ChessGame, yourSeat: Side, atMs: number): GameReadResponse {
  return { ...gameState(row, game, yourSeat, atMs), history: game.getHistory() };
}

async function saveGame(client: pg.PoolClient, row: GameRow): Promise<void> {
  await client.query(
    `UPDATE chess.games SET fen = $2, side_to_move = $3, status = $4, result = $5::jsonb,
      pending = $6::jsonb, version = $7, clock_phase = $8, ready_white = $9, ready_black = $10,
      white_remaining_ms = $11, black_remaining_ms = $12, turn_started_at = $13,
      deadline_at = $14, flagged_side = $15, flagged_at = $16, timeout_witness = $17::jsonb,
      updated_at = now() WHERE id = $1`,
    [row.id, row.fen, row.side_to_move, row.status,
      row.result === null ? null : JSON.stringify(row.result),
      row.pending === null ? null : JSON.stringify(row.pending), row.version, row.clock_phase,
      row.ready_white, row.ready_black, row.white_remaining_ms, row.black_remaining_ms,
      row.turn_started_at, row.deadline_at, row.flagged_side, row.flagged_at,
      row.timeout_witness === null ? null : JSON.stringify(row.timeout_witness)],
  );
}

async function expireIfDue(client: pg.PoolClient, row: GameRow, game: ChessGame,
  atMs: number): Promise<boolean> {
  if (row.clock_phase !== 'running' || row.deadline_at === null
    || atMs < row.deadline_at.getTime()) return false;
  const deadlineMs = row.deadline_at.getTime();
  const decision = game.flagTimeout({ flaggedSide: row.side_to_move, deadlineMs,
    ...(row.timeout_witness === null ? {} : { mateLine: row.timeout_witness }) });
  if (!decision.accepted) throw new Error('The saved game could not be flagged.');
  const state = game.getState();
  row.status = state.status;
  row.result = state.result;
  row.pending = state.status === 'pending_adjudication' && state.pending.kind === 'timeout'
    ? state.pending : null;
  if (row.side_to_move === 'white') row.white_remaining_ms = 0;
  else row.black_remaining_ms = 0;
  row.clock_phase = 'flagged';
  row.flagged_side = row.side_to_move;
  row.flagged_at = new Date(deadlineMs);
  row.turn_started_at = null;
  row.deadline_at = null;
  row.version += 1;
  await saveGame(client, row);
  return true;
}

export interface GameService {
  read(id: string, guestId: string): Promise<ServiceResult>;
  ready(id: string, guestId: string): Promise<ServiceResult>;
  move(id: string, guestId: string, requestId: string, body: MoveBody, receivedAtMs: number): Promise<ServiceResult>;
  pollDueGames(): Promise<number>;
  receiptTime(): number;
  /** Background preparation only. A witness is verified before it can affect a timeout. */
  registerTimeoutWitness(id: string, line: readonly Omit<MoveRequest, 'side'>[]): Promise<boolean>;
}

export function createGameService(pool: pg.Pool, clock: WallClock = systemClock): GameService {
  const queues = new Map<string, Promise<unknown>>();
  function serialize<T>(id: string, action: () => Promise<T>): Promise<T> {
    const previous = queues.get(id) ?? Promise.resolve();
    const work = previous.catch(() => undefined).then(action);
    queues.set(id, work);
    const clear = () => { if (queues.get(id) === work) queues.delete(id); };
    void work.then(clear, clear);
    return work;
  }

  async function transaction<T>(action: (client: pg.PoolClient) => Promise<T>): Promise<T> {
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      const result = await action(client);
      await client.query('COMMIT');
      return result;
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  }

  const notFound: ServiceResult = { status: 404, body: { error: 'game_not_found' } };
  const notParticipant: ServiceResult = { status: 403, body: { error: 'not_a_participant' } };

  return {
    receiptTime: () => now(clock),
    read(id, guestId) {
      return serialize(id, () => transaction(async client => {
        const row = await loadGame(client, id);
        if (row === null) return notFound;
        const yourSeat = seat(row, guestId);
        if (yourSeat === null) return notParticipant;
        const game = await reconstruct(client, row);
        const atMs = now(clock);
        await expireIfDue(client, row, game, atMs);
        return { status: 200, body: gameRead(row, game, yourSeat, atMs) };
      }));
    },
    ready(id, guestId) {
      return serialize(id, () => transaction(async client => {
        const row = await loadGame(client, id);
        if (row === null) return notFound;
        const yourSeat = seat(row, guestId);
        if (yourSeat === null) return notParticipant;
        const game = await reconstruct(client, row);
        if (row.clock_mode !== 'five_plus_three') {
          return { status: 409, body: { error: 'legacy_untimed_game' } };
        }
        const atMs = now(clock);
        await expireIfDue(client, row, game, atMs);
        if (row.status === 'waiting' && !(yourSeat === 'white' ? row.ready_white : row.ready_black)) {
          if (yourSeat === 'white') row.ready_white = true;
          else row.ready_black = true;
          row.version += 1;
          if (row.ready_white && row.ready_black) {
            row.status = 'active';
            row.clock_phase = 'running';
            row.turn_started_at = new Date(atMs);
            row.deadline_at = new Date(atMs + row.white_remaining_ms);
          }
          await saveGame(client, row);
        }
        return { status: 200, body: gameRead(row, game, yourSeat, atMs) };
      }));
    },
    move(id, guestId, requestId, body, receivedAtMs) {
      return serialize(id, () => transaction(async client => {
        const row = await loadGame(client, id);
        if (row === null) return notFound;
        const yourSeat = seat(row, guestId);
        if (yourSeat === null) return notParticipant;
        const game = await reconstruct(client, row);
        const payload = { expectedVersion: body.expectedVersion, from: body.from, to: body.to,
          ...(body.promotion === undefined ? {} : { promotion: body.promotion }) };
        const { rows: receipts } = await client.query<Receipt>(
          `SELECT payload, response, status_code FROM chess.game_move_receipts
            WHERE game_id = $1 AND guest_id = $2 AND request_id = $3`, [id, guestId, requestId],
        );
        const receipt = receipts[0];
        if (receipt) return isDeepStrictEqual(receipt.payload, payload)
          ? { status: receipt.status_code, body: receipt.response }
          : { status: 409, body: { error: 'request_id_conflict' } };

        let result: ServiceResult;
        if (row.clock_mode === 'five_plus_three' && row.clock_phase === 'running'
          && row.deadline_at !== null && receivedAtMs >= row.deadline_at.getTime()) {
          await expireIfDue(client, row, game, receivedAtMs);
          result = { status: 409, body: { error: 'flag_fell', currentVersion: row.version } };
        } else if (row.status === 'waiting') {
          result = { status: 409, body: { error: 'clock_not_started' } };
        } else if (body.expectedVersion !== row.version) {
          result = { status: 409, body: { error: 'stale_version', currentVersion: row.version } };
        } else if (row.status !== 'active') {
          result = { status: 409, body: { error: row.status === 'finished'
            ? 'game_finished' : 'adjudication_pending' } };
        } else if (row.clock_mode === 'five_plus_three' && row.turn_started_at !== null
          && receivedAtMs < row.turn_started_at.getTime()) {
          result = { status: 409, body: { error: 'received_before_turn' } };
        } else {
          const submitted = game.submitMove({ side: yourSeat, from: body.from, to: body.to,
            ...(body.promotion === undefined ? {} : { promotion: body.promotion }) });
          if (!submitted.accepted) {
            result = { status: submitted.reason === 'wrong_turn' ? 409 : 422,
              body: { error: submitted.reason, message: submitted.message } };
          } else {
            const state = game.getState();
            if (state.status === 'pending_adjudication') throw new Error('Unexpected pending move result.');
            row.fen = state.position.fen;
            row.side_to_move = state.position.sideToMove;
            row.status = state.status;
            row.result = state.result;
            row.timeout_witness = null;
            row.version += 1;
            if (row.clock_mode === 'five_plus_three') {
              const movingSide = yourSeat;
              const startedAtMs = row.turn_started_at?.getTime();
              if (startedAtMs === undefined) throw new Error('Running game has no turn start.');
              const left = Math.max(0, (movingSide === 'white'
                ? row.white_remaining_ms : row.black_remaining_ms) - (receivedAtMs - startedAtMs))
                + FIVE_PLUS_THREE.incrementMs;
              if (movingSide === 'white') row.white_remaining_ms = left;
              else row.black_remaining_ms = left;
            }
            await client.query(
              'INSERT INTO chess.game_moves (game_id, ply, record) VALUES ($1, $2, $3::jsonb)',
              [id, submitted.move.ply, JSON.stringify(submitted.move)],
            );
            const confirmedAtMs = Math.max(receivedAtMs, now(clock));
            if (row.clock_mode === 'five_plus_three') {
              if (row.status === 'active') {
                row.clock_phase = 'running';
                row.turn_started_at = new Date(confirmedAtMs);
                row.deadline_at = new Date(confirmedAtMs + (row.side_to_move === 'white'
                  ? row.white_remaining_ms : row.black_remaining_ms));
              } else {
                row.clock_phase = 'stopped';
                row.turn_started_at = null;
                row.deadline_at = null;
              }
            }
            await saveGame(client, row);
            const response: MoveAcceptedResponse = { accepted: true, move: submitted.move,
              game: gameState(row, game, yourSeat, confirmedAtMs) };
            result = { status: 200, body: response };
          }
        }
        if (row.clock_mode === 'five_plus_three' || result.status === 200) {
          await client.query(
            `INSERT INTO chess.game_move_receipts
              (game_id, guest_id, request_id, payload, response, status_code, received_at)
              VALUES ($1, $2, $3, $4::jsonb, $5::jsonb, $6, $7)`,
            [id, guestId, requestId, JSON.stringify(payload), JSON.stringify(result.body),
              result.status, new Date(receivedAtMs)],
          );
        }
        return result;
      }));
    },
    async pollDueGames() {
      const atMs = now(clock);
      const { rows } = await pool.query<{ id: string }>(
        `SELECT id FROM chess.games WHERE clock_mode = 'five_plus_three'
          AND clock_phase = 'running' AND deadline_at <= $1`, [new Date(atMs)],
      );
      let changed = 0;
      for (const { id } of rows) {
        const flagged = await serialize(id, () => transaction(async client => {
          const row = await loadGame(client, id);
          if (row === null) return false;
          const game = await reconstruct(client, row);
          return expireIfDue(client, row, game, now(clock));
        }));
        if (flagged) changed += 1;
      }
      return changed;
    },
    registerTimeoutWitness(id, line) {
      return serialize(id, () => transaction(async client => {
        const row = await loadGame(client, id);
        if (row === null || row.clock_phase !== 'running' || row.deadline_at === null
          || now(clock) >= row.deadline_at.getTime()) return false;
        const game = await reconstruct(client, row);
        const winner: Side = row.side_to_move === 'white' ? 'black' : 'white';
        if (!game.verifyMateLine(winner, line)) return false;
        row.timeout_witness = line.map(move => ({ from: move.from, to: move.to,
          ...(move.promotion === undefined ? {} : { promotion: move.promotion }) }));
        await saveGame(client, row);
        return true;
      }));
    },
  };
}
