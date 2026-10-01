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

export function createAnalysisTree(game: GameReadResponse): AnalysisTree {
  if (game.status !== 'finished') throw new Error('Analysis requires a finished game.');
  return { gameId: game.id, savedFen: game.position.fen, nodes: [],
    cursor: { kind: 'main', ply: game.history.length }, nextId: 1, notes: {}, promoted: {} };
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

export function analysisStorageKey(gameId: string): string {
  return `chess.analysis.v1.${gameId}`;
}

export function serializeAnalysis(tree: AnalysisTree): string {
  return JSON.stringify({ version: 2, gameId: tree.gameId, savedFen: tree.savedFen,
    cursor: tree.cursor, nextId: tree.nextId, notes: tree.notes, promoted: tree.promoted,
    nodes: tree.nodes.map(({ id, parent, from, to, promotion }) =>
      ({ id, parent, from, to, ...(promotion === undefined ? {} : { promotion }) })) });
}

export function restoreAnalysis(game: GameReadResponse, raw: string): AnalysisTree | null {
  if (raw.length > 100_000 || game.status !== 'finished') return null;
  try {
    const saved: unknown = JSON.parse(raw);
    if (!isRecord(saved) || (saved.version !== 1 && saved.version !== 2) || saved.gameId !== game.id
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
    if (saved.version === 2) {
      if (!isRecord(saved.notes) || !isRecord(saved.promoted)) return null;
      for (const [key, value] of Object.entries(saved.notes)) {
        if (!validMoveKey(key, tree, game) || !isRecord(value)
          || value.comment !== undefined && (typeof value.comment !== 'string' || value.comment.length > 2000)
          || value.nag !== undefined && (!Number.isInteger(value.nag) || !supportedNag(Number(value.nag)))) return null;
      }
      for (const [key, value] of Object.entries(saved.promoted)) {
        const child = tree.nodes.find(item => item.id === value);
        if (!validCursorKey(key, tree, game) || !child || cursorKey(child.parent) !== key) return null;
      }
      tree = { ...tree, notes: saved.notes as Record<string, MoveNote>,
        promoted: saved.promoted as Record<string, number> };
    }
    return { ...tree, nextId: saved.nextId as number, cursor: saved.cursor as AnalysisCursor };
  } catch { return null; }
}

function supportedNag(value: number): boolean {
  return nagDetails(value) !== undefined;
}

function validCursorKey(key: string, tree: AnalysisTree, game: GameReadResponse): boolean {
  if (/^m\d+$/.test(key)) return Number(key.slice(1)) <= game.history.length;
  return /^b\d+$/.test(key) && tree.nodes.some(item => item.id === Number(key.slice(1)));
}

function validMoveKey(key: string, tree: AnalysisTree, game: GameReadResponse): boolean {
  return key !== 'm0' && validCursorKey(key, tree, game);
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
