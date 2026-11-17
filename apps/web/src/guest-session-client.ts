import type { GuestSessionResponse } from '@chess/contracts';
let pending: Promise<GuestSessionResponse> | null = null;

export function loadGuestSession(refresh = false): Promise<GuestSessionResponse> {
  if (pending && !refresh) return pending;
  const request = fetch('/api/guest-session', { cache: 'no-store' }).then(async response => {
    if (!response.ok) throw new Error('Could not start your session. Refresh to reconnect.');
    return response.json() as Promise<GuestSessionResponse>;
  }).catch(error => {
    if (pending === request) pending = null;
    throw error;
  });
  return pending = request;
}
