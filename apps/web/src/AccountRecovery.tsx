import { useEffect, useState, type FormEvent } from 'react';
import { accountMessages } from './AccountMenu';

export type RecoveryMode = 'recover' | 'verify-email' | 'reset-password';
export function RecoveryForm({ mode, busy, onSubmit }: { mode: RecoveryMode; busy: boolean;
  onSubmit: (event: FormEvent<HTMLFormElement>) => void }) {
  return <form onSubmit={onSubmit}>
    {mode === 'recover' ? <><p>Enter your verified recovery address. Accounts without a verified email cannot use password recovery.</p>
      <label htmlFor="reset-email">Email address</label><input id="reset-email" name="email" type="email" required maxLength={254}
        autoComplete="email" disabled={busy} /></> : mode === 'reset-password' ? <>
      <label htmlFor="reset-password">New password</label><input id="reset-password" name="newPassword" type="password" required
        minLength={15} maxLength={128} autoComplete="new-password" disabled={busy} />
      <label htmlFor="reset-confirm">Confirm new password</label><input id="reset-confirm" name="confirmPassword" type="password" required
        minLength={15} maxLength={128} autoComplete="new-password" disabled={busy} />
      <small>15–128 characters. All account sessions will be signed out. Log in afterward with the new password.</small>
    </> : <p>Confirm that this email address may be used to recover your Chess Platform account.</p>}
    <button className="primary" disabled={busy}>{busy ? 'Please wait…' : mode === 'recover' ? 'Send reset link' : mode === 'verify-email' ? 'Verify email' : 'Reset password'}</button>
  </form>;
}

export function RecoveryPage({ mode, token }: { mode: RecoveryMode; token: string }) {
  const [csrf, setCsrf] = useState<string>();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<string | null>(null);
  const validLink = mode === 'recover' || /^[a-f0-9]{64}$/.test(token);
  useEffect(() => {
    let active = true;
    void fetch('/api/guest-session', { cache: 'no-store' }).then(async response => {
      if (!response.ok) throw new Error();
      const session = await response.json(); if (active) setCsrf(session.csrfToken);
    }).catch(() => { if (active) setError('Could not start a secure session. Reload this page to try again.'); });
    return () => { active = false; };
  }, []);
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); if (busy || !csrf) return;
    const body = Object.fromEntries(new FormData(event.currentTarget));
    if (mode !== 'recover') body.token = token;
    setBusy(true); setError(null);
    try {
      const path = mode === 'recover' ? 'password-reset/request' : mode === 'verify-email' ? 'email/verify' : 'password-reset/confirm';
      const response = await fetch(`/api/account/${path}`, { method: 'POST', cache: 'no-store', referrerPolicy: 'no-referrer',
        headers: { 'Content-Type': 'application/json', 'X-CSRF-Token': csrf }, body: JSON.stringify(body) });
      const data = await response.json();
      if (!response.ok) throw new Error(accountMessages[String(data.error)] ?? 'Could not complete this request. Check the form and try again.');
      setDone(data.message);
    } catch (cause) { setError(cause instanceof Error ? cause.message : 'Could not complete this request.'); }
    finally { setBusy(false); }
  }
  return <>
    <header className="analysis-navigation"><div className="analysis-navigation-inner">
      <a className="analysis-brand" href="/" aria-label="Chess Platform home">♞</a><nav aria-label="Main navigation"><a href="/">Play</a><a href="/account">Account</a></nav>
    </div></header>
    <main className="recovery-page"><h1>{mode === 'verify-email' ? 'Verify recovery email' : 'Reset password'}</h1>
      {!validLink ? <p role="alert">This link is missing or invalid. Open the complete link from your email.</p> : done
        ? <p role="status">{done}</p> : <RecoveryForm mode={mode} busy={busy || !csrf} onSubmit={event => void submit(event)} />}
      {error && <p role="alert" className="error">{error}</p>}
      {mode === 'reset-password' && !done && <p><a href="/account/recover">Request a new reset link</a></p>}
      <p><a href="/account#settings">{done && mode === 'reset-password' ? 'Return to Account to log in' : 'Back to Account'}</a></p>
    </main>
  </>;
}
