import { parseAnalysisPosition, type ParsedPgn } from '@chess/domain';
import { renderedBoardSize } from './board-size-preference';
import { publicReplayId, publicReplayUrl } from './public-replays';

type ReviewView = { gameId: string; workspace?: 'main' | 'review'; chart?: 'computer' | 'times' };

export function readReviewView<K extends 'workspace' | 'chart'>(gameId: string, field: K): ReviewView[K] | undefined {
  if (typeof window === 'undefined') return undefined;
  const view = window.history.state?.chessReviewView as ReviewView | undefined;
  return view?.gameId === gameId ? view[field] : undefined;
}

export function writeReviewView<K extends 'workspace' | 'chart'>(gameId: string, field: K, value: ReviewView[K]): void {
  const state = window.history.state;
  const previous = state?.chessReviewView as ReviewView | undefined;
  try {
    window.history.replaceState({ ...state, chessReviewView: {
      ...(previous?.gameId === gameId ? previous : {}), gameId, [field]: value,
    } }, '');
  } catch { /* Tab preferences are optional. */ }
}

export function siteAnalysisUrl(id: string, ply?: number, size?: number | null): string {
  const board = renderedBoardSize(size);
  return `/challenge/${id}?${new URLSearchParams({ analysis: '1', ...(ply === undefined ? {} : { ply: String(ply) }),
    ...(board === null ? {} : { board: String(board) }) })}`;
}
export function explorerAnalysisUrl(id: string, fen: string, ply?: number): string {
  return `/analysis/explorer/${id}?${new URLSearchParams({ fen, ...(ply === undefined ? {} : { ply: String(ply) }) })}`;
}
export function positionAnalysisUrl(fen: string): string | null {
  const position = parseAnalysisPosition(fen);
  // A position can come from a private game. Keep the shared FEN out of HTTP requests.
  return position ? `/analysis/position#${new URLSearchParams({ fen: position.fen })}` : null;
}

export function shareableGameUrl(entry: ReturnType<typeof analysisEntry>, gameId: string, ply?: number): string | null {
  const sharePly = ply !== undefined && Number.isInteger(ply) && ply >= 0 && ply <= 1000 ? ply : undefined;
  if (entry?.kind === 'explorer' && gameId === `explorer-${entry.id}`)
    return explorerAnalysisUrl(entry.id, entry.fen, sharePly);
  if (entry?.kind === 'public' && gameId === `public-${entry.id}` && publicReplayId(entry.id))
    return publicReplayUrl(entry.id, sharePly);
  return null;
}

export function analysisEntry(url: URL) {
  const plyText = url.searchParams.get('ply');
  const ply = plyText !== null && /^\d{1,4}$/.test(plyText) && Number(plyText) <= 1000 ? Number(plyText) : undefined;
  if (url.pathname === '/analysis/position') {
    const fragment = new URLSearchParams(url.hash.slice(1));
    const position = parseAnalysisPosition(fragment.get('fen') ?? '');
    return { kind: 'position' as const, position };
  }
  const published = /^\/analysis\/public\/([a-z0-9-]{1,64})$/.exec(url.pathname);
  if (published) return { kind: 'public' as const, id: published[1]!, ply };
  const explorer = /^\/analysis\/explorer\/([1-9][0-9]{0,17})$/.exec(url.pathname);
  if (explorer) return { kind: 'explorer' as const, id: explorer[1]!, fen: url.searchParams.get('fen') ?? '', ply };
  const site = /^\/challenge\/([0-9a-f-]{36})$/.exec(url.pathname);
  const board = renderedBoardSize(Number(url.searchParams.get('board')));
  return site && url.searchParams.get('analysis') === '1' ? { kind: 'site' as const, id: site[1]!, ply,
    ...(board === null ? {} : { boardSize: board }) } : null;
}
export async function loadExplorerAnalysis(id: string, fen: string, signal: AbortSignal): Promise<{ game: ParsedPgn; ply: number }> {
  const response = await fetch(`/api/opening-explorer/games/${id}?${new URLSearchParams({ fen })}`,
    { signal, credentials: 'same-origin', cache: 'no-store' });
  if (!response.ok) throw new Error(response.status === 429 ? 'Too many requests. Try again in a minute.'
    : response.status === 401 ? 'Your session expired. Refresh to reconnect.' : 'This example game could not be opened.');
  return response.json() as Promise<{ game: ParsedPgn; ply: number }>;
}
