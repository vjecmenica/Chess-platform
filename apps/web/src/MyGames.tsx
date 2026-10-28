import { useEffect, useRef, useState } from 'react';
import type { AccountGame, AccountGames, AccountState, GuestSessionResponse } from '@chess/contracts';
import { AccountSettings } from './AccountSettings';
import { accountMessages, AccountMenu } from './AccountMenu';
import { resultDisplay } from './result-display';

export function appendGamePage(previous: AccountGames | null, page: AccountGames): AccountGames {
  if (!previous || previous.account.id !== page.account.id) return page;
  const ids = new Set(previous.games.map(game => game.id));
  return { ...page, games: [...previous.games, ...page.games.filter(game => !ids.has(game.id))] };
}

export function archiveResult(game: AccountGame): string {
  if (game.status === 'aborted') return 'Aborted';
  if (game.status === 'finished') {
    if (game.result?.outcome === 'draw' || game.result?.outcome === 'win' && game.result.winner)
      return resultDisplay(game.result)!.score;
    return 'Finished';
  }
  return game.status === 'pending_adjudication' ? 'Awaiting decision'
    : game.status === 'waiting' ? 'Waiting to start' : 'In progress';
}

export const accountSections = ['overview', 'games', 'stats', 'settings'] as const;
export type AccountSection = typeof accountSections[number];

export function accountSection(hash: string): AccountSection {
  return accountSections.find(section => hash === `#${section}`) ?? 'overview';
}

export function CompletedGamesSummary({ summary }: { summary: AccountGames['summary'] }) {
  return (
    <section className="archive-summary" aria-label="Completed linked games">
      <h3>Completed linked games</h3>
      <dl>{(['wins', 'draws', 'losses'] as const).map(key => <div key={key}>
        <dt>{key[0]!.toUpperCase() + key.slice(1)}</dt><dd>{summary[key]}</dd>
      </div>)}</dl>
      <p>Game results only, not a rating or performance estimate. Aborted games are excluded.</p>
    </section>
  );
}

export function GameArchive({ page }: { page: AccountGames }) {
  return <>
    {page.games.length === 0 ? <p>No linked games yet. Create or accept a game while signed in, or <a href="#settings">link this browser’s earlier guest games in Settings</a>.</p>
      : <div className="archive-games">
        <div className="archive-columns" aria-hidden="true"><span>Players · rating unavailable</span><span>Time control</span>
          <span>Result / status</span><span>Date</span></div>
        <ul aria-label="Your linked games, newest first">{page.games.map(game => {
          const white = game.side === 'white' ? page.account.username : game.opponent ?? 'Guest';
          const black = game.side === 'black' ? page.account.username : game.opponent ?? 'Guest';
          const result = archiveResult(game);
          return <li key={game.id}><a className="archive-game" href={`/challenge/${game.id}`} target="_blank" rel="noopener"
            aria-label={`White: ${white}. Black: ${black}. ${result}. Opens in a new tab.`}>
            <span className="archive-players">{[['White', white], ['Black', black]].map(([side, name]) =>
              <span className="archive-player" key={side}><span className={`archive-side archive-side-${side!.toLowerCase()}`} aria-hidden="true" />
                <span className="visually-hidden">{side}: </span><strong>{name}</strong>
                <span className="archive-rating" title="Site rating unavailable" aria-label="Site rating unavailable">—</span></span>)}</span>
            <span className="archive-control"><span className="visually-hidden">Time control: </span>{game.timeControl ?? 'Unavailable'}</span>
            <span className="archive-result" title={game.result?.reason.replaceAll('_', ' ')}>{result}</span>
            <time dateTime={game.createdAt}>{new Date(game.createdAt).toLocaleString(undefined,
              { dateStyle: 'medium', timeStyle: 'short' })}</time>
          </a></li>;
        })}</ul>
      </div>}
  </>;
}

export function AccountProfileHeader({ state, section }: { state: AccountState; section: AccountSection }) {
  return <div className="account-profile-header">
    <div className="account-profile-identity">
      <span className="account-avatar" aria-hidden="true">{state.account!.username.slice(0, 2).toUpperCase()}</span>
      <div className="account-profile-name"><p>Private account</p><h1>{state.account!.username}</h1>
        <p>Joined {state.createdAt ? <time dateTime={state.createdAt}>{new Date(state.createdAt).toLocaleDateString(undefined,
          { dateStyle: 'long' })}</time> : 'Unavailable'}</p></div>
      <a className="account-edit" href="#settings">Edit profile</a>
    </div>
    <nav className="account-section-nav" aria-label="Account sections">
      {accountSections.map(item => <a key={item} href={`#${item}`} aria-current={section === item ? 'location' : undefined}>
        {item[0]!.toUpperCase() + item.slice(1)}</a>)}
    </nav>
  </div>;
}

export function AccountOverview({ page }: { page: AccountGames }) {
  return <>
    <div className="account-overview-summary"><CompletedGamesSummary summary={page.summary} />
      <aside className="account-ratings"><h3>Ratings</h3><p>Ratings are not available yet.</p></aside></div>
    <div className="section-heading"><h3>Recent linked games</h3><a href="#games">View all games</a></div>
    <GameArchive page={{ ...page, games: page.games.slice(0, 5) }} />
  </>;
}

export function AccountStats({ summary }: { summary: AccountGames['summary'] }) {
  const total = summary.wins + summary.draws + summary.losses;
  return <>
    <p><strong>{total}</strong> completed linked {total === 1 ? 'game' : 'games'}.</p>
    <CompletedGamesSummary summary={summary} />
    {total === 0 && <p>Your results will appear here after a linked game finishes.</p>}
  </>;
}

export function AccountPage() {
  const [section, setSection] = useState<AccountSection>(() => accountSection(typeof window === 'undefined' ? '' : window.location.hash));
  const sectionHeading = useRef<HTMLHeadingElement>(null);
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
      if (response.status === 401) { setPage(null); setDetails(null); setSignedOut(true); return; }
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

  useEffect(() => {
    const navigate = () => {
      setSection(accountSection(window.location.hash));
    };
    window.addEventListener('hashchange', navigate);
    return () => window.removeEventListener('hashchange', navigate);
  }, []);

  useEffect(() => { sectionHeading.current?.focus({ preventScroll: true }); }, [section]);

  return <>
    <header className="analysis-navigation"><div className="analysis-navigation-inner">
      <a className="analysis-brand" href="/" aria-label="Chess Platform home">♞</a>
      <nav aria-label="Main navigation"><a href="/">Play</a><span aria-current="page">Account</span></nav>
      <div className="archive-account"><AccountMenu csrfToken={csrf} /></div>
    </div></header>
    <main className="my-games-page">
      {details?.account && !signedOut ? <AccountProfileHeader state={details} section={section} /> : <h1>Account</h1>}
      {signedOut && <p>Use the Account button above to log in or register. Account details and linked games are private.</p>}
      {error && <p role="alert" className="error">{error} <button className="secondary"
        onClick={() => void load(page?.next ?? undefined)}>Retry loading</button></p>}
      {notice && <p role="status">{notice}</p>}
      {details?.account && !signedOut && <section className="account-section" aria-labelledby="account-section-heading">
        <h2 id="account-section-heading" tabIndex={-1} ref={sectionHeading}>{section[0]!.toUpperCase() + section.slice(1)}</h2>
        {section === 'overview' && page && <AccountOverview page={page} />}
        {section === 'games' && page && <><GameArchive page={page} />
          {page.next && <button disabled={loading} onClick={() => void load(page.next!)}>Load more</button>}</>}
        {section === 'stats' && page && <AccountStats summary={page.summary} />}
        {section === 'settings' && <AccountSettings state={details} busy={busy} onAction={(path, body) => void action(path, body)} />}
      </section>}
      {loading && <p role="status">{page ? 'Loading more games…' : 'Loading account and games…'}</p>}
    </main>
  </>;
}
