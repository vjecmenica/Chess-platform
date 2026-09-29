import { describe, expect, it } from 'vitest';
import { createTimedGame, FIVE_PLUS_THREE, type TimedGame } from '../src/index.js';
import { createGameFromPosition } from '../src/game.js';

class TestTime {
  private value = 0;
  nowMs(): number { return this.value; }
  set(value: number): void { this.value = value; }
}

function started() {
  const time = new TestTime();
  const game = createTimedGame(time);
  game.markReady('white');
  game.markReady('black');
  return { time, game };
}

function move(game: TimedGame, id: string, side: 'white' | 'black', from: string, to: string) {
  expect(game.receiveMove(id, { side, from, to })).toMatchObject({ status: 'queued' });
  const resolved = game.processNext();
  expect(resolved).not.toBeNull();
  return resolved!;
}

describe('5+3 clock ownership', () => {
  it('starts White only when both sides are ready and adds one increment per accepted move', () => {
    const time = new TestTime();
    const game = createTimedGame(time);
    expect(game.getState().clock).toMatchObject({ phase: 'waiting', remainingMs: {
      white: FIVE_PLUS_THREE.initialMs, black: FIVE_PLUS_THREE.initialMs,
    } });
    expect(game.markReady('white').clock).toMatchObject({ phase: 'waiting', activeSide: null });
    time.set(1000);
    expect(game.markReady('black').clock).toMatchObject({ phase: 'running', activeSide: 'white',
      turnStartedAtMs: 1000, deadlineMs: 301000 });
    game.markReady('black');
    time.set(6000);
    expect(game.receiveMove('m1', { side: 'white', from: 'e2', to: 'e4' }))
      .toMatchObject({ status: 'queued', receipt: { receivedAtMs: 6000, sequence: 1 } });
    time.set(6500);
    const first = game.processNext()!;
    expect(first).toMatchObject({ outcome: { accepted: true, move: { uci: 'e2e4' } },
      clock: { phase: 'running', activeSide: 'black', turnStartedAtMs: 6500,
        remainingMs: { white: 298000, black: 300000 }, deadlineMs: 306500 } });
    time.set(7500);
    expect(game.getState().clock.remainingMs).toEqual({ white: 298000, black: 299000 });
    expect(game.receiveMove('m1', { side: 'white', from: 'e2', to: 'e4' }))
      .toMatchObject({ status: 'duplicate', resolution: first });
    expect(game.receiveMove('m1', { side: 'white', from: 'd2', to: 'd4' }))
      .toEqual({ status: 'conflict', reason: 'command_id_conflict' });
    expect(game.processNext()).toBeNull();
    expect(game.getState().game.position.sideToMove).toBe('black');
    expect(game.getState().clock.remainingMs.white).toBe(298000);
  });

  it('accepts a pre-deadline receipt even if processing and the timer run late', () => {
    const { time, game } = started();
    time.set(299999);
    game.receiveMove('m1', { side: 'white', from: 'e2', to: 'e4' });
    time.set(310000);
    expect(game.poll()).toBe('commands_pending');
    expect(game.processNext()).toMatchObject({ outcome: { accepted: true },
      clock: { activeSide: 'black', turnStartedAtMs: 310000,
        remainingMs: { white: 3001, black: 300000 }, deadlineMs: 610000 } });
    expect(game.poll()).toBe('unchanged');
  });

  it.each([300000, 300001])('flags a new move received at %i ms', atMs => {
    const { time, game } = started();
    time.set(atMs);
    game.receiveMove('late', { side: 'white', from: 'e2', to: 'e4' });
    time.set(atMs + 100);
    expect(game.processNext()).toMatchObject({ outcome: { accepted: false, reason: 'flag_fell' },
      game: { status: 'active', position: { sideToMove: 'white' } },
      clock: { phase: 'flagged', flaggedSide: 'white', flaggedAtMs: 300000,
        remainingMs: { white: 0, black: 300000 } } });
    expect(game.getState().game.position.fen).toContain(' w ');
    expect(move(game, 'after-flag', 'white', 'e2', 'e4').outcome)
      .toMatchObject({ accepted: false, reason: 'flag_fell' });
  });

  it('does not reset the clock or add increment for invalid and wrong-side moves', () => {
    const { time, game } = started();
    time.set(1000);
    expect(move(game, 'illegal', 'white', 'e2', 'e5').outcome)
      .toMatchObject({ accepted: false, reason: 'illegal_move' });
    time.set(2000);
    expect(move(game, 'wrong-side', 'black', 'e7', 'e5').outcome)
      .toMatchObject({ accepted: false, reason: 'wrong_turn' });
    expect(game.getState().clock).toMatchObject({ activeSide: 'white', deadlineMs: 300000,
      remainingMs: { white: 298000, black: 300000 } });
    time.set(300500);
    expect(game.poll()).toBe('flagged');
    expect(game.getState().clock).toMatchObject({ flaggedAtMs: 300000,
      remainingMs: { white: 0, black: 300000 } });
  });

  it('rejects a command received before its turn began', () => {
    const { time, game } = started();
    time.set(299999);
    game.receiveMove('white', { side: 'white', from: 'e2', to: 'e4' });
    time.set(300000);
    game.receiveMove('black-too-early', { side: 'black', from: 'e7', to: 'e5' });
    time.set(310000);
    expect(game.processNext()?.outcome).toMatchObject({ accepted: true });
    expect(game.processNext()?.outcome).toMatchObject({ accepted: false, reason: 'received_before_turn' });
    expect(game.getState().clock).toMatchObject({ activeSide: 'black', turnStartedAtMs: 310000,
      deadlineMs: 610000 });
  });

  it('uses receipt sequence to distinguish commands within the same millisecond', () => {
    const { game } = started();
    game.receiveMove('white', { side: 'white', from: 'e2', to: 'e4' });
    game.receiveMove('premature-black', { side: 'black', from: 'e7', to: 'e5' });
    expect(game.processNext()?.outcome).toMatchObject({ accepted: true });
    expect(game.processNext()?.outcome).toMatchObject({ accepted: false,
      reason: 'received_before_turn' });
    expect(move(game, 'black-after-confirmation', 'black', 'e7', 'e5').outcome)
      .toMatchObject({ accepted: true });
  });

  it('stops both clocks on an accepted pending resignation without searching', () => {
    const { time, game } = started();
    time.set(10000);
    expect(game.receiveResignation('r1', { side: 'black' })).toMatchObject({ status: 'queued' });
    time.set(12000);
    expect(game.processNext()).toMatchObject({ outcome: { accepted: true },
      game: { status: 'pending_adjudication', pending: { resigningSide: 'black' } },
      clock: { phase: 'stopped', activeSide: null, deadlineMs: null,
        remainingMs: { white: 290000, black: 300000 } } });
    time.set(900000);
    expect(game.getState().clock.remainingMs).toEqual({ white: 290000, black: 300000 });
    expect(game.poll()).toBe('unchanged');
    expect(move(game, 'm1', 'white', 'e2', 'e4').outcome)
      .toMatchObject({ accepted: false, reason: 'adjudication_pending' });
    expect(game.receiveResignation('r1', { side: 'black' }))
      .toMatchObject({ status: 'duplicate', resolution: { outcome: { accepted: true } } });
  });

  it('keeps the clock running after an invalid resignation and flags one received at the deadline', () => {
    const { time, game } = started();
    time.set(1000);
    game.receiveResignation('bad', { side: 'spectator' as 'white' });
    expect(game.processNext()?.outcome).toMatchObject({ accepted: false, reason: 'invalid_side' });
    expect(game.getState().clock).toMatchObject({ phase: 'running', activeSide: 'white',
      deadlineMs: 300000 });
    time.set(300000);
    game.receiveResignation('at-deadline', { side: 'black' });
    expect(game.processNext()).toMatchObject({ outcome: { accepted: false, reason: 'flag_fell' },
      game: { status: 'active' }, clock: { phase: 'flagged', flaggedAtMs: 300000 } });
    expect(game.receiveResignation('bad', { side: 'spectator' as 'white' }))
      .toMatchObject({ status: 'duplicate', resolution: { outcome: { reason: 'invalid_side' } } });
  });

  it('stops completed games and rejects further commands without ticking', () => {
    const { time, game } = started();
    time.set(1000); expect(move(game, 'm1', 'white', 'f2', 'f3').outcome.accepted).toBe(true);
    time.set(2000); expect(move(game, 'm2', 'black', 'e7', 'e5').outcome.accepted).toBe(true);
    time.set(3000); expect(move(game, 'm3', 'white', 'g2', 'g4').outcome.accepted).toBe(true);
    time.set(4000);
    expect(move(game, 'm4', 'black', 'd8', 'h4')).toMatchObject({
      outcome: { accepted: true }, game: { status: 'finished', result: { reason: 'checkmate' } },
      clock: { phase: 'stopped', activeSide: null, remainingMs: { white: 304000, black: 304000 } },
    });
    time.set(800000);
    expect(game.getState().clock.remainingMs).toEqual({ white: 304000, black: 304000 });
    expect(move(game, 'm5', 'white', 'e2', 'e4').outcome)
      .toMatchObject({ accepted: false, reason: 'game_finished' });
  });

  it('stops immediately for a proven no-mate resignation', () => {
    const time = new TestTime();
    const game = createTimedGame(time, createGameFromPosition('4k3/8/8/8/8/8/8/R3K3 w - - 0 1'));
    game.markReady('white');
    game.markReady('black');
    time.set(1000);
    game.receiveResignation('r1', { side: 'white' });
    expect(game.processNext()).toMatchObject({ game: { status: 'finished',
      result: { outcome: 'draw', reason: 'resignation_no_mating_possibility' } },
    clock: { phase: 'stopped', remainingMs: { white: 299000, black: 300000 } } });
  });

  it('gives a late callback the original deadline and never awards a timeout result itself', () => {
    const { time, game } = started();
    time.set(400000);
    expect(game.poll()).toBe('flagged');
    expect(game.getState()).toMatchObject({ game: { status: 'active', result: null },
      clock: { phase: 'flagged', flaggedSide: 'white', flaggedAtMs: 300000,
        remainingMs: { white: 0, black: 300000 } } });
  });

  it('fails fast if the injected clock moves backwards', () => {
    const { time, game } = started();
    time.set(1000);
    game.getState();
    time.set(999);
    expect(() => game.getState()).toThrow(RangeError);
  });
});
