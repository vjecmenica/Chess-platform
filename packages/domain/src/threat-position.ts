import { Chess } from 'chess.js';

export type ThreatPosition = { readonly kind: 'ready'; readonly fen: string }
  | { readonly kind: 'unavailable'; readonly reason: 'invalid_position' | 'in_check' | 'no_moves' };

/** A tactical counterfactual, never a recorded/legal pass in the real game. */
export function opponentPassPosition(fen: string): ThreatPosition {
  try {
    const board = new Chess(fen);
    const fields = board.fen().split(' ');
    const kings = board.board().flat().filter(piece => piece?.type === 'k');
    const nonMovingKing = kings.find(piece => piece?.color !== board.turn());
    if (!nonMovingKing || board.isAttacked(nonMovingKing.square, board.turn()))
      return { kind: 'unavailable', reason: 'invalid_position' };
    // Check before changing turns: otherwise the opponent could "capture" this king.
    if (board.isCheck()) return { kind: 'unavailable', reason: 'in_check' };
    for (const [right, king, rook, color] of [
      ['K', 'e1', 'h1', 'w'], ['Q', 'e1', 'a1', 'w'],
      ['k', 'e8', 'h8', 'b'], ['q', 'e8', 'a8', 'b'],
    ] as const) {
      if (fields[2]!.includes(right) && (board.get(king)?.type !== 'k'
        || board.get(king)?.color !== color || board.get(rook)?.type !== 'r'
        || board.get(rook)?.color !== color)) return { kind: 'unavailable', reason: 'invalid_position' };
    }
    if (board.moves().length === 0) return { kind: 'unavailable', reason: 'no_moves' };
    const halfmove = Number(fields[4]) + 1;
    const fullmove = Number(fields[5]) + (board.turn() === 'b' ? 1 : 0);
    if (!Number.isSafeInteger(halfmove) || !Number.isSafeInteger(fullmove))
      return { kind: 'unavailable', reason: 'invalid_position' };
    fields[1] = board.turn() === 'w' ? 'b' : 'w';
    fields[3] = '-'; // An en-passant opportunity expires on the hypothetical pass.
    fields[4] = String(halfmove); fields[5] = String(fullmove);
    const hypothetical = new Chess(fields.join(' '));
    return hypothetical.moves().length === 0 ? { kind: 'unavailable', reason: 'no_moves' }
      : { kind: 'ready', fen: hypothetical.fen() };
  } catch { return { kind: 'unavailable', reason: 'invalid_position' }; }
}
