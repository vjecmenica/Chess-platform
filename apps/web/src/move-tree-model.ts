import type { GameReadResponse } from '@chess/contracts';
import type { AnalysisCursor, AnalysisTree, VariationNode } from './analysis-model';
import { mainAncestorPly } from './analysis-model';

export interface VariationView {
  readonly id: number;
  readonly notation: string;
  readonly selected: boolean;
  readonly onPath: boolean;
  readonly children: readonly VariationView[];
}

export interface SavedMoveView {
  readonly ply: number;
  readonly notation: string;
  readonly selected: boolean;
  readonly onPath: boolean;
  readonly branches: readonly VariationView[];
}

export interface MoveTreeView {
  readonly startSelected: boolean;
  readonly rootBranches: readonly VariationView[];
  readonly savedMoves: readonly SavedMoveView[];
}

export function moveNotation(ply: number, san: string): string {
  return `${Math.ceil(ply / 2)}${ply % 2 === 1 ? '.' : '...'} ${san}`;
}

function key(cursor: AnalysisCursor): string {
  return cursor.kind === 'main' ? `m${cursor.ply}` : `b${cursor.id}`;
}

export function buildMoveTree(game: GameReadResponse, tree: AnalysisTree | null,
  selected: AnalysisCursor): MoveTreeView {
  const children = new Map<string, VariationNode[]>();
  for (const item of tree?.nodes ?? []) {
    const parentKey = key(item.parent);
    const siblings = children.get(parentKey) ?? [];
    siblings.push(item);
    children.set(parentKey, siblings);
  }
  const branchPath = new Set<number>();
  if (tree !== null && selected.kind === 'branch') {
    let current: AnalysisCursor = selected;
    while (current.kind === 'branch') {
      const branchId: number = current.id;
      branchPath.add(branchId);
      const parent: AnalysisCursor | undefined = tree.nodes.find(item => item.id === branchId)?.parent;
      if (parent === undefined) break;
      current = parent;
    }
  }
  const mainPly = tree === null || selected.kind === 'main'
    ? selected.kind === 'main' ? selected.ply : 0
    : mainAncestorPly(tree, selected);

  function variations(parent: AnalysisCursor, parentPly: number): VariationView[] {
    return (children.get(key(parent)) ?? []).map(item => {
      const ply = parentPly + 1;
      return { id: item.id, notation: moveNotation(ply, item.san),
        selected: selected.kind === 'branch' && selected.id === item.id,
        onPath: branchPath.has(item.id),
        children: variations({ kind: 'branch', id: item.id }, ply) };
    });
  }

  return {
    startSelected: selected.kind === 'main' && selected.ply === 0,
    rootBranches: variations({ kind: 'main', ply: 0 }, 0),
    savedMoves: game.history.map(move => ({
      ply: move.ply, notation: moveNotation(move.ply, move.san),
      selected: selected.kind === 'main' && selected.ply === move.ply,
      onPath: move.ply <= mainPly,
      branches: variations({ kind: 'main', ply: move.ply }, move.ply),
    })),
  };
}
