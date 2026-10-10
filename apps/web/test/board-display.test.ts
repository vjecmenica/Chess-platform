import { Chess } from 'chess.js';
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import type { GameReadResponse, SavedMove } from '@chess/contracts';
import { STANDARD_STARTING_FEN } from '@chess/domain';
import { createAnalysisTree, playAnalysisMove, selectMain, selectBranch } from '../src/analysis-model';
import { boardCoordinates, capturedPieces, highlightedMove, materialAdvantage } from '../src/board-display';
import { CapturedRow, MaterialTotal, signedMaterial } from '../src/CapturedMaterial';
import { pieceImage } from '../src/board-interaction';

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

function playedGame(moves: readonly string[], fen?: string): GameReadResponse {
  const board = new Chess(fen);
  const saved: SavedMove[] = moves.map((san, index) => {
    const beforeFen = board.fen();
    const move = board.move(san);
    if (!move) throw new Error(`Illegal test move: ${san}`);
    return { ply: index + 1, side: move.color === 'w' ? 'white' : 'black',
      from: move.from, to: move.to, san: move.san, uci: `${move.from}${move.to}${move.promotion ?? ''}`,
      beforeFen, afterFen: board.fen(), remainingMsAfterMove: null };
  });
  return { ...game, version: saved.length, history: saved,
    position: { fen: board.fen(), sideToMove: board.turn() === 'w' ? 'white' : 'black' } };
}

describe('board display', () => {
  it('cancels equal captures by type and keeps repeated uncancelled captures', () => {
    const exchanged = playedGame(['e4', 'd5', 'exd5', 'Qxd5']);
    expect(capturedPieces(exchanged, 3, null)).toEqual({ white: ['p'], black: [] });
    expect(capturedPieces(exchanged, 4, null)).toEqual({ white: [], black: [] });
    const twoPawns = playedGame(['e4', 'd5', 'exd5', 'c6', 'dxc6']);
    expect(capturedPieces(twoPawns, 5, null)).toEqual({ white: ['p', 'p'], black: [] });
    const repeated = playedGame(['e4', 'd5', 'exd5', 'Qxd5', 'Nc3', 'Qd8', 'd4', 'c5', 'dxc5']);
    expect(capturedPieces(repeated, 9, null)).toEqual({ white: ['p'], black: [] });
    expect(materialAdvantage(repeated.position.fen)).toEqual({ side: 'white', points: 1 });
  });

  it('keeps different captured types and calculates the net exchange', () => {
    const exchange = playedGame(['Rxa8', 'Rxh1+'],
      'r7/4k3/8/8/8/8/1PP4r/R3K2N w Q - 0 1');
    expect(capturedPieces(exchange, 2, null)).toEqual({ white: ['r'], black: ['n'] });
    expect(materialAdvantage(exchange.position.fen)).toEqual({ side: 'white', points: 2 });
  });

  it('counts en passant as a captured pawn and preserves promotion material', () => {
    const enPassant = playedGame(['e4', 'a6', 'e5', 'd5', 'exd6']);
    expect(capturedPieces(enPassant, 5, null)).toEqual({ white: ['p'], black: [] });
    const promotion = playedGame(['a8=Q'], '4k3/P7/8/8/8/8/8/4K3 w - - 0 1');
    expect(capturedPieces(promotion, 1, null)).toEqual({ white: [], black: [] });
    expect(materialAdvantage(promotion.position.fen)).toEqual({ side: 'white', points: 9 });
  });

  it('follows the selected main or variation path instead of the saved final position', () => {
    const saved = playedGame(['e4', 'd5', 'exd5', 'Qxd5']);
    const tree = selectMain(createAnalysisTree(saved), saved, 2);
    const alternative = playAnalysisMove(tree, saved, 'g1', 'f3');
    expect(alternative.accepted).toBe(true);
    if (!alternative.accepted) return;
    const capture = playAnalysisMove(alternative.tree, saved, 'd5', 'e4');
    expect(capture.accepted).toBe(true);
    if (!capture.accepted) return;
    expect(capturedPieces(saved, 4, capture.tree)).toEqual({ white: [], black: ['p'] });
    expect(capturedPieces(saved, 4, selectBranch(capture.tree, alternative.tree.cursor.kind === 'branch'
      ? alternative.tree.cursor.id : -1))).toEqual({ white: [], black: [] });
    expect(capturedPieces(saved, 4, selectMain(capture.tree, saved, 3)))
      .toEqual({ white: ['p'], black: [] });
  });

  it('renders captured opponent icons on the side matching board orientation', () => {
    const captures = { white: ['r' as const], black: ['n' as const] };
    const whiteTop = renderToStaticMarkup(createElement(CapturedRow,
      { side: 'black', pieces: captures.black, placement: 'top' }));
    const whiteBottom = renderToStaticMarkup(createElement(CapturedRow,
      { side: 'white', pieces: captures.white, placement: 'bottom' }));
    expect(whiteTop).toContain('Captured white knight');
    expect(whiteBottom).toContain('Captured black rook');
    const blackTop = renderToStaticMarkup(createElement(CapturedRow,
      { side: 'white', pieces: captures.white, placement: 'top' }));
    const blackBottom = renderToStaticMarkup(createElement(CapturedRow,
      { side: 'black', pieces: captures.black, placement: 'bottom' }));
    expect(blackTop).toContain('Captured black rook');
    expect(blackBottom).toContain('Captured white knight');
    expect(whiteTop).toContain(pieceImage('N'));
    const emptyTop = renderToStaticMarkup(createElement(CapturedRow,
      { side: 'white', pieces: [], placement: 'top' }));
    const emptyBottom = renderToStaticMarkup(createElement(CapturedRow,
      { side: 'black', pieces: [], placement: 'bottom' }));
    expect(emptyTop).toContain('captured-top');
    expect(emptyBottom).toContain('captured-bottom');
    const css = readFileSync(new URL('../src/style.css', import.meta.url), 'utf8');
    expect(css).toMatch(/\.captured-row \{[^}]*height: 33px/);
    expect(blackTop).not.toContain('captured-player');
    expect(blackTop).toContain('captured-black');
  });

  it('signs the material balance for the bottom side and hides equal material', () => {
    const lead = { side: 'white' as const, points: 6 };
    expect(signedMaterial(lead, 'white')).toBe(6);
    expect(signedMaterial(lead, 'black')).toBe(-6);
    expect(signedMaterial(null, 'white')).toBeNull();
    const whiteBottom = renderToStaticMarkup(createElement(MaterialTotal,
      { advantage: lead, bottomSide: 'white' }));
    const blackBottom = renderToStaticMarkup(createElement(MaterialTotal,
      { advantage: lead, bottomSide: 'black' }));
    expect(whiteBottom).toContain('>+6</span>');
    expect(whiteBottom).toContain('material-positive');
    expect(blackBottom).toContain('>-6</span>');
    expect(blackBottom).toContain('material-negative');
    expect(whiteBottom).not.toContain('White +6');
    expect(renderToStaticMarkup(createElement(MaterialTotal,
      { advantage: null, bottomSide: 'white' }))).toBe('');
  });

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
