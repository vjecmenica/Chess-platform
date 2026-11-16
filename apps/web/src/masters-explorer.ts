import { legalMoveNotations, normalizedPositionKey } from '@chess/domain';
import type { GameReadResponse } from '@chess/contracts';
import { cursorFen, type AnalysisCursor, type AnalysisTree } from './analysis-model';
import { ExplorerRequests, type ExplorerResult } from './explorer-requests';

export interface MastersPath { readonly rootFen: string; readonly play: readonly string[]; readonly fen: string }
export interface MastersMove { readonly uci: string; readonly san: string; readonly games: number;
  readonly white: number; readonly draws: number; readonly black: number }
export interface MastersData { readonly opening: { readonly eco: string; readonly name: string } | null;
  readonly moves: readonly MastersMove[] }
export type MastersResult = ExplorerResult<MastersData>;

export function mastersPath(game: GameReadResponse, tree: AnalysisTree,
  cursor: AnalysisCursor = tree.cursor): MastersPath {
  const rootFen = game.history[0]?.beforeFen ?? game.position.fen;
  const play = cursor.kind === 'main' ? game.history.slice(0, cursor.ply).map(move => move.uci)
    : branchPath(tree, game, cursor.id);
  return { rootFen, play, fen: cursorFen(tree, game, cursor) };
}

function branchPath(tree: AnalysisTree, game: GameReadResponse, id: number): string[] {
  const node = tree.nodes.find(item => item.id === id);
  if (!node) throw new Error('The analysis branch no longer exists.');
  return [...(node.parent.kind === 'main'
    ? game.history.slice(0, node.parent.ply).map(move => move.uci)
    : branchPath(tree, game, node.parent.id)), node.uci];
}

export function previousMastersPath(game: GameReadResponse, tree: AnalysisTree):
  { readonly path: MastersPath; readonly uci: string } | null {
  const cursor = tree.cursor;
  if (cursor.kind === 'main') {
    if (cursor.ply === 0) return null;
    return { path: mastersPath(game, tree, { kind: 'main', ply: cursor.ply - 1 }),
      uci: game.history[cursor.ply - 1]!.uci };
  }
  const node = tree.nodes.find(item => item.id === cursor.id);
  return node ? { path: mastersPath(game, tree, node.parent), uci: node.uci } : null;
}

export function mastersQuery(fen: string): { fen: string; url: string } {
  const normalized = `${normalizedPositionKey(fen)} 0 1`;
  return { fen: normalized, url: '/api/opening-explorer?' + new URLSearchParams({ fen: normalized }) };
}

export function mastersUrl(path: MastersPath): string {
  return mastersQuery(path.fen).url;
}

function count(value: unknown): number | null {
  return Number.isSafeInteger(value) && typeof value === 'number' && value >= 0 ? value : null;
}

export function parseMastersResponse(value: unknown, fen: string): MastersData {
  if (typeof value !== 'object' || value === null || !Array.isArray((value as { moves?: unknown }).moves))
    throw new Error('Invalid opening explorer response.');
  const source = value as { opening?: unknown; moves: unknown[] };
  const opening = source.opening && typeof source.opening === 'object'
    && typeof (source.opening as { eco?: unknown }).eco === 'string'
    && typeof (source.opening as { name?: unknown }).name === 'string'
    ? { eco: (source.opening as { eco: string }).eco,
      name: (source.opening as { name: string }).name } : null;
  const moves: MastersMove[] = [];
  const notation = source.moves.length > 0 ? legalMoveNotations(fen) : null;
  for (const item of source.moves.slice(0, 218)) {
    if (typeof item !== 'object' || item === null) continue;
    const move = item as Record<string, unknown>;
    const white = count(move.white), draws = count(move.draws), black = count(move.black);
    if (typeof move.uci !== 'string' || !/^[a-h][1-8][a-h][1-8][qrbn]?$/.test(move.uci)
      || white === null || draws === null || black === null) continue;
    const san = notation?.get(move.uci);
    if (!san) continue;
    const games = white + draws + black;
    if (games === 0) continue;
    moves.push({ uci: move.uci, san, games, white, draws, black });
  }
  return { opening, moves };
}

export function isBookMove(data: MastersData, uci: string): boolean {
  return data.moves.some(move => move.uci === uci && move.games > 0);
}

// Bounded, short-lived aggregate responses; replay samples use a separate bounded route.
export class MastersClient {
  private requests: ExplorerRequests<MastersData>;
  constructor(private readonly fetcher: typeof fetch = (input, init) => fetch(input, init),
    now: () => number = Date.now) {
    this.requests = new ExplorerRequests(128, now);
  }

  cached(key: string): MastersData | undefined {
    return this.requests.cached(key);
  }

  lookup(path: MastersPath, signal?: AbortSignal): Promise<MastersResult> {
    return this.lookupQuery(mastersQuery(path.fen), signal);
  }

  lookupQuery({ fen, url }: ReturnType<typeof mastersQuery>, signal?: AbortSignal): Promise<MastersResult> {
    return this.requests.lookup(url, signal, requestSignal => this.fetcher(url, {
      signal: requestSignal, credentials: 'same-origin', headers: { Accept: 'application/json' },
    }), value => parseMastersResponse(value, fen), 'Opening explorer');
  }
}

/** Share of candidate support, including every returned candidate, not just visible rows. */
export function playedPercentage(moves: readonly MastersMove[], games: number): number {
  const total = moves.reduce((sum, move) => sum + move.games, 0);
  return total > 0 ? games * 100 / total : 0;
}
