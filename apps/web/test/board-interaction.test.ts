import { describe, expect, it } from 'vitest';
import { boardRows } from '../src/board-model';
import { boardMove, pieceImage } from '../src/board-interaction';

const start = 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1';
const castleWhite = 'r3k2r/8/8/8/8/8/8/R3K2R w KQkq - 0 1';
const castleBlack = 'r3k2r/8/8/8/8/8/8/R3K2R b KQkq - 0 1';

describe('board input shared by clicks and drops', () => {
  it('accepts an ordinary move and cancels illegal, same-square, and outside-board drops', () => {
    expect(boardMove(start, 'white', 'e2', 'e4')).toEqual({ kind: 'move', from: 'e2', to: 'e4' });
    expect(boardMove(start, 'white', 'e2', 'e5')).toEqual({ kind: 'invalid' });
    expect(boardMove(start, 'white', 'e2', null)).toEqual({ kind: 'invalid' });
    expect(boardMove(start, 'white', 'e2', 'e2')).toEqual({ kind: 'invalid' });
    expect(boardMove(start, 'black', 'e2', 'e4')).toEqual({ kind: 'invalid' });
  });

  it('uses algebraic squares even when the board is flipped', () => {
    const flipped = boardRows(start, 'black');
    expect(flipped[1]?.[3]?.square).toBe('e2');
    expect(flipped[3]?.[3]?.square).toBe('e4');
    expect(boardMove(start, 'white', flipped[1]![3]!.square, flipped[3]![3]!.square))
      .toEqual({ kind: 'move', from: 'e2', to: 'e4' });
  });

  it('requests promotion through the existing choice flow', () => {
    const white = '4k3/P7/8/8/8/8/8/4K3 w - - 0 1';
    const black = '4k3/8/8/8/8/8/p7/4K3 b - - 0 1';
    expect(boardMove(white, 'white', 'a7', 'a8')).toEqual({ kind: 'promotion', from: 'a7', to: 'a8' });
    expect(boardMove(black, 'black', 'a2', 'a1')).toEqual({ kind: 'promotion', from: 'a2', to: 'a1' });
  });

  it.each([
    [castleWhite, 'white', 'e1', 'h1', 'g1'],
    [castleWhite, 'white', 'e1', 'a1', 'c1'],
    [castleBlack, 'black', 'e8', 'h8', 'g8'],
    [castleBlack, 'black', 'e8', 'a8', 'c8'],
  ] as const)('maps a legal king-on-rook gesture to the king destination', (fen, side, from, rook, to) => {
    expect(boardMove(fen, side, from, rook)).toEqual({ kind: 'move', from, to });
    expect(boardMove(fen, side, from, to)).toEqual({ kind: 'move', from, to });
  });

  it('does not translate illegal castling, including castling through check', () => {
    expect(boardMove(start, 'white', 'e1', 'h1')).toEqual({ kind: 'invalid' });
    expect(boardMove('r3k2r/8/8/8/2b5/8/8/R3K2R w KQkq - 0 1',
      'white', 'e1', 'h1')).toEqual({ kind: 'invalid' });
    expect(boardMove('r3k2r/8/8/8/8/8/8/R3K2R w Qq - 0 1',
      'white', 'e1', 'h1')).toEqual({ kind: 'invalid' });
  });

  it('bundles a piece image for each color', () => {
    expect(pieceImage('K')).toBe('/pieces/chessnut/wK.svg');
    expect(pieceImage('p')).toBe('/pieces/chessnut/bP.svg');
  });
});
