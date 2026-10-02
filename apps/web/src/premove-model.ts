import type { GameSide } from '@chess/contracts';
import { boardMove } from './board-interaction';
import { boardRows, needsPromotion, pieceBelongsTo, type Piece, type Square } from './board-model';

export interface Premove { id: string; from: Square; to: Square; promotion?: 'q' | 'r' | 'b' | 'n' }
export type PremoveChoice = { kind: 'move'; from: Square; to: Square }
  | { kind: 'promotion'; from: Square; to: Square } | { kind: 'invalid' };

export function addPremove(queue: readonly Premove[], move: Premove): Premove[] {
  return [...queue, move];
}

export function consumePremove(queue: readonly Premove[], id: string): Premove[] {
  return queue[0]?.id === id ? queue.slice(1) : [...queue];
}

export function projectedPieces(fen: string, side: GameSide, queue: readonly Premove[]): Map<Square, Piece> {
  const pieces = new Map(boardRows(fen, 'white').flat()
    .filter((entry): entry is { square: Square; piece: Piece; dark: boolean } => entry.piece !== null)
    .map(entry => [entry.square, entry.piece]));
  for (const move of queue) {
    const piece = pieces.get(move.from);
    if (piece === undefined || !pieceBelongsTo(piece, side)) continue;
    pieces.delete(move.from);
    if (piece.toLowerCase() === 'p' && move.from[0] !== move.to[0] && !pieces.has(move.to)) {
      pieces.delete(`${move.to[0]}${move.from[1]}` as Square);
    }
    pieces.set(move.to, move.promotion === undefined ? piece
      : (side === 'white' ? move.promotion.toUpperCase() : move.promotion) as Piece);
    if (piece.toLowerCase() === 'k' && move.from[0] === 'e' && ['g', 'c'].includes(move.to[0] ?? '')) {
      const rank = side === 'white' ? '1' : '8';
      const rookFrom = `${move.to[0] === 'g' ? 'h' : 'a'}${rank}` as Square;
      const rookTo = `${move.to[0] === 'g' ? 'f' : 'd'}${rank}` as Square;
      const rook = pieces.get(rookFrom);
      if (rook?.toLowerCase() === 'r') { pieces.delete(rookFrom); pieces.set(rookTo, rook); }
    }
  }
  return pieces;
}

// A premove is only a plan. Opponent replies may change its legality, so the
// confirmed position is checked again before a queued move is submitted.
export function premoveChoice(fen: string, side: GameSide, queue: readonly Premove[],
  from: Square, target: Square | null): PremoveChoice {
  if (target === null || from === target) return { kind: 'invalid' };
  const pieces = projectedPieces(fen, side, queue);
  const piece = pieces.get(from) ?? null;
  if (!pieceBelongsTo(piece, side)) return { kind: 'invalid' };
  let to = target;
  const rank = side === 'white' ? '1' : '8';
  if (piece?.toLowerCase() === 'k' && from === `e${rank}`
    && pieces.get(target)?.toLowerCase() === 'r') {
    if (target === `h${rank}`) to = `g${rank}` as Square;
    else if (target === `a${rank}`) to = `c${rank}` as Square;
  }
  if (pieceBelongsTo(pieces.get(to) ?? null, side)) return { kind: 'invalid' };
  return needsPromotion(piece, to) ? { kind: 'promotion', from, to } : { kind: 'move', from, to };
}

export function nextPremove(fen: string, side: GameSide, queue: readonly Premove[]): Premove | null {
  const next = queue[0];
  if (!next) return null;
  const checked = boardMove(fen, side, next.from, next.to);
  if (checked.kind === 'move') return next.promotion === undefined ? next : null;
  return checked.kind === 'promotion' && next.promotion !== undefined ? next : null;
}
