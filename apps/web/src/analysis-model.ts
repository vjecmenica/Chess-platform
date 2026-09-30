import { createPositionFromFen } from '@chess/domain';
import type { MoveResult, Promotion, Side } from '@chess/domain';
import type { GameReadResponse } from '@chess/contracts';
import { replayFen, replayPly } from './board-model';

export type AnalysisCursor = { readonly kind: 'main'; readonly ply: number }
  | { readonly kind: 'branch'; readonly id: number };

export interface VariationNode {
  readonly id: number;
  readonly parent: AnalysisCursor;
  readonly from: string;
  readonly to: string;
  readonly promotion?: Promotion;
  readonly san: string;
  readonly uci: string;
  readonly fen: string;
}

export interface AnalysisTree {
  readonly gameId: string;
  readonly savedFen: string;
  readonly nodes: readonly VariationNode[];
  readonly cursor: AnalysisCursor;
  readonly nextId: number;
}

export function createAnalysisTree(game: GameReadResponse): AnalysisTree {
  if (game.status !== 'finished') throw new Error('Analysis requires a finished game.');
  return { gameId: game.id, savedFen: game.position.fen, nodes: [],
    cursor: { kind: 'main', ply: game.history.length }, nextId: 1 };
}

function node(tree: AnalysisTree, id: number): VariationNode {
  const found = tree.nodes.find(item => item.id === id);
  if (!found) throw new Error('The analysis branch no longer exists.');
  return found;
}

export function cursorFen(tree: AnalysisTree, game: GameReadResponse,
  cursor: AnalysisCursor = tree.cursor): string {
  if (tree.gameId !== game.id || tree.savedFen !== game.position.fen)
    throw new Error('The saved game changed; reload its analysis.');
  return cursor.kind === 'main' ? replayFen(game, replayPly(cursor.ply, game.history.length))
    : node(tree, cursor.id).fen;
}

export function cursorSide(tree: AnalysisTree, game: GameReadResponse): Side {
  return createPositionFromFen(cursorFen(tree, game)).getPosition().sideToMove;
}

export function selectMain(tree: AnalysisTree, game: GameReadResponse, ply: number): AnalysisTree {
  return { ...tree, cursor: { kind: 'main', ply: replayPly(ply, game.history.length) } };
}

export function selectBranch(tree: AnalysisTree, id: number): AnalysisTree {
  node(tree, id);
  return { ...tree, cursor: { kind: 'branch', id } };
}

export function mainAncestorPly(tree: AnalysisTree, cursor = tree.cursor): number {
  let current = cursor;
  while (current.kind === 'branch') current = node(tree, current.id).parent;
  return current.ply;
}

export function previousPosition(tree: AnalysisTree): AnalysisTree {
  const cursor = tree.cursor;
  if (cursor.kind === 'branch') return { ...tree, cursor: node(tree, cursor.id).parent };
  return { ...tree, cursor: { kind: 'main', ply: Math.max(0, cursor.ply - 1) } };
}

export function nextPosition(tree: AnalysisTree, game: GameReadResponse): AnalysisTree {
  const cursor = tree.cursor;
  if (cursor.kind === 'main' && cursor.ply < game.history.length)
    return selectMain(tree, game, cursor.ply + 1);
  const child = tree.nodes.find(item => sameCursor(item.parent, cursor));
  return child ? selectBranch(tree, child.id) : tree;
}

function sameCursor(a: AnalysisCursor, b: AnalysisCursor): boolean {
  return a.kind === b.kind && (a.kind === 'main' && b.kind === 'main'
    ? a.ply === b.ply : a.kind === 'branch' && b.kind === 'branch' && a.id === b.id);
}

export function playAnalysisMove(tree: AnalysisTree, game: GameReadResponse,
  from: string, to: string, promotion?: Promotion):
  | { readonly accepted: true; readonly tree: AnalysisTree }
  | { readonly accepted: false; readonly result: Extract<MoveResult, { accepted: false }> } {
  const position = createPositionFromFen(cursorFen(tree, game));
  const result = position.submitMove({ side: position.getPosition().sideToMove, from, to,
    ...(promotion === undefined ? {} : { promotion }) });
  if (!result.accepted) return { accepted: false, result };
  const cursor = tree.cursor;
  if (cursor.kind === 'main') {
    const savedNext = game.history[cursor.ply];
    if (savedNext?.uci === result.move.uci)
      return { accepted: true, tree: selectMain(tree, game, cursor.ply + 1) };
  }
  const existing = tree.nodes.find(item => sameCursor(item.parent, cursor)
    && item.uci === result.move.uci);
  if (existing) return { accepted: true, tree: selectBranch(tree, existing.id) };
  if (tree.nodes.length >= 500) return { accepted: false, result: {
    accepted: false, reason: 'invalid_input', message: 'This browser analysis has reached its 500-move limit.' } };
  const added: VariationNode = { id: tree.nextId, parent: cursor, from, to,
    ...(promotion === undefined ? {} : { promotion }), san: result.move.san,
    uci: result.move.uci, fen: result.position.fen };
  return { accepted: true, tree: { ...tree, nodes: [...tree.nodes, added],
    cursor: { kind: 'branch', id: added.id }, nextId: added.id + 1 } };
}

export function deleteVariation(tree: AnalysisTree, id: number): AnalysisTree {
  const deletedRoot = node(tree, id);
  const removed = new Set([id]);
  for (const item of tree.nodes) {
    if (item.parent.kind === 'branch' && removed.has(item.parent.id)) removed.add(item.id);
  }
  return { ...tree, nodes: tree.nodes.filter(item => !removed.has(item.id)),
    cursor: tree.cursor.kind === 'branch' && removed.has(tree.cursor.id)
      ? deletedRoot.parent : tree.cursor };
}

export function analysisStorageKey(gameId: string): string {
  return `chess.analysis.v1.${gameId}`;
}

export function serializeAnalysis(tree: AnalysisTree): string {
  return JSON.stringify({ version: 1, gameId: tree.gameId, savedFen: tree.savedFen,
    cursor: tree.cursor, nextId: tree.nextId,
    nodes: tree.nodes.map(({ id, parent, from, to, promotion }) =>
      ({ id, parent, from, to, ...(promotion === undefined ? {} : { promotion }) })) });
}

export function restoreAnalysis(game: GameReadResponse, raw: string): AnalysisTree | null {
  if (raw.length > 100_000 || game.status !== 'finished') return null;
  try {
    const saved: unknown = JSON.parse(raw);
    if (!isRecord(saved) || saved.version !== 1 || saved.gameId !== game.id
      || saved.savedFen !== game.position.fen || !Array.isArray(saved.nodes)
      || saved.nodes.length > 500 || !Number.isSafeInteger(saved.nextId)) return null;
    let tree = createAnalysisTree(game);
    for (const entry of saved.nodes as unknown[]) {
      if (!isRecord(entry) || !Number.isSafeInteger(entry.id)
        || Number(entry.id) < tree.nextId || Number(entry.id) > 1_000_000
        || !validCursor(entry.parent, tree, game)
        || typeof entry.from !== 'string' || typeof entry.to !== 'string'
        || (entry.promotion !== undefined && !['q', 'r', 'b', 'n'].includes(String(entry.promotion))))
        return null;
      const parent = entry.parent as AnalysisCursor;
      const atParent = { ...tree, cursor: parent, nextId: entry.id as number };
      const moved = playAnalysisMove(atParent, game, entry.from, entry.to,
        entry.promotion as Promotion | undefined);
      if (!moved.accepted || moved.tree.nodes.length !== tree.nodes.length + 1) return null;
      tree = moved.tree;
    }
    if (Number(saved.nextId) < tree.nextId || Number(saved.nextId) > 1_000_001
      || !validCursor(saved.cursor, tree, game)) return null;
    return { ...tree, nextId: saved.nextId as number, cursor: saved.cursor as AnalysisCursor };
  } catch { return null; }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function validCursor(value: unknown, tree: AnalysisTree, game: GameReadResponse): boolean {
  if (!isRecord(value)) return false;
  return value.kind === 'main' ? Number.isInteger(value.ply) && Number(value.ply) >= 0
    && Number(value.ply) <= game.history.length
    : value.kind === 'branch' && Number.isInteger(value.id)
      && tree.nodes.some(item => item.id === value.id);
}
