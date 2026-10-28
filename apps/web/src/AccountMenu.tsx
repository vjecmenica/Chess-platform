import { useEffect, useRef, useState, type FormEvent } from 'react';
import type { AccountState } from '@chess/contracts';

export const accountMessages: Record<string, string> = {
  incorrect_current_password: 'The current password is incorrect.',
  password_confirmation_mismatch: 'The new passwords do not match.',
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

export function GuestSeatLink({ state, guestSeat }: { state: AccountState | null; guestSeat: boolean }) {
  if (!guestSeat || !state?.account || state.guestLinked) return null;
  return <a className="guest-seat-link" href="/account#settings" target="_blank" rel="noopener"
    title="Signing in does not link this guest seat. Link this browser’s guest games in Account Settings to show your username. Opens in a new tab.">
    Playing as Guest · Link games<span className="visually-hidden"> in Account Settings (opens in a new tab)</span></a>;
}

export function AccountMenu({ csrfToken, guestSeat = false }: { csrfToken: string | undefined; guestSeat?: boolean }) {
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
    if (!response.ok) throw new Error(accountMessages[String(data.error)] ?? (response.status === 400
      ? 'Check the username and password requirements.' : 'Could not update your account. Please try again.'));
    return data as T;
  }

  useEffect(() => {
    if (!csrfToken) return;
    let active = true;
    const refresh = () => { void request<AccountState>('').then(value => { if (active) setState(value); })
      .catch(() => { if (active) setState(null); }); };
    refresh();
    window.addEventListener('focus', refresh);
    return () => { active = false; window.removeEventListener('focus', refresh); };
  }, [csrfToken]);

  async function load() {
    setError(null);
    try {
      const value = await request<AccountState>('');
      setState(value);
    } catch (cause) { setError(cause instanceof Error ? cause.message : 'Could not load your account.'); }
  }

  async function act(path: string, body: Record<string, string> | null = null) {
    setError(null); setBusy(true);
    try {
      await request(path, body);
      // Reload clears seat and CSRF state from the previous identity.
      window.location.reload();
    } catch (cause) { setError(cause instanceof Error ? cause.message : 'Could not update your account.'); }
    finally { setBusy(false); }
  }

  return <>
    <GuestSeatLink state={state} guestSeat={guestSeat} />
    {state?.account ? <a className="account-trigger secondary" href="/account">{state.account.username}</a> :
      <button className="account-trigger secondary" disabled={!csrfToken} onClick={() => {
        dialog.current?.showModal(); void load();
      }}>Account</button>}
    <dialog ref={dialog} className="account-dialog" aria-labelledby="account-heading">
      <div className="account-dialog-body">
        <div className="account-title"><h2 id="account-heading">{state?.account ? 'Your account' : mode === 'register' ? 'Register' : 'Log in'}</h2>
          <button type="button" className="secondary" onClick={() => dialog.current?.close()}>Close</button></div>
        {error && <p role="alert" className="error">{error} <button className="secondary" onClick={() => void load()}>Retry</button></p>}
        {!state ? <p>Loading account…</p> : state.account ? <p><a href="/account">Open your account</a></p> : <AccountForm mode={mode} busy={busy} onMode={() => { setMode(mode === 'login' ? 'register' : 'login'); setError(null); }}
          onSubmit={event => { event.preventDefault(); const data = new FormData(event.currentTarget);
            void act(`/${mode}`, { username: String(data.get('username')), password: String(data.get('password')) }); }} />}
      </div>
    </dialog>
  </>;
}
