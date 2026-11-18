import { loadGuestSession } from './guest-session-client';
import { useEffect, useRef, useState } from 'react';
import { avatarUploadMaxBytes, ratingPools, type AccountAvatarResponse, type AccountGame, type AccountGames,
  type AccountGamesFilter, type AccountRatingsResponse, type AccountState } from '@chess/contracts';
import { AccountSettings } from './AccountSettings';
import { accountMessages, AccountMenu } from './AccountMenu';
import { resultDisplay } from './result-display';
import { AnalysisNavigation } from './AnalysisNavigation';
import { ProfileAvatar } from './ProfileAvatar';
import { FavoriteButton } from './FavoriteButton';
import { saveGameFavorite } from './game-favorites';
import { formatRating, SiteRating } from './rating-display';

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

interface ArchiveFavoriteControls {
  pending: ReadonlyMap<string, boolean>;
  onToggle: (game: AccountGame) => void;
}

export function GameArchive({ page, filter = 'all', favorites }: {
  page: AccountGames; filter?: AccountGamesFilter; favorites?: ArchiveFavoriteControls | undefined;
}) {
  return <>
    {page.games.length === 0 ? page.next ? null : <p>{filter === 'favorites' ? 'No favorites yet.'
      : 'No account games yet. Create or accept a game while signed in.'}</p>
      : <div className="archive-games" data-favorite-controls={favorites ? '' : undefined}>
        <div className="archive-columns" aria-hidden="true"><span>Players</span><span>Time control</span>
          <span>Result / status</span><span>Date</span></div>
        <ul aria-label="Your linked games, newest first">{page.games.map(game => {
          const white = game.side === 'white' ? page.account.username : game.opponent ?? 'Guest';
          const black = game.side === 'black' ? page.account.username : game.opponent ?? 'Guest';
          const result = archiveResult(game);
          const rating = game.playerRatings?.players;
          const mode = game.rated ? 'Rated' : 'Casual';
          const nameWithRating = (name: string, side: 'white' | 'black') => rating
            ? `${name}, rating before settlement ${formatRating(rating[side].before)}` : name;
          const pending = favorites?.pending.get(`${page.account.id}:${game.id}`);
          return <li key={game.id}><a className="archive-game" href={`/challenge/${game.id}`} target="_blank" rel="noopener"
            aria-label={`White: ${nameWithRating(white, 'white')}. Black: ${nameWithRating(black, 'black')}. ${mode}. ${result}. Opens in a new tab.`}>
            <span className="archive-players">{([['white', white], ['black', black]] as const).map(([side, name]) =>
              <span className="archive-player" key={side}><span className={`archive-side archive-side-${side}`} aria-hidden="true" />
                <strong className="player-name" title={name}>{name}</strong>
                <span className="archive-rating"><SiteRating value={rating?.[side] ?? null} showChange={false} /></span></span>)}</span>
            <span className="archive-control">{game.timeControl ?? 'Unavailable'}<small>{mode}</small></span>
            <span className="archive-result" title={game.result?.reason.replaceAll('_', ' ')}>{result}</span>
            <time dateTime={game.createdAt}>{new Date(game.createdAt).toLocaleString(undefined,
              { dateStyle: 'medium', timeStyle: 'short' })}</time>
          </a>{favorites && <FavoriteButton favorite={pending ?? game.favorite} pending={pending !== undefined}
            description={`White: ${white}. Black: ${black}.`} onToggle={() => favorites.onToggle(game)} />}</li>;
        })}</ul>
      </div>}
  </>;
}

export function AccountProfileHeader({ state, section }: { state: AccountState; section: AccountSection }) {
  return <div className="account-profile-header">
    <div className="account-profile-identity">
      <ProfileAvatar className="account-avatar" name={state.account!.username} url={state.account!.avatarUrl} />
      <div className="account-profile-name"><p>Private account</p><h1 className="player-name">{state.account!.username}</h1>
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

function AccountRatingSummary({ ratings, games = false }: { ratings?: AccountRatingsResponse['ratings'] | undefined; games?: boolean }) {
  return <section className={`account-ratings${games ? ' account-rating-stats' : ''}`} aria-label="Ratings">
    <h3>Ratings</h3>
    <dl>{ratingPools.map(pool => {
      const value = ratings?.[pool];
      return <div key={pool}><dt>{pool[0]!.toUpperCase() + pool.slice(1)}</dt>
        <dd><SiteRating value={value ?? null} />
          {games && value && <small>{value.ratedGames} rated {value.ratedGames === 1 ? 'game' : 'games'}</small>}</dd></div>;
    })}</dl>
  </section>;
}

export function AccountOverview({ page, ratings, favorites }: {
  page: AccountGames; ratings?: AccountRatingsResponse['ratings'] | undefined; favorites?: ArchiveFavoriteControls | undefined;
}) {
  return <>
    <div className="account-overview-summary"><CompletedGamesSummary summary={page.summary} />
      <AccountRatingSummary ratings={ratings} /></div>
    <div className="section-heading"><h3>Recent linked games</h3><a href="#games">View all games</a></div>
    <GameArchive page={{ ...page, games: page.games.slice(0, 5) }} favorites={favorites} />
  </>;
}

export function AccountStats({ summary, ratings }: {
  summary: AccountGames['summary']; ratings?: AccountRatingsResponse['ratings'] | undefined;
}) {
  const total = summary.wins + summary.draws + summary.losses;
  return <>
    <p><strong>{total}</strong> completed linked {total === 1 ? 'game' : 'games'}.</p>
    <CompletedGamesSummary summary={summary} />
    <AccountRatingSummary ratings={ratings} games />
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
  const [selectedFilter, setSelectedFilter] = useState<AccountGamesFilter>('all');
  const filter = section === 'games' ? selectedFilter : 'all';
  const currentFilter = useRef(filter);
  currentFilter.current = filter;
  const [archive, setArchive] = useState<{ filter: AccountGamesFilter; page: AccountGames } | null>(null);
  const [ratingRead, setRatingRead] = useState<AccountRatingsResponse | null>(null);
  const ratings = ratingRead?.accountId === details?.account?.id ? ratingRead?.ratings : undefined;
  const page = archive?.filter === filter && archive.page.account.id === details?.account?.id ? archive.page : null;
  const [archiveRevision, setArchiveRevision] = useState(0);
  const favoriteRequests = useRef(new Map<string, boolean>());
  const [favoritePending, setFavoritePending] = useState<ReadonlyMap<string, boolean>>(new Map());
  const [favoriteError, setFavoriteError] = useState<{ owner: string; message: string } | null>(null);
  const [signedOut, setSignedOut] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const request = useRef<AbortController | null>(null);
  const changingAvatar = useRef(false);

  async function load(before?: string, refreshSession = false) {
    if (before && request.current) return;
    request.current?.abort();
    const controller = new AbortController(); request.current = controller;
    setLoading(true); setError(null);
    if (!before) setArchive(null);
    try {
      const session = await loadGuestSession(refreshSession);
      if (controller.signal.aborted) return;
      setCsrf(session.csrfToken);
      const accountResponse = await fetch('/api/account', { cache: 'no-store', signal: controller.signal });
      if (controller.signal.aborted) return;
      if (accountResponse.status === 401) { setArchive(null); setRatingRead(null); setDetails(null); setSignedOut(true); return; }
      if (!accountResponse.ok) throw new Error();
      const state = await accountResponse.json() as AccountState;
      if (controller.signal.aborted) return;
      setDetails(state);
      setSignedOut(!state.account);
      if (!state.account) { setArchive(null); setRatingRead(null); return; }
      const query = new URLSearchParams();
      if (before) query.set('before', before);
      if (filter === 'favorites') query.set('filter', filter);
      const options = { cache: 'no-store' as const, signal: controller.signal };
      const [response, ratingResponse] = await Promise.all([
        fetch(`/api/account/games${query.size ? '?' + query : ''}`, options),
        before ? null : fetch('/api/account/ratings', options)
          .then(async response => response.ok ? await response.json() as AccountRatingsResponse : null)
          .catch(() => null),
      ]);
      if (controller.signal.aborted) return;
      if (response.status === 401) { setArchive(null); setRatingRead(null); setDetails(null); setSignedOut(true); return; }
      if (!response.ok) throw new Error();
      const next = await response.json() as AccountGames;
      if (controller.signal.aborted) return;
      if (next.account.id !== state.account.id) throw new Error();
      if (!before) setRatingRead(ratingResponse?.accountId === state.account.id ? ratingResponse : null);
      setArchive(previous => ({ filter, page: before && previous?.filter === filter
        ? appendGamePage(previous.page, next) : next }));
    } catch {
      if (!controller.signal.aborted) setError('Could not load your games. Please try again.');
    } finally {
      if (request.current === controller) { request.current = null; setLoading(false); }
    }
  }

  async function toggleFavorite(game: AccountGame) {
    const owner = page?.account.id;
    if (!owner || !csrf) return;
    const key = `${owner}:${game.id}`;
    if (favoriteRequests.current.has(key)) return;
    favoriteRequests.current.set(key, !game.favorite);
    setFavoritePending(new Map(favoriteRequests.current));
    setFavoriteError(null);
    try {
      const favorite = await saveGameFavorite(game.id, owner, csrf, !game.favorite);
      setArchive(current => {
        if (!current || current.page.account.id !== owner) return current;
        const games = current.filter === 'favorites' && !favorite
          ? current.page.games.filter(item => item.id !== game.id)
          : current.page.games.map(item => item.id === game.id ? { ...item, favorite } : item);
        return { ...current, page: { ...current.page, games } };
      });
      // An overlapping page load may have read the old favorite state.
      if (request.current || favorite && currentFilter.current === 'favorites') {
        request.current?.abort();
        setArchiveRevision(revision => revision + 1);
      }
    } catch (cause) {
      setFavoriteError({ owner, message: cause instanceof Error && cause.message
        ? cause.message : 'Could not update favorite. Try again.' });
    } finally {
      favoriteRequests.current.delete(key);
      setFavoritePending(new Map(favoriteRequests.current));
    }
  }
  const favoriteControls = { pending: favoritePending, onToggle: (game: AccountGame) => void toggleFavorite(game) };

  function selectFilter(next: AccountGamesFilter) {
    if (next === filter) return;
    request.current?.abort();
    setArchive(null);
    setSelectedFilter(next);
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
      if (path.startsWith('/email')) { await load(); setNotice(data.message); }
      else window.location.reload();
    } catch (cause) {
      if (path.startsWith('/email')) await load();
      setError(cause instanceof Error ? cause.message : 'Could not update your account.');
    }
    finally { setBusy(false); }
  }

  async function changeAvatar(image: Blob | null, owner: string) {
    const account = details?.account;
    const sessionError = 'Your session changed. Sign in to the correct account and try again.';
    if (!account || account.id !== owner || !csrf) throw new Error(sessionError);
    if (busy || changingAvatar.current) throw new Error('Please wait for the current account update to finish.');
    if (image && image.size > avatarUploadMaxBytes) throw new Error('The cropped picture exceeds the 2 MB upload limit.');
    changingAvatar.current = true;
    setBusy(true); setNotice(null);
    let restartLoad = request.current !== null;
    request.current?.abort(); request.current = null; setLoading(false);
    try {
      const response = await fetch('/api/account/avatar', { method: image ? 'PUT' : 'DELETE', cache: 'no-store',
        headers: { 'X-CSRF-Token': csrf, 'X-Avatar-Owner': owner,
          ...(image ? { 'Content-Type': 'application/octet-stream' } : {}) }, body: image })
        .catch(() => { throw new Error('Could not reach the server. Check your connection and try again.'); });
      if (!response.ok) {
        const data = await response.json().catch(() => ({})) as { error?: string };
        if (response.status === 413) throw new Error('The cropped picture exceeds the 2 MB upload limit.');
        if (response.status === 429) throw new Error('Too many picture changes. Try again in a few minutes.');
        if (data.error === 'invalid_avatar') throw new Error('The server could not read the picture. Try a different image.');
        if (data.error === 'unsupported_avatar') throw new Error('Use a still JPEG, PNG or WebP image.');
        if (data.error === 'avatar_dimensions') throw new Error('The uploaded image exceeds the server’s 4096 × 4096 pixel limit.');
        if (data.error === 'avatar_storage_unavailable') throw new Error('Picture storage is temporarily unavailable. Try again.');
        if (data.error === 'avatar_busy') throw new Error('Picture processing is busy. Try again shortly.');
        if (response.status === 401 || response.status === 403 || response.status === 409) {
          restartLoad = false;
          await load(undefined, true);
          throw new Error(sessionError);
        }
        throw new Error('The server could not change your profile picture. Try again.');
      }
      const updated = await response.json().catch(() => null) as AccountAvatarResponse | null;
      if (!updated || updated.accountId !== owner) throw new Error('The server could not confirm the picture change. Try again.');
      setDetails(current => {
        if (current?.account?.id !== updated.accountId) return current;
        const { avatarUrl: _previous, ...identity } = current.account;
        return { ...current, account: updated.avatarUrl ? { ...identity, avatarUrl: updated.avatarUrl } : identity };
      });
      setNotice(image ? 'Profile picture updated.' : 'Profile picture removed.');
    } finally {
      changingAvatar.current = false;
      setBusy(false);
      if (restartLoad) void load(undefined, true);
    }
  }

  useEffect(() => {
    void load();
    // Retain the mounted form during revalidation, including while the native file picker returns focus.
    const refresh = () => { if (!changingAvatar.current) void load(undefined, true); };
    window.addEventListener('focus', refresh);
    return () => { request.current?.abort(); window.removeEventListener('focus', refresh); };
  }, [filter, archiveRevision]);

  useEffect(() => {
    const navigate = () => {
      setSection(accountSection(window.location.hash));
    };
    window.addEventListener('hashchange', navigate);
    return () => window.removeEventListener('hashchange', navigate);
  }, []);

  useEffect(() => { sectionHeading.current?.focus({ preventScroll: true }); }, [section]);

  return <>
    <AnalysisNavigation section="account" accountControl={<AccountMenu csrfToken={csrf} current />} />
    <main className="my-games-page">
      {details?.account && !signedOut ? <AccountProfileHeader state={details} section={section} /> : <h1>Account</h1>}
      {signedOut && <p>Use the Account button in the navigation to log in or register. Account details and linked games are private.</p>}
      {error && <p role="alert" className="error">{error} <button className="secondary"
        onClick={() => void load(page?.next ?? undefined)}>Retry loading</button></p>}
      {notice && <p role="status">{notice}</p>}
      {favoriteError && favoriteError.owner === details?.account?.id && <p role="status" className="error">{favoriteError.message}</p>}
      {details?.account && !signedOut && <section className="account-section" aria-labelledby="account-section-heading">
        <h2 id="account-section-heading" tabIndex={-1} ref={sectionHeading}>{section[0]!.toUpperCase() + section.slice(1)}</h2>
        {section === 'overview' && page && <AccountOverview page={page} ratings={ratings} favorites={favoriteControls} />}
        {section === 'games' && <>
          <div className="analysis-view-tabs archive-filters" role="group" aria-label="Filter games">
            <button type="button" aria-pressed={filter === 'all'} onClick={() => selectFilter('all')}>All games</button>
            <button type="button" aria-pressed={filter === 'favorites'} onClick={() => selectFilter('favorites')}>Favorites</button>
          </div>
          {page && <GameArchive page={page} filter={filter} favorites={favoriteControls} />}
          {page?.next && <button disabled={loading} onClick={() => void load(page.next!)}>Load more</button>}</>}
        {section === 'stats' && page && <AccountStats summary={page.summary} ratings={ratings} />}
        {section === 'settings' && <AccountSettings key={details.account.id} state={details} busy={busy}
          onAvatarChange={changeAvatar} onAction={(path, body) => void action(path, body)} />}
      </section>}
      {loading && <p role="status">{page ? 'Loading more games…' : 'Loading account and games…'}</p>}
    </main>
  </>;
}
