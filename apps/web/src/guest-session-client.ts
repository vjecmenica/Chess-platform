import type { GuestSessionResponse } from '@chess/contracts';
let pending: Promise<GuestSessionResponse> | null = null;
export function loadGuestSession(): Promise<GuestSessionResponse> { pending ??= fetch('/api/guest-session', { cache: 'no-store' }).then(async (r) => { if (!r.ok)
    throw Error('Could not start your session. Refresh to reconnect.'); return r.json() as Promise<GuestSessionResponse>; }).catch(error => { pending = null; throw error; }); return pending; }
