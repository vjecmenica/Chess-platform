import { createPositionFromFen } from '@chess/domain';
import type { MoveResult, Promotion, Side } from '@chess/domain';
import type { GameReadResponse } from '@chess/contracts';
import { replayFen, replayPly } from './board-model';
import { nagDetails } from './pgn-nags';

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

export interface MoveNote { readonly comment?: string | undefined; readonly nag?: number | undefined }

export interface AnalysisTree {
  readonly gameId: string;
  readonly savedFen: string;
  readonly nodes: readonly VariationNode[];
  readonly cursor: AnalysisCursor;
  readonly nextId: number;
  readonly notes: Readonly<Record<string, MoveNote>>;
  readonly promoted: Readonly<Record<string, number>>;
}

export function createAnalysisTree(game: GameReadResponse,
  sourceNotes: AnalysisTree['notes'] = {}): AnalysisTree {
  if (game.status !== 'finished') throw new Error('Analysis requires a finished game.');
  return { gameId: game.id, savedFen: game.position.fen, nodes: [],
    cursor: { kind: 'main', ply: game.history.length }, nextId: 1, notes: sourceNotes, promoted: {} };
}

export function cursorKey(cursor: AnalysisCursor): string {
  return cursor.kind === 'main' ? `m${cursor.ply}` : `b${cursor.id}`;
}

export function setMoveNote(tree: AnalysisTree, cursor: AnalysisCursor, patch: MoveNote): AnalysisTree {
  if (cursor.kind === 'branch') node(tree, cursor.id);
  if (patch.nag !== undefined && !supportedNag(patch.nag))
    throw new RangeError('Unsupported PGN annotation value.');
  if (patch.comment !== undefined && patch.comment.length > 2000)
    throw new RangeError('Analysis comments must be at most 2000 characters.');
  const key = cursorKey(cursor);
  const previous = tree.notes[key] ?? {};
  const merged = { ...previous, ...patch };
  const next: MoveNote = { ...(merged.comment === undefined ? {} : { comment: merged.comment }),
    ...(merged.nag === undefined ? {} : { nag: merged.nag }) };
  const notes = { ...tree.notes };
  if (next.comment === undefined && next.nag === undefined) delete notes[key];
  else notes[key] = next;
  return { ...tree, notes };
}

export function promoteVariation(tree: AnalysisTree, id: number): AnalysisTree {
  const promoted = { ...tree.promoted };
  let variation = node(tree, id);
  for (;;) {
    promoted[cursorKey(variation.parent)] = variation.id;
    if (variation.parent.kind === 'main') break;
    variation = node(tree, variation.parent.id);
  }
  return { ...tree, promoted };
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
  const preferredId = tree.promoted[cursorKey(cursor)];
  if (preferredId !== undefined && tree.nodes.some(item => item.id === preferredId
    && sameCursor(item.parent, cursor))) return selectBranch(tree, preferredId);
  if (cursor.kind === 'main' && cursor.ply < game.history.length)
    return selectMain(tree, game, cursor.ply + 1);
  const child = tree.nodes.find(item => sameCursor(item.parent, cursor));
  return child ? selectBranch(tree, child.id) : tree;
}

export function lastMainPosition(tree: AnalysisTree, game: GameReadResponse): AnalysisTree {
  let current = selectMain(tree, game, 0);
  for (let step = 0; step <= game.history.length + tree.nodes.length; step += 1) {
    const next = nextPosition(current, game);
    if (next === current) return current;
    current = next;
  }
  throw new Error('The local analysis line contains a cycle.');
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
  const notes = Object.fromEntries(Object.entries(tree.notes)
    .filter(([key]) => !key.startsWith('b') || !removed.has(Number(key.slice(1)))));
  const promoted = Object.fromEntries(Object.entries(tree.promoted)
    .filter(([key, promotedId]) => !removed.has(promotedId)
      && (!key.startsWith('b') || !removed.has(Number(key.slice(1))))));
  return { ...tree, nodes: tree.nodes.filter(item => !removed.has(item.id)), notes, promoted,
    cursor: tree.cursor.kind === 'branch' && removed.has(tree.cursor.id)
      ? deletedRoot.parent : tree.cursor };
}

/** Remove only retired move-tree storage, preserving board preferences and engine caches. */
export function clearStoredAnalysisTrees(storage: Pick<Storage, 'length' | 'key' | 'removeItem'>): void {
  for (let index = storage.length - 1; index >= 0; index -= 1) {
    const key = storage.key(index);
    if (key?.startsWith('chess.analysis.v1.')) storage.removeItem(key);
  }
}

function supportedNag(value: number): boolean {
  return nagDetails(value) !== undefined;
}
