import { useEffect, useRef, useState } from 'react';
import type { AccountGame, AccountGames, AccountState, GuestSessionResponse } from '@chess/contracts';
import { AccountSettings } from './AccountSettings';
import { accountMessages, AccountMenu } from './AccountMenu';

export function appendGamePage(previous: AccountGames | null, page: AccountGames): AccountGames {
  if (!previous || previous.account.id !== page.account.id) return page;
  const ids = new Set(previous.games.map(game => game.id));
  return { ...page, games: [...previous.games, ...page.games.filter(game => !ids.has(game.id))] };
}

export function archiveResult(game: AccountGame): string {
  if (game.status === 'aborted') return 'Aborted';
  if (game.status === 'finished') {
    if (game.result?.outcome === 'draw') return 'Draw';
    if (game.result?.outcome === 'win' && game.result.winner)
      return game.result.winner === game.side ? 'Win' : 'Loss';
    return 'Finished';
  }
  return game.status === 'pending_adjudication' ? 'Awaiting decision'
    : game.status === 'waiting' ? 'Waiting to start' : 'In progress';
}

export function GameArchive({ page }: { page: AccountGames }) {
  return <>
    <section className="archive-summary" aria-label="Completed linked games">
      <h2>Completed linked games</h2>
      <dl>{(['wins', 'draws', 'losses'] as const).map(key => <div key={key}>
        <dt>{key[0]!.toUpperCase() + key.slice(1)}</dt><dd>{page.summary[key]}</dd>
      </div>)}</dl>
      <p>Game results only, not a rating or performance estimate. Aborted games are excluded.</p>
    </section>
    {page.games.length === 0 ? <p>No linked games yet. Use the account details above to link this browser’s guest games.</p>
      : <table className="archive-table">
        <caption className="visually-hidden">Your linked games, newest first</caption>
        <thead><tr>{['Date', 'Opponent', 'Your color', 'Result / status', 'Time control'].map(label =>
          <th key={label} scope="col">{label}</th>)}</tr></thead>
        <tbody>{page.games.map(game => <tr key={game.id}>
          <td data-label="Date"><time dateTime={game.createdAt}>{new Date(game.createdAt).toLocaleString(undefined,
            { dateStyle: 'medium', timeStyle: 'short' })}</time></td>
          <td data-label="Opponent"><a href={`/challenge/${game.id}`} aria-label={`Open game against ${game.opponent ?? 'Guest'}, playing ${game.side}`}>
            {game.opponent ?? 'Guest'}</a></td>
          <td data-label="Your color">{game.side === 'white' ? 'White' : 'Black'}</td>
          <td data-label="Result / status" title={game.result?.reason.replaceAll('_', ' ')}>{archiveResult(game)}</td>
          <td data-label="Time control">{game.timeControl ?? 'Unavailable'}</td>
        </tr>)}</tbody>
      </table>}
  </>;
}

export function AccountPage() {
  const [details, setDetails] = useState<AccountState | null>(null);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [csrf, setCsrf] = useState<string>();
  const [page, setPage] = useState<AccountGames | null>(null);
  const [signedOut, setSignedOut] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const request = useRef<AbortController | null>(null);

  async function load(before?: string) {
    if (before && request.current) return;
    request.current?.abort();
    const controller = new AbortController(); request.current = controller;
    setLoading(true); setError(null);
    if (!before) { setPage(null); setDetails(null); setSignedOut(false); }
    try {
      const sessionResponse = await fetch('/api/guest-session', { cache: 'no-store', signal: controller.signal });
      if (!sessionResponse.ok) throw new Error();
      const session = await sessionResponse.json() as GuestSessionResponse;
      if (controller.signal.aborted) return;
      setCsrf(session.csrfToken);
      const accountResponse = await fetch('/api/account', { cache: 'no-store', signal: controller.signal });
      if (!accountResponse.ok) throw new Error();
      const state = await accountResponse.json() as AccountState;
      if (controller.signal.aborted) return;
      setDetails(state);
      if (!state.account) { setPage(null); setSignedOut(true); return; }
      const response = await fetch(`/api/account/games${before ? `?before=${encodeURIComponent(before)}` : ''}`,
        { cache: 'no-store', signal: controller.signal });
      if (controller.signal.aborted) return;
      if (response.status === 401) { setPage(null); setSignedOut(true); return; }
      if (!response.ok) throw new Error();
      const next = await response.json() as AccountGames;
      if (!controller.signal.aborted) setPage(previous => before ? appendGamePage(previous, next) : next);
    } catch {
      if (!controller.signal.aborted) setError('Could not load your games. Please try again.');
    } finally {
      if (request.current === controller) { request.current = null; setLoading(false); }
    }
  }

  async function action(path: string, body?: Record<string, string>) {
    if (busy) return;
    setBusy(true); setError(null); setNotice(null);
    request.current?.abort(); request.current = null;
    try {
      const response = await fetch('/api/account' + path, { method: 'POST', cache: 'no-store',
        headers: { 'X-CSRF-Token': csrf ?? '', ...(body ? { 'Content-Type': 'application/json' } : {}) },
        ...(body ? { body: JSON.stringify(body) } : {}) });
      const data = await response.json();
      if (!response.ok) throw new Error(accountMessages[String(data.error)] ?? 'Could not update your account. Check the form and try again.');
      if (path === '/link-guest') { await load(); setNotice('Guest games linked.'); }
      else window.location.reload();
    } catch (cause) { setError(cause instanceof Error ? cause.message : 'Could not update your account.'); }
    finally { setBusy(false); }
  }

  useEffect(() => {
    void load();
    // Revalidate identity and discard the previous account's archive after returning to this tab.
    const refresh = () => { if (!document.querySelector('.account-details:focus-within')) void load(); };
    window.addEventListener('focus', refresh);
    return () => { request.current?.abort(); window.removeEventListener('focus', refresh); };
  }, []);

  return <>
    <header className="analysis-navigation"><div className="analysis-navigation-inner">
      <a className="analysis-brand" href="/" aria-label="Chess Platform home">♞</a>
      <nav aria-label="Main navigation"><a href="/">Play</a><span aria-current="page">Account</span></nav>
      <div className="archive-account"><AccountMenu csrfToken={csrf} /></div>
    </div></header>
    <main className="my-games-page">
      <h1>Account</h1>
      {signedOut && <p>Use the Account button above to log in or register. Account details and linked games are private.</p>}
      {error && <p role="alert" className="error">{error} <button className="secondary"
        onClick={() => void load(page?.next ?? undefined)}>Retry loading</button></p>}
      {notice && <p role="status">{notice}</p>}
      {details?.account && <AccountSettings state={details} busy={busy} onAction={(path, body) => void action(path, body)} />}
      {page && <h2>Linked games</h2>}
      {page && <GameArchive page={page} />}
      {loading && <p role="status">{page ? 'Loading more games…' : 'Loading account and games…'}</p>}
      {page?.next && <button disabled={loading} onClick={() => void load(page.next!)}>Load more</button>}
    </main>
  </>;
}
