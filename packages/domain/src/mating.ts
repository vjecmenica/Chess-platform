import type { Side } from './position.js';

/** A negative proof, not an evaluation of whether a player can force a win. */
export type MatingPossibility = 'impossible' | 'not_ruled_out';

interface Piece {
  readonly side: Side;
  readonly kind: 'k' | 'q' | 'r' | 'b' | 'n' | 'p';
  readonly square: string;
}

// Sound material proofs only. Unknown fortresses must never become automatic draws.
export function matingPossibility(pieces: readonly Piece[], side: Side): MatingPossibility {
  const nonKings = pieces.filter(piece => piece.kind !== 'k');
  const own = nonKings.filter(piece => piece.side === side);
  if (own.length === 0) return 'impossible';
  const opponent = nonKings.filter(piece => piece.side !== side);
  if (own.length === 1 && own[0]?.kind === 'n' && opponent.every(piece => piece.kind === 'q')) {
    return 'impossible';
  }
  if (own.every(piece => piece.kind === 'b') && !opponent.some(piece => piece.kind === 'p' || piece.kind === 'n')) {
    const colors = new Set(nonKings.filter(piece => piece.kind === 'b').map(piece =>
      (piece.square.charCodeAt(0) - 97 + Number(piece.square[1]) - 1) % 2));
    if (colors.size === 1) return 'impossible';
  }
  return 'not_ruled_out';
}
