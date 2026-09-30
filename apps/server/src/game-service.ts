import { isDeepStrictEqual } from 'node:util';
import { randomUUID } from 'node:crypto';
import type pg from 'pg';
import { createGame, FIVE_PLUS_THREE, STANDARD_STARTING_FEN } from '@chess/domain';
import type { ChessGame, GameResult, MoveRecord, MoveRequest, Promotion, Side } from '@chess/domain';
import type { ClockState, GameActionAcceptedResponse, GameReadResponse, GameState, MoveAcceptedResponse } from '@chess/contracts';

export interface WallClock { nowMs(): number }
export const systemClock: WallClock = { nowMs: () => Date.now() };
export interface MoveBody { expectedVersion: number; from: string; to: string; promotion?: Promotion }
export type GameAction = 'resign' | 'offer_draw' | 'accept_draw' | 'decline_draw';
export interface ActionBody { expectedVersion: number }
export interface ServiceResult { status: number; body: unknown }

type Status = 'waiting' | 'active' | 'pending_adjudication' | 'finished';
type ClockPhase = 'legacy_untimed' | 'waiting' | 'awaiting_first_move' | 'running' | 'handoff' | 'stopped' | 'flagged';
interface GameRow {
  id: string;
  creator_guest_id: string;
  acceptor_guest_id: string;
  starting_fen: string;
  fen: string;
  side_to_move: Side;
  status: Status;
  result: GameResult | null;
  pending: { kind: 'timeout'; flaggedSide: Side; deadlineMs: number }
    | { kind: 'resignation'; resigningSide: Side } | null;
  draw_offer: Side | null;
  resignation_witness: readonly Omit<MoveRequest, 'side'>[] | null;
  timeout_witness: readonly Omit<MoveRequest, 'side'>[] | null;
  version: number;
  clock_mode: 'legacy_untimed' | 'five_plus_three';
  clock_start_mode: 'readiness' | 'first_move';
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
interface StoredAction { version: number; after_ply: number; side: Side; kind: GameAction }
interface Receipt {
  admission_id: string;
  guest_id: string;
  request_id: string;
  kind: 'move' | GameAction;
  payload: MoveBody | ActionBody;
  response: unknown | null;
  status_code: number | null;
  received_at: Date;
  applied: boolean;
}

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
  const { rows: actions } = await client.query<StoredAction>(
    'SELECT version, after_ply, side, kind FROM chess.game_actions WHERE game_id = $1 ORDER BY version', [row.id]);
  let actionIndex = 0;
  function replayActions(afterPly: number) {
    while (actions[actionIndex]?.after_ply === afterPly) {
      const action = actions[actionIndex]!;
      const replayed = action.kind === 'resign' ? game.resign({ side: action.side })
        : action.kind === 'offer_draw' ? game.offerDraw({ side: action.side })
          : action.kind === 'accept_draw' ? game.acceptDraw({ side: action.side })
            : game.declineDraw({ side: action.side });
      if (!replayed.accepted) throw new Error('Saved game action cannot be replayed.');
      actionIndex += 1;
    }
  }
  replayActions(0);
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
    replayActions(index + 1);
  }
  if (actionIndex !== actions.length) throw new Error('Saved game actions are out of order.');
  if (row.flagged_side !== null) {
    if (row.flagged_at === null) throw new Error('Saved flag has no deadline.');
    const flagged = game.flagTimeout({ flaggedSide: row.flagged_side,
      deadlineMs: row.flagged_at.getTime(),
      ...(row.timeout_witness === null ? {} : { mateLine: row.timeout_witness }) });
    if (!flagged.accepted) throw new Error('Saved flag cannot be replayed.');
  }
  if (row.resignation_witness !== null) {
    const resolved = game.resolveResignation({ verdict: 'mate_possible', mateLine: row.resignation_witness });
    if (!resolved.accepted) throw new Error('Saved resignation ruling cannot be replayed.');
  }
  const state = game.getState();
  const expectedVersion = rows.length + (row.clock_mode === 'five_plus_three'
    ? (row.clock_start_mode === 'readiness'
      ? Number(row.ready_white) + Number(row.ready_black) : 0)
      + Number(row.flagged_side !== null) : 0) + actions.length
    + Number(row.resignation_witness !== null);
  const expectedStatus = row.status === 'waiting' ? 'active' : row.status;
  if (row.version !== expectedVersion || row.fen !== state.position.fen
    || row.side_to_move !== state.position.sideToMove || expectedStatus !== state.status
    || !isDeepStrictEqual(row.result, state.result)
    || row.draw_offer !== state.drawOffer
    || !isDeepStrictEqual(row.pending, state.status === 'pending_adjudication' ? state.pending : null)) {
    throw new Error('Saved game state does not match its history.');
  }
  if (row.clock_mode === 'five_plus_three') {
    const firstMoveWaiting = row.clock_start_mode === 'first_move'
      && row.clock_phase === 'awaiting_first_move';
    if (row.clock_start_mode === 'first_move'
        && (row.ready_white || row.ready_black || row.status === 'waiting')
      || row.clock_start_mode === 'readiness' && row.clock_phase === 'awaiting_first_move'
      || firstMoveWaiting && (row.status !== 'active' || rows.length !== 0
        || row.side_to_move !== 'white' || row.white_remaining_ms !== FIVE_PLUS_THREE.initialMs
        || row.black_remaining_ms !== FIVE_PLUS_THREE.initialMs
        || row.turn_started_at !== null || row.deadline_at !== null)
      || row.status === 'waiting' && (row.clock_phase !== 'waiting' || row.ready_white && row.ready_black)
      || row.status === 'active' && !firstMoveWaiting && (row.clock_phase !== 'running' && row.clock_phase !== 'handoff'
        || row.clock_start_mode === 'readiness' && (!row.ready_white || !row.ready_black)
        || row.clock_start_mode === 'first_move' && rows.length === 0
        || row.clock_phase === 'running' && (row.turn_started_at === null || row.deadline_at === null)
        || row.clock_phase === 'handoff' && (row.turn_started_at !== null || row.deadline_at !== null))
      || row.flagged_side !== null && row.clock_phase !== 'flagged'
      || (row.status === 'finished' || row.pending?.kind === 'resignation')
        && row.flagged_side === null && row.clock_phase !== 'stopped') {
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
  return { startMode: row.clock_start_mode, phase: row.clock_phase as ClockState['phase'],
    ready: { white: row.ready_white, black: row.ready_black }, remainingMs: remaining,
    activeSide, deadlineMs: row.deadline_at?.getTime() ?? null,
    flaggedSide: row.flagged_side, flaggedAtMs: row.flagged_at?.getTime() ?? null,
    serverNowMs: atMs, outagePolicy: 'continues_through_server_outage' };
}

function gameState(row: GameRow, game: ChessGame, yourSeat: Side, atMs: number): GameState {
  const state = game.getState();
  return { id: row.id, version: row.version, status: row.status, position: state.position,
    result: row.result, drawOffer: state.drawOffer,
    ...(row.pending === null ? {} : { pending: row.pending }),
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
      draw_offer = $18, resignation_witness = $19::jsonb,
      updated_at = now() WHERE id = $1`,
    [row.id, row.fen, row.side_to_move, row.status,
      row.result === null ? null : JSON.stringify(row.result),
      row.pending === null ? null : JSON.stringify(row.pending), row.version, row.clock_phase,
      row.ready_white, row.ready_black, row.white_remaining_ms, row.black_remaining_ms,
      row.turn_started_at, row.deadline_at, row.flagged_side, row.flagged_at,
      row.timeout_witness === null ? null : JSON.stringify(row.timeout_witness), row.draw_offer,
      row.resignation_witness === null ? null : JSON.stringify(row.resignation_witness)],
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
  row.draw_offer = state.drawOffer;
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

export interface Arrival {
  readonly receivedAtMs: number;
  release(): Promise<void>;
}

export interface GameService {
  start(): Promise<void>;
  stop(): Promise<void>;
  heartbeat(): Promise<void>;
  beginReceipt(): Arrival;
  read(id: string, guestId: string): Promise<ServiceResult>;
  ready(id: string, guestId: string): Promise<ServiceResult>;
  move(id: string, guestId: string, requestId: string, body: MoveBody, arrival: Arrival): Promise<ServiceResult>;
  action(id: string, guestId: string, requestId: string, kind: GameAction,
    body: ActionBody, arrival: Arrival): Promise<ServiceResult>;
  pollDueGames(): Promise<number>;
  /** Background preparation only. A witness is verified before it can affect a timeout. */
  registerTimeoutWitness(id: string, line: readonly Omit<MoveRequest, 'side'>[]): Promise<boolean>;
  /** A background worker may persist only a domain-verified mate witness. */
  resolveResignation(id: string, line: readonly Omit<MoveRequest, 'side'>[]): Promise<boolean>;
}

export function createGameService(pool: pg.Pool, clock: WallClock = systemClock,
  hooks: { afterMoveCommit?: () => Promise<void> } = {}): GameService {
  const instanceId = randomUUID();
  const arrivals = new Map<symbol, number>();
  const queues = new Map<string, Promise<unknown>>();
  let started: Promise<void> | null = null;
  let pulse: ReturnType<typeof setInterval> | null = null;
  let stopped = false;
  let registered = false;

  function safeThrough(): number {
    let safe = now(clock);
    for (const receivedAtMs of arrivals.values()) safe = Math.min(safe, receivedAtMs - 1);
    return Math.max(0, safe);
  }

  async function start(): Promise<void> {
    started ??= (async () => {
      await pool.query(`INSERT INTO chess.clock_ingress_watermarks
        (instance_id, safe_through_ms, lease_until)
        VALUES ($1, $2, clock_timestamp() + interval '30 seconds')`, [instanceId, safeThrough()]);
      registered = true;
      pulse = setInterval(() => { void heartbeat().catch(() => {
        console.error('Could not publish the game-command ingress watermark.');
      }); }, 250);
    })();
    try { await started; }
    catch (error) { started = null; throw error; }
  }

  async function heartbeat(): Promise<void> {
    await start();
    await pool.query(`UPDATE chess.clock_ingress_watermarks
      SET safe_through_ms = $2, lease_until = clock_timestamp() + interval '30 seconds'
      WHERE instance_id = $1`, [instanceId, safeThrough()]);
  }

  async function stop(): Promise<void> {
    if (stopped) return;
    stopped = true;
    if (pulse !== null) clearInterval(pulse);
    if (started !== null) await started.catch(() => undefined);
    if (registered) {
      await pool.query('DELETE FROM chess.clock_ingress_watermarks WHERE instance_id = $1', [instanceId]);
    }
  }

  function beginReceipt(): Arrival {
    const ticket = Symbol('move arrival');
    const receivedAtMs = now(clock);
    arrivals.set(ticket, receivedAtMs);
    return { receivedAtMs, async release() {
      if (arrivals.delete(ticket)) await heartbeat();
    } };
  }

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

  async function safeToDecide(client: pg.PoolClient, throughMs: number): Promise<boolean> {
    const { rows } = await client.query<{ blocked: boolean }>(
      `SELECT EXISTS (SELECT 1 FROM chess.clock_ingress_watermarks
        WHERE lease_until > clock_timestamp() AND safe_through_ms < $1) AS blocked`,
      [throughMs],
    );
    return !rows[0]!.blocked;
  }

  async function completeReceipt(client: pg.PoolClient, receipt: Receipt,
    result: ServiceResult): Promise<void> {
    await client.query(`UPDATE chess.game_move_receipts
      SET response = $2::jsonb, status_code = $3 WHERE admission_id = $1`,
    [receipt.admission_id, JSON.stringify(result.body), result.status]);
  }

  async function finishHandoff(client: pg.PoolClient, row: GameRow, game: ChessGame): Promise<void> {
    const { rows } = await client.query<Receipt>(`SELECT * FROM chess.game_move_receipts
      WHERE game_id = $1 AND response IS NULL AND applied = true`, [row.id]);
    if (rows.length !== 1) throw new Error('Saved clock handoff has no unique applied move.');
    const receipt = rows[0]!;
    const yourSeat = seat(row, receipt.guest_id);
    if (yourSeat === null) throw new Error('Saved move has no owning seat.');
    const atMs = Math.max(now(clock), receipt.received_at.getTime());
    row.clock_phase = 'running';
    row.turn_started_at = new Date(atMs);
    row.deadline_at = new Date(atMs + (row.side_to_move === 'white'
      ? row.white_remaining_ms : row.black_remaining_ms));
    await saveGame(client, row);
    const move = game.getHistory().at(-1);
    if (!move) throw new Error('Saved handoff has no accepted move.');
    const response: MoveAcceptedResponse = { accepted: true, move,
      game: gameState(row, game, yourSeat, atMs) };
    await completeReceipt(client, receipt, { status: 200, body: response });
  }

  async function applyReceipt(client: pg.PoolClient, row: GameRow, game: ChessGame,
    receipt: Receipt): Promise<boolean> {
    const receivedAtMs = receipt.received_at.getTime();
    const yourSeat = seat(row, receipt.guest_id);
    if (yourSeat === null) throw new Error('Admitted move has no owning seat.');
    const body = receipt.payload;
    let result: ServiceResult;
    if (row.flagged_at !== null && receivedAtMs >= row.flagged_at.getTime()) {
      result = { status: 409, body: { error: 'flag_fell', currentVersion: row.version } };
    } else if (row.status === 'waiting') {
      result = { status: 409, body: { error: 'clock_not_started' } };
    } else if (body.expectedVersion !== row.version) {
      result = { status: 409, body: { error: 'stale_version', currentVersion: row.version } };
    } else if (row.status !== 'active') {
      result = { status: 409, body: { error: row.status === 'finished'
        ? 'game_finished' : 'adjudication_pending' } };
    } else if (row.clock_mode === 'five_plus_three' && row.turn_started_at !== null
      && receipt.kind === 'move' && receivedAtMs < row.turn_started_at.getTime()) {
      result = { status: 409, body: { error: 'received_before_turn' } };
    } else if (receipt.kind === 'move') {
      const body = receipt.payload as MoveBody;
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
        row.draw_offer = state.drawOffer;
        row.timeout_witness = null;
        row.version += 1;
        if (row.clock_mode === 'five_plus_three') {
          const freeFirstMove = row.clock_start_mode === 'first_move'
            && row.clock_phase === 'awaiting_first_move';
          if (!freeFirstMove) {
            const startedAtMs = row.turn_started_at?.getTime();
            if (startedAtMs === undefined) throw new Error('Running game has no turn start.');
            const left = Math.max(0, (yourSeat === 'white'
              ? row.white_remaining_ms : row.black_remaining_ms) - (receivedAtMs - startedAtMs))
              + FIVE_PLUS_THREE.incrementMs;
            if (yourSeat === 'white') row.white_remaining_ms = left;
            else row.black_remaining_ms = left;
          }
          row.turn_started_at = null;
          row.deadline_at = null;
          row.clock_phase = row.status === 'active' ? 'handoff' : 'stopped';
        }
        await client.query('INSERT INTO chess.game_moves (game_id, ply, record) VALUES ($1, $2, $3::jsonb)',
          [row.id, submitted.move.ply, JSON.stringify(submitted.move)]);
        await saveGame(client, row);
        if (row.clock_phase === 'handoff') {
          await client.query('UPDATE chess.game_move_receipts SET applied = true WHERE admission_id = $1',
            [receipt.admission_id]);
          return true;
        }
        const response: MoveAcceptedResponse = { accepted: true, move: submitted.move,
          game: gameState(row, game, yourSeat, Math.max(receivedAtMs, now(clock))) };
        result = { status: 200, body: response };
      }
    } else {
      const command = receipt.kind === 'resign' ? game.resign({ side: yourSeat })
        : receipt.kind === 'offer_draw' ? game.offerDraw({ side: yourSeat })
          : receipt.kind === 'accept_draw' ? game.acceptDraw({ side: yourSeat })
            : game.declineDraw({ side: yourSeat });
      if (!command.accepted) {
        result = { status: 409, body: { error: command.reason, message: command.message } };
      } else {
        const state = game.getState();
        row.status = state.status;
        row.result = state.result;
        row.pending = state.status === 'pending_adjudication' ? state.pending : null;
        row.draw_offer = state.drawOffer;
        row.version += 1;
        if (row.clock_mode === 'five_plus_three' && row.status !== 'active') {
          if (row.clock_phase === 'running' && row.turn_started_at !== null) {
            const elapsed = Math.max(0, receivedAtMs - row.turn_started_at.getTime());
            if (row.side_to_move === 'white') row.white_remaining_ms = Math.max(0, row.white_remaining_ms - elapsed);
            else row.black_remaining_ms = Math.max(0, row.black_remaining_ms - elapsed);
          }
          row.clock_phase = 'stopped';
          row.turn_started_at = null;
          row.deadline_at = null;
        }
        await client.query(`INSERT INTO chess.game_actions (game_id, version, after_ply, side, kind)
          VALUES ($1, $2, $3, $4, $5)`, [row.id, row.version, game.getHistory().length,
          yourSeat, receipt.kind]);
        await saveGame(client, row);
        const response: GameActionAcceptedResponse = { accepted: true,
          game: gameState(row, game, yourSeat, Math.max(receivedAtMs, now(clock))) };
        result = { status: 200, body: response };
      }
    }
    await completeReceipt(client, receipt, result);
    return false;
  }

  async function advanceGame(id: string): Promise<number> {
    return serialize(id, async () => {
      let flags = 0;
      for (;;) {
        const step = await transaction(async client => {
          const row = await loadGame(client, id);
          if (row === null) return 'idle';
          const game = await reconstruct(client, row);
          if (row.clock_phase === 'handoff') {
            await finishHandoff(client, row, game);
            return 'progress';
          }
          const { rows } = await client.query<Receipt>(`SELECT * FROM chess.game_move_receipts
            WHERE game_id = $1 AND response IS NULL
            ORDER BY received_at, admission_id LIMIT 1`, [id]);
          const receipt = rows[0];
          if (receipt) {
            const receiptMs = receipt.received_at.getTime();
            if (!await safeToDecide(client, receiptMs)) return 'blocked';
            if (row.clock_phase === 'running' && row.deadline_at !== null
              && receiptMs >= row.deadline_at.getTime()) {
              if (!await safeToDecide(client, row.deadline_at.getTime() - 1)) return 'blocked';
              if (await expireIfDue(client, row, game, Math.max(now(clock), receiptMs))) return 'flag';
            }
            return await applyReceipt(client, row, game, receipt) ? 'handoff' : 'progress';
          }
          if (row.clock_phase === 'running' && row.deadline_at !== null
            && now(clock) >= row.deadline_at.getTime()
            && await safeToDecide(client, row.deadline_at.getTime() - 1)
            && await expireIfDue(client, row, game, now(clock))) return 'flag';
          return 'idle';
        });
        if (step === 'handoff') await hooks.afterMoveCommit?.();
        if (step === 'flag') flags += 1;
        if (step === 'idle' || step === 'blocked') return flags;
      }
    });
  }

  const notFound: ServiceResult = { status: 404, body: { error: 'game_not_found' } };
  const notParticipant: ServiceResult = { status: 403, body: { error: 'not_a_participant' } };

  async function submitCommand(id: string, guestId: string, requestId: string,
    kind: 'move' | GameAction, payload: MoveBody | ActionBody, arrival: Arrival): Promise<ServiceResult> {
    await start();
    const { rows: seats } = await pool.query<{ allowed: boolean }>(
      `SELECT (c.creator_guest_id = $2 OR c.acceptor_guest_id = $2) AS allowed
        FROM chess.games g JOIN chess.challenges c ON c.id = g.id WHERE g.id = $1`, [id, guestId]);
    if (!seats[0]) return notFound;
    if (!seats[0].allowed) return notParticipant;
    await pool.query(`INSERT INTO chess.game_move_receipts
      (game_id, guest_id, request_id, kind, payload, response, status_code, received_at)
      VALUES ($1, $2, $3, $4, $5::jsonb, NULL, NULL, $6)
      ON CONFLICT (game_id, guest_id, request_id) DO NOTHING`,
    [id, guestId, requestId, kind, JSON.stringify(payload), new Date(arrival.receivedAtMs)]);
    await arrival.release();
    const waitUntil = Date.now() + 1_000;
    for (;;) {
      await advanceGame(id);
      const { rows } = await pool.query<Receipt>(`SELECT * FROM chess.game_move_receipts
        WHERE game_id = $1 AND guest_id = $2 AND request_id = $3`, [id, guestId, requestId]);
      const receipt = rows[0];
      if (!receipt) throw new Error('Admitted game-command receipt was not saved.');
      if (receipt.kind !== kind || !isDeepStrictEqual(receipt.payload, payload)) {
        return { status: 409, body: { error: 'request_id_conflict' } };
      }
      if (receipt.status_code !== null) return { status: receipt.status_code, body: receipt.response };
      if (Date.now() >= waitUntil) return { status: 503, body: { error: 'receipt_pending' } };
      await new Promise(resolve => setTimeout(resolve, 20));
    }
  }

  return {
    start, stop, heartbeat, beginReceipt,
    async read(id, guestId) {
      await start();
      await advanceGame(id);
      return transaction(async client => {
        const row = await loadGame(client, id);
        if (row === null) return notFound;
        const yourSeat = seat(row, guestId);
        if (yourSeat === null) return notParticipant;
        const game = await reconstruct(client, row);
        const atMs = now(clock);
        return { status: 200, body: gameRead(row, game, yourSeat, atMs) };
      });
    },
    async ready(id, guestId) {
      await start();
      await advanceGame(id);
      return serialize(id, () => transaction(async client => {
        const row = await loadGame(client, id);
        if (row === null) return notFound;
        const yourSeat = seat(row, guestId);
        if (yourSeat === null) return notParticipant;
        const game = await reconstruct(client, row);
        if (row.clock_mode !== 'five_plus_three') {
          return { status: 409, body: { error: 'legacy_untimed_game' } };
        }
        if (row.clock_start_mode === 'first_move') {
          return { status: 409, body: { error: 'ready_not_required' } };
        }
        const atMs = now(clock);
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
    async move(id, guestId, requestId, body, arrival) {
      const payload = { expectedVersion: body.expectedVersion, from: body.from, to: body.to,
        ...(body.promotion === undefined ? {} : { promotion: body.promotion }) };
      return submitCommand(id, guestId, requestId, 'move', payload, arrival);
    },
    action(id, guestId, requestId, kind, body, arrival) {
      return submitCommand(id, guestId, requestId, kind, { expectedVersion: body.expectedVersion }, arrival);
    },
    async pollDueGames() {
      await heartbeat();
      const { rows } = await pool.query<{ id: string }>(`SELECT id FROM chess.games
        WHERE clock_phase = 'handoff'
          OR (clock_mode = 'five_plus_three' AND clock_phase = 'running' AND deadline_at <= $1)
          OR EXISTS (SELECT 1 FROM chess.game_move_receipts r
            WHERE r.game_id = games.id AND r.response IS NULL)`, [new Date(now(clock))]);
      let flags = 0;
      for (const { id } of rows) flags += await advanceGame(id);
      return flags;
    },
    async registerTimeoutWitness(id, line) {
      await start();
      await advanceGame(id);
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
    async resolveResignation(id, line) {
      await start();
      await advanceGame(id);
      return serialize(id, () => transaction(async client => {
        const row = await loadGame(client, id);
        if (row === null || row.pending?.kind !== 'resignation') return false;
        const game = await reconstruct(client, row);
        const ruling = game.resolveResignation({ verdict: 'mate_possible', mateLine: line });
        if (!ruling.accepted) return false;
        const state = game.getState();
        row.status = state.status;
        row.result = state.result;
        row.pending = null;
        row.resignation_witness = line.map(move => ({ from: move.from, to: move.to,
          ...(move.promotion === undefined ? {} : { promotion: move.promotion }) }));
        row.version += 1;
        await saveGame(client, row);
        return true;
      }));
    },
  };
}
