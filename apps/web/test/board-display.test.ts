import { Chess } from 'chess.js';
import { describe, expect, it } from 'vitest';
import type { GameReadResponse, SavedMove } from '@chess/contracts';
import { STANDARD_STARTING_FEN } from '@chess/domain';
import { createAnalysisTree, playAnalysisMove, selectMain } from '../src/analysis-model';
import { boardCoordinates, highlightedMove, materialAdvantage } from '../src/board-display';

const afterE4 = 'rnbqkbnr/pppppppp/8/8/4P3/8/PPPP1PPP/RNBQKBNR b KQkq - 0 1';
const afterE5 = 'rnbqkbnr/pppp1ppp/8/4p3/4P3/8/PPPP1PPP/RNBQKBNR w KQkq - 0 2';
const history: SavedMove[] = [
  { ply: 1, side: 'white', from: 'e2', to: 'e4', san: 'e4', uci: 'e2e4',
    beforeFen: STANDARD_STARTING_FEN, afterFen: afterE4 },
  { ply: 2, side: 'black', from: 'e7', to: 'e5', san: 'e5', uci: 'e7e5',
    beforeFen: afterE4, afterFen: afterE5 },
];
const game: GameReadResponse = {
  id: 'game', version: 2, status: 'finished', position: { fen: afterE5, sideToMove: 'white' },
  result: { outcome: 'draw', reason: 'agreement' }, drawOffer: null,
  drawOfferNextEligiblePly: { white: 2, black: 2 }, clocks: null,
  clockStatus: 'not_integrated', timeControl: { initialMs: 300_000, incrementMs: 3_000 },
  rated: false, yourSeat: 'white', history,
};

describe('board display', () => {
  it('calculates material from the displayed position after a capture, equal trade, and promotion', () => {
    const board = new Chess();
    expect(materialAdvantage(board.fen())).toBeNull();
    board.move('e4'); board.move('d5'); board.move('exd5');
    expect(materialAdvantage(board.fen())).toEqual({ side: 'white', points: 1 });
    board.move('Qxd5');
    expect(materialAdvantage(board.fen())).toBeNull();

    const promotion = new Chess('4k3/P7/8/8/8/8/8/4K3 w - - 0 1');
    expect(materialAdvantage(promotion.fen())).toEqual({ side: 'white', points: 1 });
    promotion.move({ from: 'a7', to: 'a8', promotion: 'q' });
    expect(materialAdvantage(promotion.fen())).toEqual({ side: 'white', points: 9 });
    expect(materialAdvantage('4k3/8/8/8/8/8/p7/4K3 w - - 0 1'))
      .toEqual({ side: 'black', points: 1 });
  });

  it('reverses edge coordinates for Black without changing the square names', () => {
    expect(boardCoordinates('white')).toEqual({ files: [...'abcdefgh'], ranks: [...'87654321'] });
    expect(boardCoordinates('black')).toEqual({ files: [...'hgfedcba'], ranks: [...'12345678'] });
  });

  it('highlights the live last move, replay selection, and selected variation', () => {
    expect(highlightedMove(game, game.history.length, null)).toEqual({ from: 'e7', to: 'e5' });
    expect(highlightedMove(game, 0, null)).toBeNull();
    expect(highlightedMove(game, 1, null)).toEqual({ from: 'e2', to: 'e4' });
    const initial = selectMain(createAnalysisTree(game), game, 0);
    expect(highlightedMove(game, 2, initial)).toBeNull();
    const variation = playAnalysisMove(initial, game, 'd2', 'd4');
    expect(variation.accepted).toBe(true);
    if (!variation.accepted) return;
    expect(highlightedMove(game, 2, variation.tree)).toEqual({ from: 'd2', to: 'd4' });
    expect(highlightedMove(game, 2, selectMain(variation.tree, game, 2)))
      .toEqual({ from: 'e7', to: 'e5' });
  });
});
