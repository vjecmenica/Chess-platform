import type { GameSide } from '@chess/contracts';
import { boardMove } from './board-interaction';
import { boardRows, needsPromotion, pieceBelongsTo, type Piece, type Square } from './board-model';

export interface Premove { id: string; from: Square; to: Square; promotion?: 'q' | 'r' | 'b' | 'n' }
export type PremoveChoice = { kind: 'move'; from: Square; to: Square }
  | { kind: 'promotion'; from: Square; to: Square } | { kind: 'invalid' };
const promotions = ['q', 'r', 'b', 'n'];

export function addPremove(queue: readonly Premove[], move: Premove): Premove[] { return [...queue, move]; }
export function consumePremove(queue: readonly Premove[], id: string): Premove[] {
  return queue[0]?.id === id ? queue.slice(1) : [...queue];
}

// Validate intrinsic movement, not the unknown opponent reply. Blockers, capture
// availability, attacked squares and check are rechecked by the domain at execution.
function speculativeChoice(pieces: ReadonlyMap<Square, Piece>, side: GameSide, rights: ReadonlySet<string>,
  from: Square, target: Square | null): PremoveChoice {
  if (target === null || from === target) return { kind: 'invalid' };
  const piece = pieces.get(from) ?? null;
  if (!piece || !pieceBelongsTo(piece, side)) return { kind: 'invalid' };
  let to = target;
  const home = side === 'white' ? '1' : '8', kind = piece.toLowerCase();
  const rook = side === 'white' ? 'R' : 'r';
  if (kind === 'k' && from === `e${home}` && pieces.get(target) === rook) {
    if (target === `h${home}`) to = `g${home}` as Square;
    else if (target === `a${home}`) to = `c${home}` as Square;
  }
  // The opponent may capture a friendly target before this plan executes.
  // Our king cannot be captured or vacated by an opponent reply.
  if (pieces.get(to) === (side === 'white' ? 'K' : 'k')) return { kind: 'invalid' };
  const dx = to.charCodeAt(0) - from.charCodeAt(0), dy = Number(to[1]) - Number(from[1]);
  const x = Math.abs(dx), y = Math.abs(dy), forward = side === 'white' ? 1 : -1;
  let possible = false;
  switch (kind) {
    case 'p': possible = dy === forward && x <= 1
      || dx === 0 && dy === 2 * forward && from[1] === (side === 'white' ? '2' : '7'); break;
    case 'n': possible = x * y === 2; break;
    case 'b': possible = x === y; break;
    case 'r': possible = dx === 0 || dy === 0; break;
    case 'q': possible = x === y || dx === 0 || dy === 0; break;
    case 'k': {
      const kingSide = to === `g${home}`, queenSide = to === `c${home}`;
      const castleRight = side === 'white' ? kingSide ? 'K' : 'Q' : kingSide ? 'k' : 'q';
      const castleRook = `${kingSide ? 'h' : 'a'}${home}` as Square;
      possible = Math.max(x, y) === 1 || from === `e${home}` && (kingSide || queenSide)
        && rights.has(castleRight) && pieces.get(castleRook) === rook;
    }
  }
  return !possible ? { kind: 'invalid' } : needsPromotion(piece, to)
    ? { kind: 'promotion', from, to } : { kind: 'move', from, to };
}
function correctPromotion(choice: PremoveChoice, move: Premove): boolean {
  return choice.kind === 'promotion' ? move.promotion !== undefined && promotions.includes(move.promotion)
    : choice.kind === 'move' && move.promotion === undefined;
}

function projectedPosition(fen: string, side: GameSide, queue: readonly Premove[]) {
  const pieces = new Map(boardRows(fen, 'white').flat()
    .filter((entry): entry is { square: Square; piece: Piece; dark: boolean } => entry.piece !== null)
    .map(entry => [entry.square, entry.piece]));
  const rights = new Set(fen.split(' ')[2]?.replace('-', '') ?? '');
  for (const move of queue) {
    const choice = speculativeChoice(pieces, side, rights, move.from, move.to);
    if (choice.kind === 'invalid' || !correctPromotion(choice, move)) return { pieces, rights, valid: false };
    const to = choice.to;
    const piece = pieces.get(move.from)!;
    const home = side === 'white' ? '1' : '8';
    // A conditional capture of an original rook cannot grant castling rights
    // to another rook that a later queued move places on the same square.
    if (pieces.get(to) === (side === 'white' ? 'R' : 'r')) {
      if (to === `h${home}`) rights.delete(side === 'white' ? 'K' : 'k');
      if (to === `a${home}`) rights.delete(side === 'white' ? 'Q' : 'q');
    }
    pieces.delete(move.from);
    if (piece.toLowerCase() === 'p' && move.from[1] === (side === 'white' ? '5' : '4')
      && move.from[0] !== to[0] && !pieces.has(to)) {
      const captured = `${to[0]}${move.from[1]}` as Square;
      if (pieces.get(captured) === (side === 'white' ? 'p' : 'P')) pieces.delete(captured);
    }
    // This is a conditional forecast, not a capture applied to the saved game.
    pieces.set(to, move.promotion === undefined ? piece
      : (side === 'white' ? move.promotion.toUpperCase() : move.promotion) as Piece);
    if (piece.toLowerCase() === 'k') {
      rights.delete(side === 'white' ? 'K' : 'k'); rights.delete(side === 'white' ? 'Q' : 'q');
      if (move.from === `e${home}` && (to === `g${home}` || to === `c${home}`)) {
        const kingSide = to[0] === 'g', rookFrom = `${kingSide ? 'h' : 'a'}${home}` as Square;
        const rookTo = `${kingSide ? 'f' : 'd'}${home}` as Square;
        const rook = pieces.get(rookFrom)!; pieces.delete(rookFrom); pieces.set(rookTo, rook);
      }
    }
    if (piece.toLowerCase() === 'r') {
      if (move.from === `h${home}`) rights.delete(side === 'white' ? 'K' : 'k');
      if (move.from === `a${home}`) rights.delete(side === 'white' ? 'Q' : 'q');
    }
  }
  return { pieces, rights, valid: true };
}
export function projectedPieces(fen: string, side: GameSide, queue: readonly Premove[]): Map<Square, Piece> {
  return projectedPosition(fen, side, queue).pieces;
}
export function premoveChoice(fen: string, side: GameSide, queue: readonly Premove[],
  from: Square, target: Square | null): PremoveChoice {
  const projected = projectedPosition(fen, side, queue);
  return projected.valid ? speculativeChoice(projected.pieces, side, projected.rights, from, target) : { kind: 'invalid' };
}

/** Final admission guard shared by click, drag and delayed promotion selection. */
export function appendValidPremove(fen: string, side: GameSide, queue: readonly Premove[], move: Premove): Premove[] | null {
  const choice = premoveChoice(fen, side, queue, move.from, move.to);
  return choice.kind !== 'invalid' && correctPromotion(choice, move)
    ? addPremove(queue, { ...move, to: choice.to }) : null;
}
export function nextPremove(fen: string, side: GameSide, queue: readonly Premove[]): Premove | null {
  const next = queue[0];
  if (!next) return null;
  const checked = boardMove(fen, side, next.from, next.to);
  return correctPromotion(checked, next) && checked.kind !== 'invalid' ? { ...next, to: checked.to } : null;
}
