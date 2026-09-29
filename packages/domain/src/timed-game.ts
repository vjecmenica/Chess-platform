import { createGame } from './game.js';
import type { ChessGame, CommandResult, GameMoveResult, GameSnapshot, MateRuling, SideCommand } from './game.js';
import type { MoveRequest, Side } from './position.js';

export const FIVE_PLUS_THREE = { initialMs: 300_000, incrementMs: 3_000 } as const;

export interface MonotonicTimeSource {
  nowMs(): number;
}

export interface ClockSnapshot {
  readonly phase: 'waiting' | 'running' | 'stopped' | 'flagged';
  readonly ready: Readonly<Record<Side, boolean>>;
  readonly remainingMs: Readonly<Record<Side, number>>;
  readonly activeSide: Side | null;
  readonly turnStartedAtMs: number | null;
  readonly deadlineMs: number | null;
  readonly flaggedSide: Side | null;
  readonly flaggedAtMs: number | null;
}

export interface TimedGameSnapshot {
  readonly game: GameSnapshot;
  readonly clock: ClockSnapshot;
}

export interface ClockReceipt {
  readonly commandId: string;
  readonly kind: 'move' | 'resignation';
  readonly payloadFingerprint: string;
  readonly sequence: number;
  readonly receivedAtMs: number;
}

export type ClockEnqueueResult =
  | { readonly status: 'queued'; readonly receipt: ClockReceipt }
  | { readonly status: 'duplicate'; readonly receipt: ClockReceipt;
      readonly resolution: ClockCommandResolution | null }
  | { readonly status: 'conflict'; readonly reason: 'command_id_conflict' };

export type ClockCommandOutcome = GameMoveResult | CommandResult | {
  readonly accepted: false;
  readonly reason: 'clock_not_started' | 'received_before_turn' | 'flag_fell';
  readonly message: string;
};

export interface ClockCommandResolution extends TimedGameSnapshot {
  readonly receipt: ClockReceipt;
  readonly processedAtMs: number;
  readonly outcome: ClockCommandOutcome;
}

export interface TimedGame {
  getState(): TimedGameSnapshot;
  markReady(side: Side): TimedGameSnapshot;
  /** Register a verified candidate for the current position before its deadline. */
  registerTimeoutMateWitness(mateLine: readonly Omit<MoveRequest, 'side'>[]): boolean;
  receiveMove(commandId: string, move: MoveRequest): ClockEnqueueResult;
  receiveResignation(commandId: string, command: SideCommand): ClockEnqueueResult;
  processNext(): ClockCommandResolution | null;
  poll(): 'commands_pending' | 'unchanged' | 'flagged';
  /** Worker-side resolution after a pending flag; clocks remain frozen. */
  resolveTimeout(ruling: MateRuling): CommandResult;
}

type PendingCommand =
  | { readonly kind: 'move'; readonly payload: MoveRequest }
  | { readonly kind: 'resignation'; readonly payload: SideCommand };

interface Entry {
  readonly receipt: ClockReceipt;
  readonly fingerprint: string;
  readonly command: PendingCommand;
  resolution: ClockCommandResolution | null;
}

function rejected(reason: 'clock_not_started' | 'received_before_turn' | 'flag_fell'): ClockCommandOutcome {
  const message = {
    clock_not_started: 'Both players must be ready before the clock starts.',
    received_before_turn: 'This command arrived before the current turn started.',
    flag_fell: 'The active clock reached its deadline before this command arrived.',
  }[reason];
  return { accepted: false, reason, message };
}

/** Owns one domain game. Callers must not mutate the transferred game directly. */
export function createTimedGame(time: MonotonicTimeSource, game: ChessGame = createGame()): TimedGame {
  const ready: Record<Side, boolean> = { white: false, black: false };
  const remainingMs: Record<Side, number> = {
    white: FIVE_PLUS_THREE.initialMs, black: FIVE_PLUS_THREE.initialMs,
  };
  let phase: ClockSnapshot['phase'] = game.getState().status === 'active' ? 'waiting' : 'stopped';
  let activeSide: Side | null = null;
  let turnStartedAtMs: number | null = null;
  let flaggedSide: Side | null = null;
  let flaggedAtMs: number | null = null;
  let turnStartSequence = 0;
  let lastReadMs = -1;
  let nextSequence = 1;
  let timeoutMateWitness: readonly Omit<MoveRequest, 'side'>[] | null = null;
  const entries = new Map<string, Entry>();
  const queue: Entry[] = [];

  function now(): number {
    const value = time.nowMs();
    if (!Number.isSafeInteger(value) || value < 0 || value < lastReadMs) {
      throw new RangeError('The time source must return nondecreasing, nonnegative integer milliseconds.');
    }
    lastReadMs = value;
    return value;
  }

  function deadline(): number | null {
    return phase === 'running' && activeSide !== null && turnStartedAtMs !== null
      ? turnStartedAtMs + remainingMs[activeSide] : null;
  }

  function clockAt(atMs: number): ClockSnapshot {
    const left = { ...remainingMs };
    if (phase === 'running' && activeSide !== null && turnStartedAtMs !== null) {
      left[activeSide] = Math.max(0, remainingMs[activeSide] - (atMs - turnStartedAtMs));
    }
    return { phase, ready: { ...ready }, remainingMs: left, activeSide, turnStartedAtMs,
      deadlineMs: deadline(), flaggedSide, flaggedAtMs };
  }

  function snapshot(atMs: number): TimedGameSnapshot {
    return { game: game.getState(), clock: clockAt(atMs) };
  }

  function flag(): void {
    const atMs = deadline();
    if (atMs === null || activeSide === null) return;
    const decision = game.flagTimeout({ flaggedSide: activeSide, deadlineMs: atMs,
      ...(timeoutMateWitness === null ? {} : { mateLine: timeoutMateWitness }) });
    if (!decision.accepted) throw new Error(`The clock could not apply its timeout: ${decision.reason}`);
    timeoutMateWitness = null;
    flaggedSide = activeSide;
    flaggedAtMs = atMs;
    remainingMs[activeSide] = 0;
    phase = 'flagged';
    activeSide = null;
    turnStartedAtMs = null;
  }

  function flagIfDue(atMs: number): boolean {
    if (queue.length > 0 || phase !== 'running' || atMs < deadline()!) return false;
    flag();
    return true;
  }

  function receive(commandId: string, command: PendingCommand): ClockEnqueueResult {
    if (typeof commandId !== 'string' || !commandId.trim() || commandId.length > 128) {
      throw new TypeError('A command ID must contain 1–128 characters.');
    }
    const receivedAtMs = now();
    const fingerprint = JSON.stringify(command);
    const existing = entries.get(commandId);
    if (existing) {
      if (existing.fingerprint !== fingerprint) return { status: 'conflict', reason: 'command_id_conflict' };
      return { status: 'duplicate', receipt: { ...existing.receipt },
        resolution: existing.resolution === null ? null : structuredClone(existing.resolution) };
    }
    const receipt: ClockReceipt = { commandId, kind: command.kind, payloadFingerprint: fingerprint,
      sequence: nextSequence++, receivedAtMs };
    const entry: Entry = { receipt, fingerprint, command, resolution: null };
    entries.set(commandId, entry);
    queue.push(entry);
    return { status: 'queued', receipt: { ...receipt } };
  }

  return {
    getState() {
      const atMs = now();
      flagIfDue(atMs);
      return snapshot(atMs);
    },
    registerTimeoutMateWitness(mateLine) {
      const atMs = now();
      if (phase !== 'running' || queue.length > 0) return false;
      if (flagIfDue(atMs)) return false;
      const winner = activeSide === 'white' ? 'black' : 'white';
      if (!game.verifyMateLine(winner, mateLine)) return false;
      timeoutMateWitness = mateLine.map(move => ({ from: move.from, to: move.to,
        ...(move.promotion === undefined ? {} : { promotion: move.promotion }) }));
      return true;
    },
    markReady(side) {
      const atMs = now();
      if (side !== 'white' && side !== 'black') throw new TypeError('The ready side must be white or black.');
      if (phase === 'waiting') {
        ready[side] = true;
        if (ready.white && ready.black) {
          phase = 'running';
          activeSide = game.getState().position.sideToMove;
          turnStartedAtMs = atMs;
          turnStartSequence = nextSequence - 1;
        }
      }
      return snapshot(atMs);
    },
    receiveMove(commandId, move) {
      const payload: MoveRequest = { side: move.side, from: move.from, to: move.to,
        ...(move.promotion === undefined ? {} : { promotion: move.promotion }) };
      return receive(commandId, { kind: 'move', payload });
    },
    receiveResignation(commandId, command) {
      return receive(commandId, { kind: 'resignation', payload: { side: command.side } });
    },
    processNext() {
      const entry = queue.shift();
      if (!entry) return null;
      const processedAtMs = now();
      let outcome: ClockCommandOutcome;
      if (phase === 'waiting') outcome = rejected('clock_not_started');
      else if (phase === 'flagged') outcome = rejected('flag_fell');
      else if (phase === 'stopped') {
        outcome = game.getState().status === 'finished'
          ? { accepted: false, reason: 'game_finished', message: 'The game has already finished.' }
          : { accepted: false, reason: 'adjudication_pending',
            message: 'The game is awaiting adjudication.' };
      } else if (entry.receipt.sequence <= turnStartSequence
        || entry.receipt.receivedAtMs < turnStartedAtMs!) {
        outcome = rejected('received_before_turn');
      } else if (entry.receipt.receivedAtMs >= deadline()!) {
        flag();
        outcome = rejected('flag_fell');
      } else {
        const movingSide = activeSide!;
        outcome = entry.command.kind === 'move'
          ? game.submitMove(entry.command.payload) : game.resign(entry.command.payload);
        if (outcome.accepted) {
          timeoutMateWitness = null;
          remainingMs[movingSide] -= entry.receipt.receivedAtMs - turnStartedAtMs!;
          if (entry.command.kind === 'move') remainingMs[movingSide] += FIVE_PLUS_THREE.incrementMs;
          const state = game.getState();
          if (state.status === 'active') {
            activeSide = state.position.sideToMove;
            turnStartedAtMs = processedAtMs;
            turnStartSequence = nextSequence - 1;
          } else {
            phase = 'stopped';
            activeSide = null;
            turnStartedAtMs = null;
          }
        }
      }
      const resolution: ClockCommandResolution = { receipt: { ...entry.receipt }, processedAtMs,
        outcome, ...snapshot(processedAtMs) };
      entry.resolution = structuredClone(resolution);
      return structuredClone(resolution);
    },
    poll() {
      const atMs = now();
      if (queue.length > 0) return 'commands_pending';
      return flagIfDue(atMs) ? 'flagged' : 'unchanged';
    },
    resolveTimeout(ruling) {
      flagIfDue(now());
      return game.resolveTimeout(ruling);
    },
  };
}
