import { afterEach, expect, it, vi } from 'vitest';

afterEach(() => { vi.unstubAllGlobals(); vi.resetModules(); });

it('shares the initial guest-session request between appearance and page loaders', async () => {
  const session = { csrfToken: 'test-token', guestId: 'test-guest' };
  const fetch = vi.fn().mockResolvedValue({ ok: true, json: async () => session });
  vi.stubGlobal('fetch', fetch);
  const { loadGuestSession } = await import('../src/guest-session-client');
  const [appearance, page] = await Promise.all([loadGuestSession(), loadGuestSession()]);
  expect(fetch).toHaveBeenCalledTimes(1);
  expect(appearance).toBe(page);
  expect(page).toEqual(session);
});

it('allows retry after a failed session request instead of caching the failure', async () => {
  const fetch = vi.fn().mockResolvedValueOnce({ ok: false })
    .mockResolvedValueOnce({ ok: true, json: async () => ({ csrfToken: 'retry-token' }) });
  vi.stubGlobal('fetch', fetch);
  const { loadGuestSession } = await import('../src/guest-session-client');
  await expect(loadGuestSession()).rejects.toThrow('Could not start your session');
  await expect(loadGuestSession()).resolves.toEqual({ csrfToken: 'retry-token' });
  expect(fetch).toHaveBeenCalledTimes(2);
});
