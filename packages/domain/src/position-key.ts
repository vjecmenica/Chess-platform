import { Chess } from 'chess.js';

// Move counters do not identify a position. chess.js emits an en passant target
// only when an actual legal capture exists (including king-safety constraints).
export function normalizedPositionKey(fen: string): string {
  return canonicalPositionKey(new Chess(fen).fen());
}

/** For already validated FENs emitted by the domain position or PGN adapters. */
export function canonicalPositionKey(fen: string): string {
  return fen.split(' ', 4).join(' ');
}
