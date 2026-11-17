import type { AccountGameFavorite } from '@chess/contracts';

function favoritePath(gameId: string) {
  return `/api/account/games/${encodeURIComponent(gameId)}/favorite`;
}

async function favoriteState(response: Response, gameId: string): Promise<boolean> {
  const data = await response.json() as AccountGameFavorite;
  if (data.gameId !== gameId || typeof data.favorite !== 'boolean') throw new Error();
  return data.favorite;
}

export async function readGameFavorite(gameId: string, owner: string, signal: AbortSignal): Promise<boolean | null> {
  const response = await fetch(favoritePath(gameId), {
    cache: 'no-store', signal, headers: { 'X-Favorite-Owner': owner },
  });
  return response.ok ? favoriteState(response, gameId) : null;
}

export async function saveGameFavorite(gameId: string, owner: string, csrfToken: string, favorite: boolean): Promise<boolean> {
  const failed = () => new Error('Could not update favorite. Try again.');
  const response = await fetch(favoritePath(gameId), {
    method: favorite ? 'PUT' : 'DELETE', cache: 'no-store',
    headers: { 'X-CSRF-Token': csrfToken, 'X-Favorite-Owner': owner },
  }).catch(() => { throw failed(); });
  if ([401, 403, 409].includes(response.status)) throw new Error('Session changed. Refresh and try again.');
  if (!response.ok) throw failed();
  return favoriteState(response, gameId).catch(() => { throw failed(); });
}
