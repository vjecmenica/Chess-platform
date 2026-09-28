import { describe, expect, it } from 'vitest';
import {
  createPosition, STANDARD_STARTING_FEN,
  type ChessPosition, type MoveRecord, type MoveRejection, type MoveRequest, type Promotion,
} from '../src/index.js';

function play(position: ChessPosition, ...moves: string[]): void {
  for (const uci of moves) {
    const result = position.submitMove({
      side: position.getPosition().sideToMove,
      from: uci.slice(0, 2), to: uci.slice(2, 4),
      ...(uci[4] ? { promotion: uci[4] as Promotion } : {}),
    });
    expect(result.accepted, `Fixture move ${uci}: ${JSON.stringify(result)}`).toBe(true);
  }
}

function rejectUnchanged(position: ChessPosition, request: MoveRequest, reason: MoveRejection): void {
  const before = position.getPosition();
  const history = position.getHistory();
  const result = position.submitMove(request);
  expect(result).toMatchObject({ accepted: false, reason, message: expect.any(String) });
  expect(position.getPosition()).toEqual(before);
  expect(position.getHistory()).toEqual(history);
}

describe('positions and ordered history', () => {
  it('starts with the standard position, White to move, and no history', () => {
    const position = createPosition();
    expect(position.getPosition()).toEqual({ fen: STANDARD_STARTING_FEN, sideToMove: 'white' });
    expect(position.getHistory()).toEqual([]);
  });

  it('accepts ordinary moves and records independent replay data in order', () => {
    const position = createPosition();
    const first = position.submitMove({ side: 'white', from: 'e2', to: 'e4' });
    expect(first).toMatchObject({ accepted: true, move: { ply: 1, side: 'white', san: 'e4', uci: 'e2e4' } });
    expect(position.getPosition()).toEqual({
      fen: 'rnbqkbnr/pppppppp/8/8/4P3/8/PPPP1PPP/RNBQKBNR b KQkq - 0 1', sideToMove: 'black',
    });
    play(position, 'e7e5', 'g1f3');
    const history = position.getHistory();
    expect(history.map(move => [move.ply, move.side, move.san, move.uci])).toEqual([
      [1, 'white', 'e4', 'e2e4'], [2, 'black', 'e5', 'e7e5'], [3, 'white', 'Nf3', 'g1f3'],
    ]);
    expect(history[0]?.beforeFen).toBe(STANDARD_STARTING_FEN);
    for (let index = 1; index < history.length; index++) {
      expect(history[index]?.beforeFen).toBe(history[index - 1]?.afterFen);
    }
    const replay = createPosition();
    for (const move of history) {
      expect(replay.getPosition().fen).toBe(move.beforeFen);
      expect(replay.submitMove(move).accepted).toBe(true);
      expect(replay.getPosition().fen).toBe(move.afterFen);
    }
    expect(replay.getPosition()).toEqual(position.getPosition());
    expect(first).toMatchObject({ position: { sideToMove: 'black' } });
  });

  it('does not let returned records, snapshots, or other instances mutate the position', () => {
    const position = createPosition();
    const result = position.submitMove({ side: 'white', from: 'e2', to: 'e4' });
    if (!result.accepted) throw new Error('Expected a legal move');
    const expected = position.getPosition();
    Object.assign(result.move, { to: 'e8' });
    Object.assign(result.position, { fen: 'changed' });
    const copy = position.getHistory() as MoveRecord[];
    Object.assign(copy[0]!, { san: 'changed' });
    copy.length = 0;
    Object.assign(position.getPosition(), { sideToMove: 'white' });
    expect(position.getHistory()[0]).toMatchObject({ to: 'e4', san: 'e4' });
    expect(position.getPosition()).toEqual(expected);
    expect(createPosition().getPosition().fen).toBe(STANDARD_STARTING_FEN);
  });
});

describe('rejections', () => {
  it('rejects the wrong side even if the requested piece has a legal move', () => {
    const position = createPosition();
    rejectUnchanged(position, { side: 'black', from: 'e2', to: 'e4' }, 'wrong_turn');
    play(position, 'e2e4');
    rejectUnchanged(position, { side: 'white', from: 'e7', to: 'e5' }, 'wrong_turn');
  });

  it.each([
    ['e2', 'e5'], ['a1', 'a4'], ['e3', 'e4'], ['e7', 'e5'], ['e2', 'e2'],
  ])('rejects illegal %s–%s without changing any state', (from, to) => {
    rejectUnchanged(createPosition(), { side: 'white', from, to }, 'illegal_move');
  });

  it.each([
    { side: 'white', from: 'a9', to: 'a4' },
    { side: 'white', from: 'E2', to: 'e4' },
    { side: 'white', from: 'e2', to: 'e4', promotion: 'k' },
    { side: 'other', from: 'e2', to: 'e4' },
  ])('rejects malformed coordinates or choices: %j', request => {
    rejectUnchanged(createPosition(), request as MoveRequest, 'invalid_input');
  });

  it('rejects an unnecessary promotion field on a normal move', () => {
    rejectUnchanged(createPosition(), { side: 'white', from: 'e2', to: 'e4', promotion: 'q' }, 'illegal_move');
  });

  it('rejects moving a pinned piece and permits another legal move afterwards', () => {
    const position = createPosition();
    play(position, 'e2e4', 'e7e5', 'g1f3', 'b8c6', 'f1b5', 'd7d6', 'd2d4');
    rejectUnchanged(position, { side: 'black', from: 'c6', to: 'b8' }, 'illegal_move');
    play(position, 'a7a6');
  });

  it('rejects ignoring check but accepts a move that blocks it', () => {
    const position = createPosition();
    play(position, 'e2e4', 'f7f6', 'd2d4', 'a7a6', 'd1h5');
    rejectUnchanged(position, { side: 'black', from: 'a6', to: 'a5' }, 'illegal_move');
    play(position, 'g7g6');
    expect(position.getPosition().sideToMove).toBe('white');
  });
});

describe('castling', () => {
  it('castles kingside for both sides, moving each rook as well', () => {
    const position = createPosition();
    play(position, 'e2e4', 'e7e5', 'g1f3', 'b8c6', 'f1c4', 'f8c5', 'e1g1', 'g8f6', 'd2d3', 'e8g8');
    expect(position.getPosition().fen.split(' ')[0]).toBe('r1bq1rk1/pppp1ppp/2n2n2/2b1p3/2B1P3/3P1N2/PPP2PPP/RNBQ1RK1');
    expect(position.getHistory().filter(move => move.san === 'O-O').map(move => move.uci)).toEqual(['e1g1', 'e8g8']);
    expect(position.getPosition().fen.split(' ')[2]).toBe('-');
  });

  it('castles queenside for both sides', () => {
    const position = createPosition();
    play(position, 'd2d4', 'd7d5', 'b1c3', 'b8c6', 'c1f4', 'c8f5', 'd1d2', 'd8d7', 'e1c1', 'e8c8');
    expect(position.getPosition().fen.split(' ')[0]).toBe('2kr1bnr/pppqpppp/2n5/3p1b2/3P1B2/2N5/PPPQPPPP/2KR1BNR');
    expect(position.getHistory().slice(-2).map(move => move.san)).toEqual(['O-O-O', 'O-O-O']);
  });

  it('rejects castling through an attacked square with an otherwise clear path', () => {
    const position = createPosition();
    play(position, 'e2e4', 'b7b6', 'g1f3', 'c8a6', 'f1e2', 'h7h6', 'f3g5', 'h6h5', 'e2f3', 'h5h4');
    // The bishop on a6 attacks f1; e1 and g1 are not attacked.
    rejectUnchanged(position, { side: 'white', from: 'e1', to: 'g1' }, 'illegal_move');
  });

  it('rejects castling when pieces still block the path', () => {
    rejectUnchanged(createPosition(), { side: 'white', from: 'e1', to: 'g1' }, 'illegal_move');
  });

  it.each([['e1f1', 'f1e1'], ['h1g1', 'g1h1']])('does not restore castling rights after %s and %s', (out, back) => {
    const position = createPosition();
    play(position, 'e2e4', 'e7e5', 'g1f3', 'b8c6', 'f1c4', 'f8c5', out, 'g8f6', back, 'h7h6');
    rejectUnchanged(position, { side: 'white', from: 'e1', to: 'g1' }, 'illegal_move');
  });
});

describe('en passant', () => {
  it('captures the passed pawn and records the resulting position', () => {
    const position = createPosition();
    play(position, 'e2e4', 'a7a6', 'e4e5', 'd7d5', 'e5d6');
    expect(position.getPosition().fen).toBe('rnbqkbnr/1pp1pppp/p2P4/8/8/8/PPPP1PPP/RNBQKBNR b KQkq - 0 3');
    expect(position.getHistory().at(-1)).toMatchObject({ ply: 5, san: 'exd6', uci: 'e5d6' });
  });

  it('expires after one intervening move', () => {
    const position = createPosition();
    play(position, 'e2e4', 'a7a6', 'e4e5', 'd7d5', 'g1f3', 'a6a5');
    rejectUnchanged(position, { side: 'white', from: 'e5', to: 'd6' }, 'illegal_move');
  });
});

describe('promotion', () => {
  function readyToPromote() {
    const position = createPosition();
    play(position, 'a2a4', 'h7h5', 'a4a5', 'h5h4', 'a5a6', 'h4h3', 'a6b7', 'h3g2');
    return position;
  }

  it.each(['q', 'r', 'b', 'n'] as const)('accepts explicit promotion to %s and supports replay', promotion => {
    const position = readyToPromote();
    const result = position.submitMove({ side: 'white', from: 'b7', to: 'a8', promotion });
    expect(result).toMatchObject({ accepted: true, move: { ply: 9, promotion, uci: `b7a8${promotion}` } });
    expect(position.getPosition().fen.split('/')[0]).toBe(`${promotion.toUpperCase()}nbqkbnr`);
    const replay = createPosition();
    for (const move of position.getHistory()) {
      expect(replay.submitMove(move).accepted).toBe(true);
      expect(replay.getPosition().fen).toBe(move.afterFen);
    }
  });

  it('requires a choice without consuming the turn and allows a corrected request', () => {
    const position = readyToPromote();
    rejectUnchanged(position, { side: 'white', from: 'b7', to: 'a8' }, 'promotion_required');
    rejectUnchanged(position, { side: 'white', from: 'b7', to: 'a8', promotion: 'p' as Promotion }, 'invalid_input');
    play(position, 'b7a8n', 'g2h1q');
    expect(position.getHistory().at(-1)).toMatchObject({ side: 'black', promotion: 'q', uci: 'g2h1q' });
    expect(position.getPosition().fen.split(' ')[0]?.split('/').at(-1)).toBe('RNBQKBNq');
  });
});
