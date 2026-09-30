import { describe, expect, it } from 'vitest';
import type { GameReadResponse, MoveAcceptedResponse, SavedMove } from '@chess/contracts';
import { applyAcceptedMove, boardRows, mergeConfirmedGame, needsPromotion,
  pieceBelongsTo } from '../src/board-model';

const start = 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1';
const afterE4 = 'rnbqkbnr/pppppppp/8/8/4P3/8/PPPP1PPP/RNBQKBNR b KQkq - 0 1';

function game(version = 0): GameReadResponse {
  return { id: 'game', version, status: 'active', yourSeat: 'white',
    position: { fen: version === 0 ? start : afterE4, sideToMove: version === 0 ? 'white' : 'black' },
    result: null, clocks: null, clockStatus: 'not_integrated',
    timeControl: { initialMs: 300_000, incrementMs: 3_000 }, rated: false, history: [] };
}

describe('board rendering model', () => {
  it('places the standard position correctly from each seat', () => {
    const white = boardRows(start, 'white');
    const black = boardRows(start, 'black');
    expect(white.map(row => row.map(item => item.square))).toHaveLength(8);
    expect(white[0]?.[0]).toMatchObject({ square: 'a8', piece: 'r', dark: false });
    expect(white[7]?.[0]).toMatchObject({ square: 'a1', piece: 'R', dark: true });
    expect(white[6]?.[4]).toMatchObject({ square: 'e2', piece: 'P' });
    expect(black[0]?.[0]).toMatchObject({ square: 'h1', piece: 'R' });
    expect(black[7]?.[7]).toMatchObject({ square: 'a8', piece: 'r' });
    expect(black[1]?.[3]).toMatchObject({ square: 'e2', piece: 'P' });
  });

  it('reads changed positions and recognizes ownership and promotion', () => {
    expect(boardRows(afterE4, 'white').flat().find(item => item.square === 'e4')?.piece).toBe('P');
    expect(boardRows(afterE4, 'white').flat().find(item => item.square === 'e2')?.piece).toBeNull();
    expect(pieceBelongsTo('P', 'white')).toBe(true);
    expect(pieceBelongsTo('p', 'white')).toBe(false);
    expect(needsPromotion('P', 'a8')).toBe(true);
    expect(needsPromotion('p', 'h1')).toBe(true);
    expect(needsPromotion('N', 'a8')).toBe(false);
    expect(() => boardRows('8/8/8/8/8/8/8/7x w - - 0 1', 'white')).toThrow();
  });
});

describe('confirmed game state', () => {
  const move: SavedMove = { ply: 1, side: 'white', from: 'e2', to: 'e4', uci: 'e2e4', san: 'e4',
    beforeFen: start, afterFen: afterE4 };
  const accepted: MoveAcceptedResponse = { accepted: true, move, game: game(1) };

  it('does not append a selected move until a matching accepted response arrives', () => {
    const initial = game();
    expect(initial.history).toEqual([]);
    expect(applyAcceptedMove(initial, accepted)).toMatchObject({ version: 1,
      position: { fen: afterE4, sideToMove: 'black' }, history: [move] });
    expect(initial.history).toEqual([]);
    expect(applyAcceptedMove(initial, { ...accepted, game: game(2) })).toBe(initial);
  });

  it('keeps a newer confirmation when an older poll or retry response arrives', () => {
    const confirmed = applyAcceptedMove(game(), accepted)!;
    expect(mergeConfirmedGame(confirmed, game())).toBe(confirmed);
    expect(applyAcceptedMove(confirmed, accepted)).toBe(confirmed);
    expect(mergeConfirmedGame(game(), confirmed)).toBe(confirmed);
  });

  it('appends a timed move when readiness has advanced the state version', () => {
    const ready = game(0);
    const waitingForMove = { ...ready, version: 2 };
    const timedReply = { ...accepted, game: { ...accepted.game, version: 3 } };
    expect(applyAcceptedMove(waitingForMove, timedReply)?.history).toEqual([move]);
  });
});
