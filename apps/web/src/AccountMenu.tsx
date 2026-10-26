import { useEffect, useRef, useState, type FormEvent } from 'react';
import type { AccountState } from '@chess/contracts';

const messages: Record<string, string> = {
  invalid_credentials: 'The username or password is incorrect.',
  username_unavailable: 'That username is unavailable.',
  account_rate_limited: 'Too many attempts. Please try again in 15 minutes.',
  invalid_csrf_token: 'Your session changed. Refresh the page and try again.',
  session_changed: 'Your session changed. Refresh the page and try again.',
  guest_session_required: 'Your session expired. Refresh the page and try again.',
  account_required: 'Please log in again.',
  guest_already_linked: 'This guest session is already linked to another account.',
  opposite_seat_linked: 'This account already owns the other seat in one of these games.',
};

export function AccountForm({ mode, busy, onSubmit, onMode }: {
  mode: 'login' | 'register'; busy: boolean;
  onSubmit: (event: FormEvent<HTMLFormElement>) => void; onMode: () => void;
}) {
  return <form onSubmit={onSubmit}>
    <label htmlFor="account-username">Username</label>
    <input id="account-username" name="username" required minLength={3} maxLength={24}
      pattern="[A-Za-z0-9_]{3,24}" autoComplete="username" autoCapitalize="none" spellCheck={false}
      aria-describedby="username-help" disabled={busy} />
    <small id="username-help">3–24 letters, numbers, or underscores. Case does not matter.</small>
    <label htmlFor="account-password">Password</label>
    <input id="account-password" name="password" type="password" required minLength={15} maxLength={128}
      autoComplete={mode === 'register' ? 'new-password' : 'current-password'}
      aria-describedby="password-help" disabled={busy} />
    <small id="password-help">15–128 characters. Password recovery is not available yet.</small>
    <div className="account-actions">
      <button disabled={busy}>{busy ? 'Please wait…' : mode === 'register' ? 'Register' : 'Log in'}</button>
      <button type="button" className="secondary" onClick={onMode} disabled={busy}>
        {mode === 'register' ? 'Use an existing account' : 'Create an account'}</button>
    </div>
  </form>;
}

export function AccountMenu({ csrfToken, showGamesLink = true }: { csrfToken: string | undefined; showGamesLink?: boolean }) {
  const dialog = useRef<HTMLDialogElement | null>(null);
  const [state, setState] = useState<AccountState | null>(null);
  const [mode, setMode] = useState<'login' | 'register'>('login');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function request<T>(path: string, body?: Record<string, string> | null): Promise<T> {
    const response = await fetch(`/api/account${path}`, { cache: 'no-store', ...(body !== undefined ? {
      method: 'POST', headers: { 'X-CSRF-Token': csrfToken ?? '', ...(body ? { 'Content-Type': 'application/json' } : {}) },
      ...(body ? { body: JSON.stringify(body) } : {}),
    } : {}) });
    const data = await response.json();
    if (!response.ok) throw new Error(messages[String(data.error)] ?? (response.status === 400
      ? 'Check the username and password requirements.' : 'Could not update your account. Please try again.'));
    return data as T;
  }

  useEffect(() => {
    if (!csrfToken) return;
    let active = true;
    void request<AccountState>('').then(value => { if (active) setState(value); })
      .catch(() => { /* The dialog offers a visible retry without disrupting guest play. */ });
    return () => { active = false; };
  }, [csrfToken]);

  async function load() {
    setError(null);
    try {
      const value = await request<AccountState>('');
      setState(value);
    } catch (cause) { setError(cause instanceof Error ? cause.message : 'Could not load your account.'); }
  }
  useEffect(() => {
    if (!csrfToken) return;
    try {
      if (sessionStorage.getItem('chess-account-open') === '1') {
        sessionStorage.removeItem('chess-account-open');
        dialog.current?.showModal(); void load();
      }
    } catch { /* Storage is optional; the Account button remains available. */ }
  }, [csrfToken]);

  async function act(path: string, body: Record<string, string> | null = null) {
    setError(null); setBusy(true);
    try {
      await request(path, body);
      if (path === '/link-guest') await load();
      else {
        try { sessionStorage.setItem('chess-account-open', '1'); } catch { /* Optional display preference. */ }
        // Reload closes streams and clears seat/CSRF state from the previous identity.
        window.location.reload();
      }
    } catch (cause) { setError(cause instanceof Error ? cause.message : 'Could not update your account.'); }
    finally { setBusy(false); }
  }

  return <>
    {state?.account && showGamesLink && <a className="my-games-link" href="/my-games">My Games</a>}
    <button className="account-trigger secondary" disabled={!csrfToken} onClick={() => {
      dialog.current?.showModal(); void load();
    }}>{state?.account?.username ?? 'Account'}</button>
    <dialog ref={dialog} className="account-dialog" aria-labelledby="account-heading">
      <div className="account-dialog-body">
        <div className="account-title"><h2 id="account-heading">{state?.account ? 'Your account' : mode === 'register' ? 'Register' : 'Log in'}</h2>
          <button type="button" className="secondary" onClick={() => dialog.current?.close()}>Close</button></div>
        {error && <p role="alert" className="error">{error} <button className="secondary" onClick={() => void load()}>Retry</button></p>}
        {!state ? <p>Loading account…</p> : state.account ? <>
          <p>Signed in as <strong>{state.account.username}</strong></p>
          {state.guestLinked ? <p>This browser’s guest games are linked.</p> : <>
            <p>Link this browser’s guest games to keep their seats and private chat when you sign in elsewhere.</p>
            <button disabled={busy} onClick={() => void act('/link-guest')}>Link this browser’s guest games</button>
          </>}
          <p><button className="secondary" disabled={busy} onClick={() => void act('/logout')}>Log out</button></p>
          <small>No verified email or password recovery is available in this milestone. Keep your password safe.</small>
        </> : <AccountForm mode={mode} busy={busy} onMode={() => { setMode(mode === 'login' ? 'register' : 'login'); setError(null); }}
          onSubmit={event => { event.preventDefault(); const data = new FormData(event.currentTarget);
            void act(`/${mode}`, { username: String(data.get('username')), password: String(data.get('password')) }); }} />}
      </div>
    </dialog>
  </>;
}
