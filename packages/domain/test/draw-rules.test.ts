import { describe, expect, it } from 'vitest';
import { createGame, type ChessGame, type DrawClaim, type ResignationRuling } from '../src/index.js';
import { createGameFromPosition } from '../src/game.js';
import { createPositionAdapter } from '../src/position.js';

function play(game: ChessGame, ...moves: string[]): void {
  for (const move of moves) {
    expect(game.submitMove({ side: game.getState().position.sideToMove,
      from: move.slice(0, 2), to: move.slice(2, 4) }).accepted, move).toBe(true);
  }
}

function unchanged(game: ChessGame, action: () => unknown, reason: string): void {
  const before = game.getState();
  const history = game.getHistory();
  expect(action()).toMatchObject({ accepted: false, reason });
  expect(game.getState()).toEqual(before);
  expect(game.getHistory()).toEqual(history);
}

const cycle = ['g1f3', 'g8f6', 'f3g1', 'f6g8'];
const start = 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR';

describe('repetition thresholds and claims', () => {
  it('counts identical positions reached by different move sequences', () => {
    const game = createGame();
    play(game, ...cycle, 'b1c3', 'b8c6', 'c3b1', 'c6b8');
    expect(game.claimDraw({ side: 'white', rule: 'threefold_repetition' }).accepted).toBe(true);
  });

  it('counts the starting position and ends automatically on occurrence five, not four', () => {
    const game = createGame();
    for (let i = 0; i < 3; i++) play(game, ...cycle);
    expect(game.getState().status).toBe('active');
    expect(game.offerDraw({ side: 'black' }).accepted).toBe(true);
    play(game, ...cycle.slice(0, 3));
    expect(game.getState().status).toBe('active');
    play(game, cycle[3]!);
    expect(game.getState()).toMatchObject({ status: 'finished', drawOffer: null,
      result: { outcome: 'draw', reason: 'fivefold_repetition' } });
    expect(game.getHistory()).toHaveLength(16);
    unchanged(game, () => game.claimDraw({ side: 'white', rule: 'threefold_repetition' }), 'game_finished');
    unchanged(game, () => game.resign({ side: 'black' }), 'game_finished');
    unchanged(game, () => game.submitMove({ side: 'white', from: 'e2', to: 'e4' }), 'game_finished');
  });

  it('rejects occurrence two, then permits the current third position without requiring an offer', () => {
    const game = createGame();
    play(game, ...cycle);
    unchanged(game, () => game.claimDraw({ side: 'white', rule: 'threefold_repetition' }), 'claim_not_available');
    play(game, ...cycle);
    const position = game.getState().position;
    expect(game.claimDraw({ side: 'white', rule: 'threefold_repetition' })).toMatchObject({
      accepted: true, game: { result: { outcome: 'draw', reason: 'threefold_repetition' } },
    });
    expect(game.getState().position).toEqual(position);
    expect(game.getHistory()).toHaveLength(8);
  });

  it('accepts an intended third occurrence without playing it or changing the turn', () => {
    const game = createGame();
    play(game, ...cycle, ...cycle.slice(0, 3));
    unchanged(game, () => game.claimDraw({ side: 'black', rule: 'threefold_repetition' }), 'claim_not_available');
    const position = game.getState().position;
    const claim: DrawClaim = { side: 'black', rule: 'threefold_repetition', intendedMove: { from: 'f6', to: 'g8' } };
    expect(game.claimDraw(claim)).toMatchObject({ accepted: true,
      game: { result: { reason: 'threefold_repetition' } } });
    expect(game.getState().position).toEqual(position);
    expect(game.getHistory()).toHaveLength(7);
    unchanged(game, () => game.claimDraw(claim), 'game_finished');
  });

  it('does not count previews from rejected claims as occurrences', () => {
    const game = createGame();
    play(game, ...cycle.slice(0, 3));
    for (let i = 0; i < 5; i++) unchanged(game, () => game.claimDraw({
      side: 'black', rule: 'threefold_repetition', intendedMove: { from: 'f6', to: 'g8' },
    }), 'claim_not_available');
    play(game, 'f6g8');
    unchanged(game, () => game.claimDraw({ side: 'white', rule: 'threefold_repetition' }), 'claim_not_available');
  });
});

describe('move-count draws', () => {
  it.each([98, 99])('rejects a current 50-move claim at %i reversible half-moves', count => {
    const game = createGameFromPosition(`${start} w KQkq - ${count} 50`);
    unchanged(game, () => game.claimDraw({ side: 'white', rule: 'fifty_move' }), 'claim_not_available');
  });

  it('accepts the current 100-half-move position while leaving it unchanged', () => {
    const game = createGameFromPosition(`${start} w KQkq - 100 51`);
    const position = game.getState().position;
    expect(game.getState().status).toBe('active');
    expect(game.claimDraw({ side: 'white', rule: 'fifty_move' })).toMatchObject({ accepted: true,
      game: { result: { reason: 'fifty_move' } } });
    expect(game.getState().position).toEqual(position);
    expect(game.getHistory()).toEqual([]);
  });

  it('previews the 100th half-move, but never plays it on a successful claim', () => {
    const game = createGameFromPosition(`${start} w KQkq - 99 50`);
    const position = game.getState().position;
    expect(game.claimDraw({ side: 'white', rule: 'fifty_move', intendedMove: { from: 'g1', to: 'f3' } }))
      .toMatchObject({ accepted: true, game: { result: { reason: 'fifty_move' } } });
    expect(game.getState().position).toEqual(position);
    expect(game.getHistory()).toEqual([]);
  });

  it('rejects a legal intended move that only reaches half-move 99', () => {
    const game = createGameFromPosition(`${start} w KQkq - 98 50`);
    unchanged(game, () => game.claimDraw({ side: 'white', rule: 'fifty_move',
      intendedMove: { from: 'g1', to: 'f3' } }), 'claim_not_available');
  });

  it('ends at 150 half-moves, with the final move retained', () => {
    const game = createGameFromPosition(`${start} w KQkq - 148 75`);
    play(game, 'g1f3');
    expect(game.getState().status).toBe('active');
    play(game, 'g8f6');
    expect(game.getState()).toMatchObject({ status: 'finished', result: { reason: 'seventy_five_move' } });
    expect(game.getHistory()).toHaveLength(2);
    unchanged(game, () => game.claimDraw({ side: 'white', rule: 'fifty_move' }), 'game_finished');
  });

  it('gives checkmate precedence over the 150th half-move', () => {
    const game = createGameFromPosition('7k/8/5KQ1/8/8/8/8/8 w - - 149 75');
    play(game, 'g6g7');
    expect(game.getState().result).toEqual({ outcome: 'win', winner: 'white', reason: 'checkmate' });
    expect(game.getHistory()[0]?.san).toBe('Qg7#');
  });

  it('records stalemate before the overlapping 75-move draw', () => {
    const game = createGameFromPosition('7k/5K2/8/6Q1/8/8/8/8 w - - 149 75');
    play(game, 'g5g6');
    expect(game.getState().result).toEqual({ outcome: 'draw', reason: 'stalemate' });
  });

  it('does not play an intended mating move when claiming the 50-move draw', () => {
    const game = createGameFromPosition('7k/8/5KQ1/8/8/8/8/8 w - - 99 50');
    const position = game.getState().position;
    expect(game.claimDraw({ side: 'white', rule: 'fifty_move', intendedMove: { from: 'g6', to: 'g7' } }))
      .toMatchObject({ accepted: true, game: { result: { reason: 'fifty_move' } } });
    expect(game.getState().position).toEqual(position);
    expect(game.getHistory()).toEqual([]);
  });

  it('does not reset the counter when castling is the intended move', () => {
    const game = createGameFromPosition('4k3/8/8/8/8/8/8/4K2R w K - 99 50');
    expect(game.claimDraw({ side: 'white', rule: 'fifty_move', intendedMove: { from: 'e1', to: 'g1' } }))
      .toMatchObject({ accepted: true, game: { result: { reason: 'fifty_move' } } });
    expect(game.getHistory()).toEqual([]);
  });

  it.each([
    { fen: `${start} w KQkq - 149 75`, from: 'e2', to: 'e4' },
    { fen: '4k3/8/8/8/8/8/r7/R3K3 w - - 149 75', from: 'a1', to: 'a2' },
    { fen: 'k7/8/8/3pP3/8/8/8/4K3 w - d6 99 50', from: 'e5', to: 'd6' },
    { fen: '7k/P7/8/8/8/8/8/4K3 w - - 99 50', from: 'a7', to: 'a8', promotion: 'q' as const },
  ])('resets the counter on a pawn move or capture: $from$to', ({ fen, ...move }) => {
    const game = createGameFromPosition(fen);
    unchanged(game, () => game.claimDraw({ side: 'white', rule: 'fifty_move', intendedMove: move }), 'claim_not_available');
    expect(game.submitMove({ side: 'white', ...move }).accepted).toBe(true);
    expect(game.getState().position.fen.split(' ')[4]).toBe('0');
    expect(game.getState().status).toBe('active');
  });
});

describe('position identity', () => {
  const key = (fen: string) => createPositionAdapter(fen).repetitionKey();
  it('ignores counters but distinguishes turn, placement, and castling rights even when blocked', () => {
    const base = key(`${start} w KQkq - 0 1`);
    expect(key(`${start} w KQkq - 99 50`)).toBe(base);
    expect(key(`${start} b KQkq - 0 1`)).not.toBe(base);
    expect(key(`${start} w Qkq - 0 1`)).not.toBe(base);
    expect(key('rnbqkbnr/pppppppp/8/8/8/5N2/PPPPPPPP/RNBQKB1R w KQkq - 0 1')).not.toBe(base);
  });

  it('distinguishes legal en passant, but ignores unavailable or king-exposing captures', () => {
    const legal = 'k7/8/8/3pP3/8/8/8/4K3 w -';
    expect(key(`${legal} d6 0 1`)).not.toBe(key(`${legal} - 0 1`));
    const pinned = 'k3r3/8/8/3pP3/8/8/8/4K3 w -';
    expect(key(`${pinned} d6 0 1`)).toBe(key(`${pinned} - 0 1`));
    const absent = 'k7/8/8/3p4/8/8/8/4K3 w -';
    expect(key(`${absent} d6 0 1`)).toBe(key(`${absent} - 0 1`));
  });

  it('does not count the original castling rights after a rook returns', () => {
    const game = createGameFromPosition('4k2r/8/8/8/8/8/8/R3K3 w Qk - 0 1');
    const moves = ['a1a2', 'h8h7', 'a2a1', 'h7h8'];
    play(game, ...moves, ...moves);
    unchanged(game, () => game.claimDraw({ side: 'white', rule: 'threefold_repetition' }), 'claim_not_available');
    play(game, ...moves);
    expect(game.claimDraw({ side: 'white', rule: 'threefold_repetition' }).accepted).toBe(true);
  });

  it.each([false, true])('counts expired en passant correctly when a pawn is pinned: %s', pinned => {
    const game = createGameFromPosition(`${pinned ? 'k3r3' : 'k7'}/8/8/3pP3/8/8/8/4K3 w - d6 0 1`);
    const moves = ['e1d1', 'a8b8', 'd1e1', 'b8a8'];
    play(game, ...moves, ...moves);
    if (!pinned) {
      unchanged(game, () => game.claimDraw({ side: 'white', rule: 'threefold_repetition' }), 'claim_not_available');
      play(game, ...moves);
    }
    expect(game.claimDraw({ side: 'white', rule: 'threefold_repetition' }).accepted).toBe(true);
  });
});

describe('mating possibility and dead positions', () => {
  it.each([
    '4k3/8/8/8/8/8/8/4K3 w - - 0 1',
    '4k3/8/8/8/8/8/8/2B1K3 w - - 0 1',
    '4k3/8/8/8/8/8/8/1N2K3 w - - 0 1',
    '2b1k3/8/8/8/8/8/8/4KB2 w - - 0 1',
    '4k3/8/8/8/8/4B3/8/2B1K3 w - - 0 1',
  ])('automatically draws a proven material-dead position: %s', fen => {
    const game = createGameFromPosition(fen);
    expect(game.getState().result).toEqual({ outcome: 'draw', reason: 'dead_position' });
    expect(game.getMatingPossibility('white')).toBe('impossible');
    expect(game.getMatingPossibility('black')).toBe('impossible');
    unchanged(game, () => game.resign({ side: 'white' }), 'game_finished');
  });

  it('detects a dead position immediately after a capture', () => {
    const game = createGameFromPosition('4k3/8/8/8/8/8/4r3/4K3 w - - 0 1');
    play(game, 'e1e2');
    expect(game.getState().result).toEqual({ outcome: 'draw', reason: 'dead_position' });
    expect(game.getHistory()).toHaveLength(1);
  });

  it('proves a closed pawn wall without calling it insufficient material', () => {
    const game = createGameFromPosition('1k6/8/1p1p1p1p/pPpPpPpP/P1P1P1P1/8/8/1K6 w - - 0 1');
    expect(game.getState().result).toEqual({ outcome: 'draw', reason: 'dead_position' });
  });

  it('keeps a blocked pawn position active when a king can eventually capture a pawn', () => {
    const game = createGameFromPosition('7k/8/8/p7/P7/8/8/4K3 w - - 0 1');
    expect(game.getMatingPossibility('white')).toBe('unresolved');
    expect(game.getMatingPossibility('black')).toBe('unresolved');
    expect(game.getState().status).toBe('active');
  });

  it.each([
    { fen: '7k/5K2/5N2/4N3/8/8/8/8 w - - 0 1', move: 'e5g6' },
    { fen: '6nk/8/6KN/8/8/8/8/8 w - - 0 1', move: 'h6f7' },
  ])('permits cooperative mate rather than testing whether mate can be forced: $move', ({ fen, move }) => {
    const game = createGameFromPosition(fen);
    expect(game.getMatingPossibility('white')).toBe('possible');
    expect(game.getState().status).toBe('active');
    play(game, move);
    expect(game.getState().result).toEqual({ outcome: 'win', winner: 'white', reason: 'checkmate' });
  });

  it.each([
    '4k3/8/8/8/8/8/8/2B1KB2 w - - 0 1',
    '2b1k3/8/8/8/8/8/8/2B1K3 w - - 0 1',
    '4k3/8/8/8/8/8/p7/1N2K3 w - - 0 1',
  ])('does not falsely draw opposite-color bishops or helpmate material: %s', fen => {
    expect(createGameFromPosition(fen).getState().status).toBe('active');
  });

  it.each(['white', 'black'] as const)('draws when %s resigns against a bare king', side => {
    const game = createGameFromPosition(side === 'white'
      ? '4k3/8/8/8/8/8/8/R3K3 w - - 0 1'
      : 'r3k3/8/8/8/8/8/8/4K3 b - - 0 1');
    expect(game.getState().status).toBe('active');
    expect(game.resign({ side })).toMatchObject({ accepted: true,
      game: { result: { outcome: 'draw', reason: 'resignation_no_mating_possibility' } } });
    unchanged(game, () => game.resign({ side }), 'game_finished');
  });

  it('allows a resignation win for two knights, which can possibly mate', () => {
    const game = createGameFromPosition('7k/5K2/5N2/4N3/8/8/8/8 w - - 0 1');
    expect(game.getMatingPossibility('white')).toBe('possible');
    expect(game.resign({ side: 'black' })).toMatchObject({ accepted: true,
      game: { result: { outcome: 'win', winner: 'white', reason: 'resignation' } } });
  });

  it.each([
    '3qk3/8/8/8/8/8/8/1N2K3 b - - 0 1',
    'r3k3/8/8/8/8/8/8/2B1K3 b - - 0 1',
    '3qk3/8/8/8/8/8/8/2B1K3 b - - 0 1',
  ])('uses a one-sided impossibility proof even when the other side can mate: %s', fen => {
    const game = createGameFromPosition(fen);
    expect(game.getState().status).toBe('active');
    expect(game.getMatingPossibility('white')).toBe('impossible');
    expect(game.getMatingPossibility('black')).toBe('unresolved');
    expect(game.resign({ side: 'black' })).toMatchObject({ accepted: true,
      game: { result: { outcome: 'draw', reason: 'resignation_no_mating_possibility' } } });
  });

  it('accepts an unresolved resignation and freezes the game for adjudication', () => {
    const game = createGame();
    expect(game.getMatingPossibility('white')).toBe('unresolved');
    expect(game.getMatingPossibility('black')).toBe('unresolved');
    expect(game.resign({ side: 'white' })).toMatchObject({ accepted: true,
      game: { status: 'pending_adjudication', result: null, drawOffer: null,
        pending: { kind: 'resignation', resigningSide: 'white' } } });
    expect(game.getHistory()).toEqual([]);
    unchanged(game, () => game.submitMove({ side: 'white', from: 'e2', to: 'e4' }), 'adjudication_pending');
    unchanged(game, () => game.resign({ side: 'white' }), 'adjudication_pending');
    unchanged(game, () => game.resign({ side: 'black' }), 'adjudication_pending');
    unchanged(game, () => game.offerDraw({ side: 'black' }), 'adjudication_pending');
    unchanged(game, () => game.acceptDraw({ side: 'black' }), 'adjudication_pending');
    unchanged(game, () => game.declineDraw({ side: 'black' }), 'adjudication_pending');
    unchanged(game, () => game.claimDraw({ side: 'white', rule: 'fifty_move' }), 'adjudication_pending');

    const mateLine = ['f2f3', 'e7e5', 'g2g4', 'd8h4'].map(uci => ({ from: uci.slice(0, 2), to: uci.slice(2) }));
    unchanged(game, () => game.resolveResignation({ verdict: 'mate_possible', mateLine: mateLine.slice(0, -1) }),
      'invalid_ruling');
    unchanged(game, () => game.resolveResignation({ verdict: 'mate_possible', mateLine: [
      { from: 'e2', to: 'e4' }, ...mateLine.slice(1),
    ] }), 'invalid_ruling');
    const wrongWinner = ['e2e4', 'e7e5', 'f1c4', 'b8c6', 'd1h5', 'g8f6', 'h5f7']
      .map(uci => ({ from: uci.slice(0, 2), to: uci.slice(2) }));
    unchanged(game, () => game.resolveResignation({ verdict: 'mate_possible', mateLine: wrongWinner }),
      'invalid_ruling');
    expect(game.resolveResignation({ verdict: 'mate_possible', mateLine })).toMatchObject({ accepted: true,
      game: { status: 'finished', result: { outcome: 'win', winner: 'black', reason: 'resignation' },
        adjudication: { verdict: 'mate_possible', mateLine } } });
    expect(game.getHistory()).toEqual([]);
    const detached = game.getState();
    if (detached.status !== 'finished' || detached.adjudication?.verdict !== 'mate_possible') {
      throw new Error('Expected a verified mate-line ruling');
    }
    Object.assign(detached.adjudication.mateLine[0]!, { from: 'a1' });
    expect(game.getState()).toMatchObject({ adjudication: { mateLine } });
    unchanged(game, () => game.resolveResignation({ verdict: 'mate_possible', mateLine }), 'game_finished');
    unchanged(game, () => game.resign({ side: 'white' }), 'game_finished');
  });

  it('keeps a normal middlegame frozen, including its history and pending offer', () => {
    const game = createGame();
    play(game, 'e2e4', 'e7e5');
    expect(game.offerDraw({ side: 'white' }).accepted).toBe(true);
    const position = game.getState().position;
    const history = game.getHistory();
    expect(game.resign({ side: 'black' })).toMatchObject({ accepted: true,
      game: { status: 'pending_adjudication', result: null, drawOffer: null,
        pending: { kind: 'resignation', resigningSide: 'black' } } });
    expect(game.getState().position).toEqual(position);
    expect(game.getHistory()).toEqual(history);
    unchanged(game, () => game.submitMove({ side: 'white', from: 'g1', to: 'f3' }), 'adjudication_pending');
    const mateLine = ['f1c4', 'b8c6', 'd1h5', 'g8f6', 'h5f7']
      .map(uci => ({ from: uci.slice(0, 2), to: uci.slice(2) }));
    expect(game.resolveResignation({ verdict: 'mate_possible', mateLine })).toMatchObject({ accepted: true,
      game: { status: 'finished', result: { outcome: 'win', winner: 'white', reason: 'resignation' } } });
    expect(game.getHistory()).toEqual(history);
  });

  it('cannot resolve an active game as though it had a pending resignation', () => {
    const game = createGame();
    unchanged(game, () => game.resolveResignation({ verdict: 'mate_possible', mateLine: [] }),
      'no_pending_resignation');
  });

  it('does not turn an unsupported no-mate claim into a draw', () => {
    // Every file has opposed pawns on ranks four and five. Kings and bishops stay behind their own wall.
    const game = createGameFromPosition('b6k/8/8/pppppppp/PPPPPPPP/8/8/B3K3 w - - 0 1');
    expect(game.getState().status).toBe('active');
    expect(game.getMatingPossibility('black')).toBe('unresolved');
    expect(game.resign({ side: 'white' }).accepted).toBe(true);
    const unsupported = { verdict: 'mate_impossible', reviewerId: 'reviewer-1',
      evidenceReference: 'closed-wall-proof-1' } as unknown as ResignationRuling;
    unchanged(game, () => game.resolveResignation(unsupported), 'invalid_ruling');
    expect(game.getState()).toMatchObject({ status: 'pending_adjudication', result: null });
  });
});

describe('invalid claims', () => {
  it.each([
    { command: { side: 'black', rule: 'fifty_move' }, reason: 'wrong_turn' },
    { command: { side: 'spectator', rule: 'fifty_move' }, reason: 'invalid_side' },
    { command: { side: 'white', rule: 'agreement' }, reason: 'invalid_claim' },
    { command: { side: 'white', rule: 'fifty_move', intendedMove: { from: 'e2', to: 'e5' } }, reason: 'illegal_move' },
    { command: { side: 'white', rule: 'fifty_move', intendedMove: { from: 'z2', to: 'e4' } }, reason: 'invalid_input' },
    { command: { side: 'white', rule: 'fifty_move', intendedMove: { from: 'e2', to: 'e4' } }, reason: 'claim_not_available' },
  ])('preserves all state, including a pending offer: $reason', ({ command, reason }) => {
    const game = createGame();
    expect(game.offerDraw({ side: 'black' }).accepted).toBe(true);
    unchanged(game, () => game.claimDraw(command as DrawClaim), reason);
  });

  it('rejects missing promotion in an intended move', () => {
    const game = createGameFromPosition('7k/P7/8/8/8/8/8/4K3 w - - 99 50');
    unchanged(game, () => game.claimDraw({ side: 'white', rule: 'fifty_move',
      intendedMove: { from: 'a7', to: 'a8' } }), 'promotion_required');
  });

  it('rejects an intended move exposing the king, even if the counter would reach 100', () => {
    const game = createGameFromPosition('k3r3/8/8/8/8/8/4R3/4K3 w - - 99 50');
    unchanged(game, () => game.claimDraw({ side: 'white', rule: 'fifty_move',
      intendedMove: { from: 'e2', to: 'd2' } }), 'illegal_move');
  });
});
