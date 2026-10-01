import type { GameReadResponse, GameSide } from '@chess/contracts';
import type { AnalysisCursor, AnalysisTree } from './analysis-model';
import { boardRows } from './board-model';

const values: Readonly<Record<string, number>> = { p: 1, n: 3, b: 3, r: 5, q: 9, k: 0 };

export function materialAdvantage(fen: string): { side: GameSide; points: number } | null {
  let balance = 0;
  for (const { piece } of boardRows(fen, 'white').flat()) {
    if (piece === null) continue;
    const value = values[piece.toLowerCase()] ?? 0;
    balance += piece === piece.toUpperCase() ? value : -value;
  }
  return balance === 0 ? null : { side: balance > 0 ? 'white' : 'black', points: Math.abs(balance) };
}

export function boardCoordinates(side: GameSide): { files: readonly string[]; ranks: readonly string[] } {
  const files = [...'abcdefgh'];
  const ranks = [...'87654321'];
  return side === 'white' ? { files, ranks }
    : { files: files.reverse(), ranks: ranks.reverse() };
}

export function highlightedMove(game: GameReadResponse, displayedPly: number,
  tree: AnalysisTree | null): { from: string; to: string } | null {
  const cursor: AnalysisCursor | null = tree?.cursor ?? null;
  if (cursor?.kind === 'branch') {
    const move = tree?.nodes.find(node => node.id === cursor.id);
    return move ? { from: move.from, to: move.to } : null;
  }
  const ply = cursor?.kind === 'main' ? cursor.ply : displayedPly;
  const move = game.history[ply - 1];
  return move ? { from: move.from, to: move.to } : null;
}
