import { useEffect, useRef, useState } from 'react';
import type { AccountGame, AccountGames, GuestSessionResponse } from '@chess/contracts';
import { AccountMenu } from './AccountMenu';

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
    {page.games.length === 0 ? <p>No linked games yet. Use your account menu to link this browser’s guest games.</p>
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

export function MyGames() {
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
    if (!before) { setPage(null); setSignedOut(false); }
    try {
      const sessionResponse = await fetch('/api/guest-session', { cache: 'no-store', signal: controller.signal });
      if (!sessionResponse.ok) throw new Error();
      const session = await sessionResponse.json() as GuestSessionResponse;
      if (controller.signal.aborted) return;
      setCsrf(session.csrfToken);
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

  useEffect(() => {
    void load();
    // Revalidate identity and discard the previous account's archive after returning to this tab.
    const refresh = () => { void load(); };
    window.addEventListener('focus', refresh);
    return () => { request.current?.abort(); window.removeEventListener('focus', refresh); };
  }, []);

  return <>
    <header className="analysis-navigation"><div className="analysis-navigation-inner">
      <a className="analysis-brand" href="/" aria-label="Chess Platform home">♞</a>
      <nav aria-label="Main navigation"><a href="/">Play</a><span aria-current="page">My Games</span></nav>
      <div className="archive-account"><AccountMenu csrfToken={csrf} showGamesLink={false} /></div>
    </div></header>
    <main className="my-games-page">
      <h1>My Games</h1><p>Your private linked games, newest first.</p>
      {signedOut && <p>Log in using the Account button to see your games. This archive is private.</p>}
      {page && <GameArchive page={page} />}
      {loading && <p role="status">{page ? 'Loading more games…' : 'Loading your games…'}</p>}
      {error && <p role="alert" className="error">{error} <button className="secondary"
        onClick={() => void load(page?.next ?? undefined)}>Retry</button></p>}
      {page?.next && <button disabled={loading} onClick={() => void load(page.next!)}>Load more</button>}
    </main>
  </>;
}
