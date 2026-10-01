import { createPositionFromFen } from '@chess/domain';
import type { GameSide } from '@chess/contracts';
import { boardRows, needsPromotion, pieceBelongsTo, type Piece, type Square } from './board-model';

export type BoardMove =
  | { kind: 'move'; from: Square; to: Square }
  | { kind: 'promotion'; from: Square; to: Square }
  | { kind: 'invalid' };

export function pieceAt(fen: string, square: Square): Piece | null {
  return boardRows(fen, 'white').flat().find(item => item.square === square)?.piece ?? null;
}

export function legalMoveHints(fen: string, side: GameSide, from: Square): ReadonlyMap<Square, boolean> {
  const position = createPositionFromFen(fen);
  if (position.getPosition().sideToMove !== side || !pieceBelongsTo(pieceAt(fen, from), side)) {
    return new Map();
  }
  return new Map(position.getLegalDestinations(from)
    .map(destination => [destination.to as Square, destination.capture]));
}

// The king-on-rook gesture is only an input shortcut. The domain still checks
// the ordinary king move, including castling rights and attacked transit squares.
export function boardMove(fen: string, side: GameSide, from: Square, target: Square | null): BoardMove {
  const piece = pieceAt(fen, from);
  if (!pieceBelongsTo(piece, side) || target === null || from === target) return { kind: 'invalid' };
  let to = target;
  const home = side === 'white' ? '1' : '8';
  const king = side === 'white' ? 'K' : 'k';
  const rook = side === 'white' ? 'R' : 'r';
  if (piece === king && from === `e${home}` && pieceAt(fen, target) === rook) {
    if (target === `h${home}`) to = `g${home}` as Square;
    else if (target === `a${home}`) to = `c${home}` as Square;
  }
  const result = createPositionFromFen(fen).submitMove({ side, from, to });
  if (result.accepted) return { kind: 'move', from, to };
  if (result.reason === 'promotion_required' && needsPromotion(piece, to)) {
    return { kind: 'promotion', from, to };
  }
  return { kind: 'invalid' };
}

export function pieceImage(piece: Piece): string {
  return `/pieces/chessnut/${piece === piece.toUpperCase() ? 'w' : 'b'}${piece.toUpperCase()}.svg`;
}
