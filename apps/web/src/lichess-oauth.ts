const clientId = 'vjecmenica-chess-platform'; // Public OAuth client identifier, not a secret.
const pendingKey = 'chess.lichess.pkce.v1';
const tokenKey = 'chess.lichess.session.v1';
export const resumeAnalysisKey = 'chess.lichess.resume-analysis.v1';

interface PendingAuthorization { state: string; verifier: string; redirectUri: string; startedAt: number }
interface SessionToken { accessToken: string; expiresAt: number }

function randomUrlSafe(byteCount: number): string {
  const bytes = crypto.getRandomValues(new Uint8Array(byteCount));
  return Array.from(bytes, byte => byte.toString(16).padStart(2, '0')).join('');
}

function base64Url(bytes: ArrayBuffer): string {
  return btoa(String.fromCharCode(...new Uint8Array(bytes)))
    .replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '');
}

export async function beginLichessConnect(location: Location = window.location,
  storage: Storage = sessionStorage): Promise<string> {
  const verifier = randomUrlSafe(64);
  const state = randomUrlSafe(32);
  const redirectUri = `${location.origin}${location.pathname}`;
  const challenge = base64Url(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(verifier)));
  storage.setItem(pendingKey, JSON.stringify({ state, verifier, redirectUri,
    startedAt: Date.now() } satisfies PendingAuthorization));
  storage.setItem(resumeAnalysisKey, '1');
  const url = new URL('https://lichess.org/oauth');
  url.searchParams.set('response_type', 'code');
  url.searchParams.set('client_id', clientId);
  url.searchParams.set('redirect_uri', redirectUri);
  url.searchParams.set('code_challenge_method', 'S256');
  url.searchParams.set('code_challenge', challenge);
  url.searchParams.set('state', state);
  return url.toString();
}

export function currentLichessToken(storage: Storage = sessionStorage,
  now = Date.now()): string | null {
  try {
    const raw = storage.getItem(tokenKey);
    if (raw === null) return null;
    const value = JSON.parse(raw) as Partial<SessionToken>;
    if (typeof value.accessToken === 'string' && value.accessToken.length > 0
      && typeof value.expiresAt === 'number' && value.expiresAt > now + 60_000)
      return value.accessToken;
  } catch { /* An invalid browser session is treated as disconnected. */ }
  storage.removeItem(tokenKey);
  return null;
}

export function forgetLichessToken(storage: Storage = sessionStorage): void {
  storage.removeItem(tokenKey);
}

let callbackInProgress: Promise<{ connected: boolean; message: string | null }> | null = null;

export function finishLichessConnect(location: Location = window.location,
  storage: Storage = sessionStorage, fetcher: typeof fetch = fetch,
  replaceUrl: (url: string) => void = url => history.replaceState(history.state, '', url)):
  Promise<{ connected: boolean; message: string | null }> {
  if (callbackInProgress !== null) return callbackInProgress;
  const work = finish(location, storage, fetcher, replaceUrl).catch(() => ({ connected: false,
    message: 'Could not complete the Lichess connection.' }));
  callbackInProgress = work;
  void work.finally(() => { if (callbackInProgress === work) callbackInProgress = null; });
  return work;
}

async function finish(location: Location, storage: Storage, fetcher: typeof fetch,
  replaceUrl: (url: string) => void): Promise<{ connected: boolean; message: string | null }> {
  const url = new URL(location.href);
  const code = url.searchParams.get('code');
  const state = url.searchParams.get('state');
  const error = url.searchParams.get('error');
  if (code === null && error === null) return { connected: currentLichessToken(storage) !== null,
    message: null };
  url.searchParams.delete('code');
  url.searchParams.delete('state');
  url.searchParams.delete('error');
  url.searchParams.delete('error_description');
  replaceUrl(`${url.pathname}${url.search}${url.hash}`);
  const raw = storage.getItem(pendingKey);
  storage.removeItem(pendingKey);
  storage.removeItem(resumeAnalysisKey);
  if (error !== null) return { connected: false, message: 'Lichess connection was cancelled or denied.' };
  let pending: PendingAuthorization | null = null;
  try { pending = raw === null ? null : JSON.parse(raw) as PendingAuthorization; } catch { /* No valid request. */ }
  if (!pending || !state || pending.state !== state || pending.redirectUri !== `${location.origin}${location.pathname}`
    || !Number.isFinite(pending.startedAt) || Date.now() - pending.startedAt > 600_000)
    return { connected: false, message: 'Lichess connection expired. Please try again.' };
  try {
    const body = new URLSearchParams({ grant_type: 'authorization_code', code: code!,
      code_verifier: pending.verifier, redirect_uri: pending.redirectUri, client_id: clientId });
    const response = await fetcher('https://lichess.org/api/token', { method: 'POST',
      credentials: 'omit', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body });
    if (!response.ok) return { connected: false,
      message: 'Lichess did not authorize this connection. Please try again.' };
    const token = await response.json() as Record<string, unknown>;
    if (token.token_type !== 'Bearer' || typeof token.access_token !== 'string'
      || !/^[A-Za-z0-9_]+$/.test(token.access_token)
      || typeof token.expires_in !== 'number' || !Number.isFinite(token.expires_in)
      || token.expires_in <= 0)
      return { connected: false, message: 'Lichess returned an invalid authorization response.' };
    storage.setItem(tokenKey, JSON.stringify({ accessToken: token.access_token,
      expiresAt: Date.now() + token.expires_in * 1000 } satisfies SessionToken));
    return { connected: true, message: null };
  } catch {
    return { connected: false, message: 'Could not complete the Lichess connection.' };
  }
}

export async function disconnectLichess(storage: Storage = sessionStorage,
  fetcher: typeof fetch = fetch): Promise<void> {
  const token = currentLichessToken(storage);
  forgetLichessToken(storage);
  if (token === null) return;
  try {
    await fetcher('https://lichess.org/api/token', { method: 'DELETE', credentials: 'omit',
      headers: { Authorization: `Bearer ${token}` } });
  } catch { /* The local connection is removed even if revocation is unavailable. */ }
}
