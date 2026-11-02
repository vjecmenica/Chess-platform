import { createPositionFromFen } from '@chess/domain';
import type { GameReadResponse } from '@chess/contracts';
import { cursorFen, playAnalysisMove, type AnalysisTree } from './analysis-model';

export interface VariationMove { san: string; uci: string; fen: string }

/** Keep occurrence order: repeated positions do not identify a move within a PV. */
export function engineVariation(fen: string, moves: readonly string[]): VariationMove[] {
  const result: VariationMove[] = [];
  try {
    const position = createPositionFromFen(fen);
    for (const uci of moves.slice(0, 12)) {
      if (!/^[a-h][1-8][a-h][1-8][qrbn]?$/.test(uci)) break;
      const moved = position.submitMove({ side: position.getPosition().sideToMove, from: uci.slice(0, 2), to: uci.slice(2, 4),
        ...(uci[4] ? { promotion: uci[4] as 'q' | 'r' | 'b' | 'n' } : {}) });
      if (!moved.accepted) break;
      result.push({ san: moved.move.san, uci, fen: moved.position.fen });
    }
  } catch { /* Invalid engine output has no navigable continuation. */ }
  return result;
}

/** Apply a clicked prefix atomically; hovering never calls this function. */
export function applyEngineVariation(tree: AnalysisTree, game: GameReadResponse, rootFen: string,
  moves: readonly string[]): AnalysisTree | null {
  if (!moves.length || tree.gameId !== game.id || tree.savedFen !== game.position.fen
    || cursorFen(tree, game) !== rootFen) return null;
  const checked = engineVariation(rootFen, moves);
  if (checked.length !== moves.length) return null;
  let next = tree;
  for (const { uci } of checked) {
    const result = playAnalysisMove(next, game, uci.slice(0, 2), uci.slice(2, 4), uci[4] as 'q' | 'r' | 'b' | 'n' | undefined);
    if (!result.accepted) return null;
    next = result.tree;
  }
  return next;
}
