import type { ParsedPgn } from '@chess/domain';
import { renderedBoardSize } from './board-size-preference';

export function siteAnalysisUrl(id: string, ply?: number, size?: number | null): string {
  const board = renderedBoardSize(size);
  return `/challenge/${id}?${new URLSearchParams({ analysis: '1', ...(ply === undefined ? {} : { ply: String(ply) }),
    ...(board === null ? {} : { board: String(board) }) })}`;
}
export function explorerAnalysisUrl(id: string, fen: string, ply?: number): string {
  return `/analysis/explorer/${id}?${new URLSearchParams({ fen, ...(ply === undefined ? {} : { ply: String(ply) }) })}`;
}
export function analysisEntry(url: URL) {
  const plyText = url.searchParams.get('ply');
  const ply = plyText !== null && /^\d{1,4}$/.test(plyText) && Number(plyText) <= 1000 ? Number(plyText) : undefined;
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
