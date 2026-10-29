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
    <div><h3>Guest game access</h3>
      <p>{state.guestLinked ? 'This browser’s guest games are linked.' : 'This browser’s guest games are not linked.'}</p>
      <p>New games created or accepted while signed in belong to your account automatically.</p>
      {!state.guestLinked && <p>Earlier guest games stay separate. Link this browser’s guest games to keep them in your account and show your username on those seats and in their private chat.</p>}
      {!state.guestLinked && <button disabled={busy} onClick={() => onAction('/link-guest')}>Link this browser’s guest games</button>}
      <p><button className="secondary" disabled={busy} onClick={() => onAction('/logout')}>Log out</button></p>
    </div>
    <form onSubmit={event => submit(event, '/email')} className="account-email"><h3>Recovery email</h3>
      {state.email?.verified ? <p>Verified: <strong>{state.email.verified}</strong>. Password recovery is available{state.email.deliveryEnabled ? '.' : ' once email delivery is restored.'}</p>
        : <p>No verified email. If you lose your password, this account cannot be recovered yet.</p>}
      {state.email?.pending && <><p>Pending verification: <strong>{state.email.pending}</strong>. This address cannot recover your password yet.</p>
        <button type="button" className="secondary" disabled={busy || !state.email.deliveryEnabled}
          onClick={() => onAction('/email/resend', {})}>Resend verification</button></>}
      {!state.email?.deliveryEnabled && <p>Email delivery is not configured on this server.</p>}
      <label htmlFor="recovery-email">Email address</label>
      <input id="recovery-email" name="email" type="email" autoComplete="email" required maxLength={254} disabled={busy || !state.email?.deliveryEnabled} />
      <label htmlFor="email-password">Current password</label>
      <input id="email-password" name="currentPassword" type="password" autoComplete="current-password" required maxLength={128} disabled={busy || !state.email?.deliveryEnabled} />
      <small>Changing the address pauses recovery until the new address is verified.</small>
      <button disabled={busy || !state.email?.deliveryEnabled}>Send verification</button>
    </form>
    <form onSubmit={event => submit(event, '/username')}><h3>Change username</h3>
      <label htmlFor="new-username">New username</label>
      <input id="new-username" name="username" required minLength={3} maxLength={24} pattern="[A-Za-z0-9_]{3,24}"
        autoComplete="username" autoCapitalize="none" spellCheck={false} disabled={busy} />
      <small>3–24 letters, numbers, or underscores. Case does not matter.</small>
      <label htmlFor="username-password">Current password</label>
      <input id="username-password" name="currentPassword" type="password" autoComplete="current-password" required maxLength={128} disabled={busy} />
      <button disabled={busy}>Save username</button>
    </form>
    <form onSubmit={event => submit(event, '/password')}><h3>Change password</h3>
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
