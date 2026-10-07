import { createPositionFromFen } from '@chess/domain';
import type { GameReadResponse } from '@chess/contracts';
import { cursorFen, type AnalysisCursor, type AnalysisTree } from './analysis-model';

export interface MastersPath { readonly rootFen: string; readonly play: readonly string[]; readonly fen: string }
export interface MastersMove { readonly uci: string; readonly san: string; readonly games: number;
  readonly white: number; readonly draws: number; readonly black: number }
export interface MastersData { readonly opening: { readonly eco: string; readonly name: string } | null;
  readonly moves: readonly MastersMove[] }
export type MastersResult = { readonly kind: 'ok'; readonly data: MastersData }
  | { readonly kind: 'error'; readonly message: string } | { readonly kind: 'auth_required' }
  | { readonly kind: 'cancelled' };

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

export function mastersUrl(path: MastersPath): string {
  const url = new URL('https://explorer.lichess.org/masters');
  url.searchParams.set('fen', path.rootFen);
  url.searchParams.set('play', path.play.join(','));
  url.searchParams.set('moves', '12');
  url.searchParams.set('topGames', '0');
  return url.toString();
}

function count(value: unknown): number | null {
  return Number.isSafeInteger(value) && typeof value === 'number' && value >= 0 ? value : null;
}

export function parseMastersResponse(value: unknown, fen: string): MastersData {
  if (typeof value !== 'object' || value === null || !Array.isArray((value as { moves?: unknown }).moves))
    throw new Error('Invalid Masters response.');
  const source = value as { opening?: unknown; moves: unknown[] };
  const opening = source.opening && typeof source.opening === 'object'
    && typeof (source.opening as { eco?: unknown }).eco === 'string'
    && typeof (source.opening as { name?: unknown }).name === 'string'
    ? { eco: (source.opening as { eco: string }).eco,
      name: (source.opening as { name: string }).name } : null;
  const moves: MastersMove[] = [];
  for (const item of source.moves.slice(0, 12)) {
    if (typeof item !== 'object' || item === null) continue;
    const move = item as Record<string, unknown>;
    const white = count(move.white), draws = count(move.draws), black = count(move.black);
    if (typeof move.uci !== 'string' || !/^[a-h][1-8][a-h][1-8][qrbn]?$/.test(move.uci)
      || white === null || draws === null || black === null) continue;
    const position = createPositionFromFen(fen);
    const result = position.submitMove({ side: position.getPosition().sideToMove,
      from: move.uci.slice(0, 2), to: move.uci.slice(2, 4),
      ...(move.uci.length === 5 ? { promotion: move.uci[4] as 'q' | 'r' | 'b' | 'n' } : {}) });
    if (!result.accepted) continue;
    const games = white + draws + black;
    if (games === 0) continue;
    moves.push({ uci: move.uci, san: result.move.san, games, white, draws, black });
  }
  return { opening, moves };
}

export function isBookMove(data: MastersData, uci: string): boolean {
  return data.moves.some(move => move.uci === uci && move.games > 0);
}

// Short-lived memory cache only. Never persist or mirror the Masters data.
export class MastersClient {
  private queue: Promise<void> = Promise.resolve();
  private cache = new Map<string, { data: MastersData; at: number }>();
  private cooldownUntil = 0;
  constructor(private readonly fetcher: typeof fetch = fetch,
    private readonly now: () => number = Date.now) {}

  lookup(path: MastersPath, token: string | null, signal?: AbortSignal): Promise<MastersResult> {
    const task = this.queue.then(() => this.perform(path, token, signal));
    this.queue = task.then(() => undefined, () => undefined);
    return task;
  }

  private async perform(path: MastersPath, token: string | null,
    signal?: AbortSignal): Promise<MastersResult> {
    if (signal?.aborted) return { kind: 'cancelled' };
    if (token === null) return { kind: 'auth_required' };
    const key = mastersUrl(path);
    const cached = this.cache.get(key);
    if (cached && this.now() - cached.at < 300_000) {
      this.cache.delete(key); this.cache.set(key, cached);
      return { kind: 'ok', data: cached.data };
    }
    if (this.now() < this.cooldownUntil)
      return { kind: 'error', message: 'Masters Explorer is rate-limited. Try again in a minute.' };
    const controller = new AbortController();
    let timedOut = false;
    const abort = () => controller.abort();
    signal?.addEventListener('abort', abort, { once: true });
    const timeout = setTimeout(() => { timedOut = true; controller.abort(); }, 5_000);
    try {
      const response = await this.fetcher(key, { signal: controller.signal, credentials: 'omit',
        headers: { Accept: 'application/json', Authorization: `Bearer ${token}` } });
      if (response.status === 401) return { kind: 'auth_required' };
      if (response.status === 403) return { kind: 'error',
        message: 'Lichess denied access to Masters Explorer for this connection.' };
      if (response.status === 429) {
        this.cooldownUntil = this.now() + 60_000;
        return { kind: 'error', message: 'Masters Explorer is rate-limited. Try again in a minute.' };
      }
      if (!response.ok) return { kind: 'error', message: 'Masters Explorer is unavailable.' };
      const data = parseMastersResponse(await response.json(), path.fen);
      if (signal?.aborted) return { kind: 'cancelled' };
      this.cache.set(key, { data, at: this.now() });
      if (this.cache.size > 32) this.cache.delete(this.cache.keys().next().value!);
      return { kind: 'ok', data };
    } catch {
      return signal?.aborted ? { kind: 'cancelled' } : { kind: 'error',
        message: timedOut ? 'Masters Explorer timed out.' : 'Masters Explorer is unavailable.' };
    } finally {
      clearTimeout(timeout);
      signal?.removeEventListener('abort', abort);
    }
  }
}
