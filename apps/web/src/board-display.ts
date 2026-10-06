import type { GameReadResponse, GameSide } from '@chess/contracts';
import type { AnalysisCursor, AnalysisTree } from './analysis-model';
import { boardRows } from './board-model';

const values: Readonly<Record<string, number>> = { p: 1, n: 3, b: 3, r: 5, q: 9, k: 0 };
export type CapturedPiece = 'q' | 'r' | 'b' | 'n' | 'p';
const captureOrder: readonly CapturedPiece[] = ['q', 'r', 'b', 'n', 'p'];

function pieceCounts(fen: string, side: GameSide): Record<CapturedPiece, number> {
  const counts = { q: 0, r: 0, b: 0, n: 0, p: 0 };
  for (const { piece } of boardRows(fen, 'white').flat()) {
    if (piece === null || piece.toLowerCase() === 'k'
      || (piece === piece.toUpperCase()) !== (side === 'white')) continue;
    counts[piece.toLowerCase() as CapturedPiece] += 1;
  }
  return counts;
}

export function capturedPieces(game: GameReadResponse, displayedPly: number,
  tree: AnalysisTree | null): Readonly<Record<GameSide, readonly CapturedPiece[]>> {
  const taken = { white: { q: 0, r: 0, b: 0, n: 0, p: 0 },
    black: { q: 0, r: 0, b: 0, n: 0, p: 0 } };
  const branches = [] as AnalysisTree['nodes'][number][];
  let cursor: AnalysisCursor | null = tree?.cursor ?? null;
  while (cursor?.kind === 'branch') {
    const branchId = cursor.id;
    const branch = tree!.nodes.find(node => node.id === branchId);
    if (!branch) throw new Error('The analysis branch no longer exists.');
    branches.unshift(branch);
    cursor = branch.parent;
  }
  const mainPly = Math.min(cursor?.kind === 'main' ? cursor.ply : displayedPly, game.history.length);
  const addCapture = (before: string, after: string, side: GameSide) => {
    const opponent = side === 'white' ? 'black' : 'white';
    const oldPieces = pieceCounts(before, opponent);
    const newPieces = pieceCounts(after, opponent);
    for (const type of captureOrder) taken[side][type] += Math.max(0, oldPieces[type] - newPieces[type]);
  };
  for (const move of game.history.slice(0, mainPly)) addCapture(move.beforeFen, move.afterFen, move.side);
  let before = mainPly === 0 ? game.history[0]?.beforeFen ?? game.position.fen
    : game.history[mainPly - 1]!.afterFen;
  for (const branch of branches) {
    addCapture(before, branch.fen, before.split(' ')[1] === 'w' ? 'white' : 'black');
    before = branch.fen;
  }
  const white: CapturedPiece[] = [], black: CapturedPiece[] = [];
  for (const type of captureOrder) {
    const cancelled = Math.min(taken.white[type], taken.black[type]);
    white.push(...Array<CapturedPiece>(taken.white[type] - cancelled).fill(type));
    black.push(...Array<CapturedPiece>(taken.black[type] - cancelled).fill(type));
  }
  return { white, black };
}

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
