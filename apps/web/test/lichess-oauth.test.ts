import { describe, expect, it, vi } from 'vitest';
import { beginLichessConnect, currentLichessToken, finishLichessConnect,
  forgetLichessToken, resumeAnalysisKey } from '../src/lichess-oauth';

function storage(): Storage {
  const items = new Map<string, string>();
  return { get length() { return items.size; }, clear: () => items.clear(),
    getItem: key => items.get(key) ?? null,
    key: index => [...items.keys()][index] ?? null,
    removeItem: key => { items.delete(key); },
    setItem: (key, value) => { items.set(key, value); } };
}

function locationAt(url: string): Location {
  return new URL(url) as unknown as Location;
}

describe('Lichess public-client OAuth', () => {
  it('uses a random PKCE challenge and never puts the verifier in the URL', async () => {
    const saved = storage();
    const authorization = new URL(await beginLichessConnect(
      locationAt('http://127.0.0.1:5174/challenge/finished'), saved));
    expect(authorization.origin).toBe('https://lichess.org');
    expect(authorization.searchParams.get('code_challenge_method')).toBe('S256');
    expect(authorization.searchParams.get('code_challenge')).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(authorization.searchParams.get('redirect_uri'))
      .toBe('http://127.0.0.1:5174/challenge/finished');
    expect(authorization.href).not.toContain('code_verifier');
    expect(saved.getItem(resumeAnalysisKey)).toBe('1');
  });

  it('checks state and exchanges a code for this browser session only', async () => {
    const saved = storage();
    const authorize = new URL(await beginLichessConnect(
      locationAt('http://127.0.0.1:5174/challenge/finished'), saved));
    const state = authorize.searchParams.get('state');
    const callback = locationAt(`http://127.0.0.1:5174/challenge/finished?code=one-time-code&state=${state}`);
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(new Response(JSON.stringify({
      token_type: 'Bearer', access_token: 'user_token', expires_in: 3600 }), { status: 200 }));
    const replaced: string[] = [];
    expect(await finishLichessConnect(callback, saved, fetcher, url => { replaced.push(url); }))
      .toEqual({ connected: true, message: null });
    expect(replaced).toEqual(['/challenge/finished']);
    expect(fetcher.mock.calls[0]?.[0]).toBe('https://lichess.org/api/token');
    expect(fetcher.mock.calls[0]?.[1]?.method).toBe('POST');
    expect(currentLichessToken(saved)).toBe('user_token');
    expect(saved.getItem(resumeAnalysisKey)).toBeNull();
    forgetLichessToken(saved);
    expect(currentLichessToken(saved)).toBeNull();
  });

  it('rejects a mismatched state without exchanging the code', async () => {
    const saved = storage();
    await beginLichessConnect(locationAt('http://127.0.0.1:5174/challenge/finished'), saved);
    const fetcher = vi.fn<typeof fetch>();
    const result = await finishLichessConnect(locationAt(
      'http://127.0.0.1:5174/challenge/finished?code=code&state=wrong'),
    saved, fetcher, () => {});
    expect(result.connected).toBe(false);
    expect(fetcher).not.toHaveBeenCalled();
    expect(currentLichessToken(saved)).toBeNull();
  });
});
