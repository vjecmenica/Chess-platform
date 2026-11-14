import type { GameSide } from '@chess/contracts';
import { publicReplayId } from './public-replays';

export const embedWidth = 416;
export const embedHeight = 520;

export function embedReplayUrl(id: string, orientation: GameSide, ply: number): string | null {
  if (!publicReplayId(id)) return null;
  return `/embed/?${new URLSearchParams({ game: id, side: orientation,
    ...(Number.isInteger(ply) && ply >= 0 && ply <= 1000 ? { ply: String(ply) } : {}) })}`;
}

export function embedUrlForGame(entry: { kind: string; id?: string } | null, gameId: string,
  orientation: GameSide, ply: number): string | null {
  return entry?.kind === 'public' && entry.id !== undefined && gameId === `public-${entry.id}`
    ? embedReplayUrl(entry.id, orientation, ply) : null;
}

export function embedFrame(url: URL): string {
  const { id, orientation, ply } = readEmbedOptions(url);
  const path = embedReplayUrl(id, orientation, ply);
  if (path === null || !['http:', 'https:'].includes(url.protocol) || url.username || url.password || url.pathname !== '/embed/')
    throw new Error('Invalid embed URL.');
  const src = new URL(path, url.origin).href.replaceAll('&', '&amp;').replaceAll('"', '&quot;').replaceAll('<', '&lt;');
  return `<iframe src="${src}" title="Chess game replay" width="${embedWidth}" height="${embedHeight}" loading="lazy" referrerpolicy="no-referrer" sandbox="allow-scripts allow-same-origin" style="border:0;max-width:100%"></iframe>`;
}

export function readEmbedOptions(url: URL) {
  const id = url.searchParams.get('game') ?? '';
  const orientation = url.searchParams.get('side') === 'black' ? 'black' as const : 'white' as const;
  const rawPly = url.searchParams.get('ply') ?? '';
  const ply = /^\d{1,4}$/.test(rawPly) && Number(rawPly) <= 1000 ? Number(rawPly) : 0;
  return { id, orientation, ply };
}
