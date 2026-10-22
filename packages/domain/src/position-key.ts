import { Chess } from 'chess.js';

// Move counters do not identify a position. chess.js emits an en passant target
// only when an actual legal capture exists (including king-safety constraints).
export function normalizedPositionKey(fen: string): string {
  return new Chess(fen).fen().split(' ').slice(0, 4).join(' ');
}
