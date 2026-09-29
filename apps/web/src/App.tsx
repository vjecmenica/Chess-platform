import { useEffect, useRef, useState } from 'react';
import type { ChallengeSummary, GuestSessionResponse } from '@chess/contracts';

const challengeId = /^\/challenge\/([0-9a-f-]{36})$/.exec(window.location.pathname)?.[1] ?? null;

const errors: Record<string, string> = {
  guest_session_required: 'Your guest session expired. Refresh the page to start a new session.',
  invalid_csrf_token: 'Your guest session changed. Refresh the page and try again.',
  challenge_not_found: 'This challenge link does not exist.',
  not_a_participant: 'This challenge already belongs to two other guests.',
  cannot_accept_own_challenge: 'Open this link in another browser or private window to join as a second guest.',
  seat_taken: 'Another guest has already accepted this challenge.',
};

async function responseBody<T>(response: Response): Promise<T> {
  const body: unknown = await response.json();
  if (!response.ok) {
    const code = typeof body === 'object' && body !== null && 'error' in body ? String(body.error) : '';
    throw new Error(errors[code] ?? `The server returned ${response.status}.`);
  }
  return body as T;
}

export function App() {
  const [session, setSession] = useState<GuestSessionResponse | null>(null);
  const [challenge, setChallenge] = useState<ChallengeSummary | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const createRequestId = useRef<string | null>(null);

  useEffect(() => {
    let active = true;
    async function load() {
      try {
        const guest = await responseBody<GuestSessionResponse>(
          await fetch('/api/guest-session', { cache: 'no-store' }),
        );
        if (!active) return;
        setSession(guest);
        if (challengeId !== null) {
          const found = await responseBody<ChallengeSummary>(
            await fetch(`/api/challenges/${challengeId}`, { cache: 'no-store' }),
          );
          if (active) setChallenge(found);
        }
      } catch (cause) {
        if (active) setError(cause instanceof Error ? cause.message : 'The server is unavailable.');
      }
    }
    void load();
    return () => { active = false; };
  }, []);

  async function createChallenge() {
    if (session === null) return;
    setBusy(true);
    setError(null);
    createRequestId.current ??= crypto.randomUUID();
    try {
      const created = await responseBody<ChallengeSummary>(await fetch('/api/challenges', {
        method: 'POST',
        headers: { 'Idempotency-Key': createRequestId.current, 'X-CSRF-Token': session.csrfToken },
      }));
      window.location.assign(created.path);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Could not create the challenge.');
      setBusy(false);
    }
  }

  async function acceptChallenge() {
    if (session === null || challengeId === null) return;
    setBusy(true);
    setError(null);
    try {
      const accepted = await responseBody<ChallengeSummary>(await fetch(
        `/api/challenges/${challengeId}/accept`,
        { method: 'POST', headers: { 'X-CSRF-Token': session.csrfToken } },
      ));
      setChallenge(accepted);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Could not accept the challenge.');
    } finally {
      setBusy(false);
    }
  }

  const link = challenge ? `${window.location.origin}${challenge.path}` : '';
  return (
    <main>
      <header><span className="mark" aria-hidden="true">♞</span><span>CHESS PLATFORM</span></header>
      <section className="intro">
        <p className="eyebrow">First playable milestone</p>
        <h1>Challenge a friend.</h1>
        <p className="description">Create a casual 5+3 challenge and share its link. This step reserves the two seats; the board and live moves come next.</p>
      </section>
      <section className="notice" aria-labelledby="challenge-title">
        <h2 id="challenge-title">{challengeId === null ? 'Create a challenge' : 'Challenge'}</h2>
        {session === null && error === null && <p role="status">Starting your guest session…</p>}
        {error !== null && <p className="error" role="alert">{error}</p>}
        {challengeId === null && session !== null && (
          <button type="button" disabled={busy} onClick={() => void createChallenge()}>
            {busy ? 'Creating…' : 'Create casual 5+3 challenge'}
          </button>
        )}
        {challenge !== null && <>
          <p className="status">{challenge.status === 'open' ? 'Waiting for a second guest' : 'Both seats are filled'}</p>
          <div className="seats">
            <p>White <strong>{challenge.yourSeat === 'white' ? 'You' : 'Occupied'}</strong></p>
            <p>Black <strong>{challenge.yourSeat === 'black' ? 'You' : challenge.seats.black === 'open' ? 'Open' : 'Occupied'}</strong></p>
          </div>
          <label htmlFor="challenge-link">Shareable link</label>
          <input id="challenge-link" readOnly value={link} onFocus={event => event.currentTarget.select()} />
          {challenge.status === 'open' && challenge.yourSeat === 'white' &&
            <p>Open the link in another browser or private window to use a different guest session.</p>}
          {challenge.status === 'open' && challenge.yourSeat === null &&
            <button type="button" disabled={busy} onClick={() => void acceptChallenge()}>
              {busy ? 'Joining…' : 'Accept challenge as Black'}
            </button>}
          {challenge.status === 'accepted' && <p>Live play is not available yet.</p>}
        </>}
      </section>
      <footer>Play with focus. Learn from every game.</footer>
    </main>
  );
}
