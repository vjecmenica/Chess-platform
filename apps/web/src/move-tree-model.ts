import type { GameReadResponse } from '@chess/contracts';
import type { AnalysisCursor, AnalysisTree, MoveNote, VariationNode } from './analysis-model';
import { cursorKey } from './analysis-model';

export interface MoveView {
  readonly cursor: AnalysisCursor;
  readonly ply: number;
  readonly san: string;
  readonly notation: string;
  readonly selected: boolean;
  readonly onPath: boolean;
  readonly note: MoveNote | undefined;
  readonly alternatives: readonly MoveLine[];
}

export interface MoveLine { readonly moves: readonly MoveView[] }
export interface MoveTreeView { readonly startSelected: boolean; readonly main: MoveLine }

export function moveNotation(ply: number, san: string): string {
  return `${Math.ceil(ply / 2)}${ply % 2 === 1 ? '.' : '...'} ${san}`;
}

export function buildMoveTree(game: GameReadResponse, tree: AnalysisTree | null,
  selected: AnalysisCursor): MoveTreeView {
  const branches = new Map<string, VariationNode[]>();
  for (const item of tree?.nodes ?? []) {
    const key = cursorKey(item.parent);
    branches.set(key, [...(branches.get(key) ?? []), item]);
  }
  const path = new Set<string>();
  if (tree !== null && selected.kind === 'branch') {
    let cursor: AnalysisCursor = selected;
    while (cursor.kind === 'branch') {
      const id: number = cursor.id;
      path.add(cursorKey(cursor));
      const parent: AnalysisCursor | undefined = tree.nodes.find(item => item.id === id)?.parent;
      if (!parent) break;
      cursor = parent;
    }
    if (cursor.kind === 'main') for (let ply = 1; ply <= cursor.ply; ply += 1) path.add(`m${ply}`);
  } else if (selected.kind === 'main') {
    for (let ply = 1; ply <= selected.ply; ply += 1) path.add(`m${ply}`);
  }

  function children(parent: AnalysisCursor): AnalysisCursor[] {
    return [
      ...(parent.kind === 'main' && parent.ply < game.history.length
        ? [{ kind: 'main' as const, ply: parent.ply + 1 }] : []),
      ...(branches.get(cursorKey(parent)) ?? []).map(item => ({ kind: 'branch' as const, id: item.id })),
    ];
  }

  function preferred(parent: AnalysisCursor, options: readonly AnalysisCursor[]): AnalysisCursor | undefined {
    const promotedId = tree?.promoted[cursorKey(parent)];
    return options.find(item => item.kind === 'branch' && item.id === promotedId) ?? options[0];
  }

  function line(first: AnalysisCursor, firstPly: number, showFirstAlternatives = true): MoveLine {
    const moves: MoveView[] = [];
    let cursor: AnalysisCursor | undefined = first;
    let ply = firstPly;
    while (cursor) {
      const current = cursor;
      const parent: AnalysisCursor = current.kind === 'main'
        ? { kind: 'main', ply: current.ply - 1 }
        : tree!.nodes.find(item => item.id === current.id)!.parent;
      const siblings = children(parent);
      const san = current.kind === 'main' ? game.history[current.ply - 1]!.san
        : tree!.nodes.find(item => item.id === current.id)!.san;
      moves.push({ cursor: current, ply, san, notation: moveNotation(ply, san),
        note: tree?.notes[cursorKey(current)],
        selected: cursorKey(current) === cursorKey(selected), onPath: path.has(cursorKey(current)),
        alternatives: moves.length === 0 && !showFirstAlternatives ? []
          : siblings.filter(item => cursorKey(item) !== cursorKey(current))
            .map(item => line(item, ply, false)) });
      cursor = preferred(current, children(current));
      ply += 1;
    }
    return { moves };
  }

  const start: AnalysisCursor = { kind: 'main', ply: 0 };
  const first = preferred(start, children(start));
  return { startSelected: cursorKey(start) === cursorKey(selected),
    main: first ? line(first, 1) : { moves: [] } };
}
