import type { FormEvent } from 'react';
import type { AccountState } from '@chess/contracts';

export function AccountSettings({ state, busy, onAction }: { state: AccountState; busy: boolean;
  onAction: (path: string, body?: Record<string, string>) => void }) {
  function submit(event: FormEvent<HTMLFormElement>, path: string) {
    event.preventDefault();
    const body = Object.fromEntries(new FormData(event.currentTarget)) as Record<string, string>;
    onAction(path, body);
  }
  return <section className="account-details" aria-label="Account details and settings">
    <div><h2>{state.account!.username}</h2>
      <p>Joined {state.createdAt ? <time dateTime={state.createdAt}>{new Date(state.createdAt).toLocaleDateString()}</time> : 'Unavailable'}</p>
      <p>{state.guestLinked ? 'This browser’s guest games are linked.' : 'This browser’s guest games are not linked.'}</p>
      {!state.guestLinked && <button disabled={busy} onClick={() => onAction('/link-guest')}>Link this browser’s guest games</button>}
      <p><button className="secondary" disabled={busy} onClick={() => onAction('/logout')}>Log out</button></p>
      <small>Password recovery is not available. Keep your password safe.</small>
    </div>
    <form onSubmit={event => submit(event, '/username')}><h2>Change username</h2>
      <label htmlFor="new-username">New username</label>
      <input id="new-username" name="username" required minLength={3} maxLength={24} pattern="[A-Za-z0-9_]{3,24}"
        autoComplete="username" autoCapitalize="none" spellCheck={false} disabled={busy} />
      <small>3–24 letters, numbers, or underscores. Case does not matter.</small>
      <label htmlFor="username-password">Current password</label>
      <input id="username-password" name="currentPassword" type="password" autoComplete="current-password" required maxLength={128} disabled={busy} />
      <button disabled={busy}>Save username</button>
    </form>
    <form onSubmit={event => submit(event, '/password')}><h2>Change password</h2>
      <label htmlFor="current-password">Current password</label>
      <input id="current-password" name="currentPassword" type="password" autoComplete="current-password" required maxLength={128} disabled={busy} />
      <label htmlFor="new-password">New password</label>
      <input id="new-password" name="newPassword" type="password" autoComplete="new-password" required minLength={15} maxLength={128} disabled={busy} />
      <label htmlFor="confirm-password">Confirm new password</label>
      <input id="confirm-password" name="confirmPassword" type="password" autoComplete="new-password" required minLength={15} maxLength={128} disabled={busy} />
      <small>15–128 characters. Other sessions will be signed out.</small>
      <button disabled={busy}>Save password</button>
    </form>
  </section>;
}
