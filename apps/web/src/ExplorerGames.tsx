import { useContext, useEffect, useState } from 'react';
import type { ExplorerGamePage } from '@chess/contracts';
import { explorerAnalysisUrl } from './analysis-links';
import { OpeningBookVisible } from './AnalysisSidebarTabs';
import { ExplorerRequests, type ExplorerResult } from './explorer-requests';

const requests = new ExplorerRequests<ExplorerGamePage>(64);

export function ExplorerGames({ fen }: { fen: string }) {
  const [page, setPage] = useState(0);
  const [state, setState] = useState<{ url: string; result: ExplorerResult<ExplorerGamePage> } | null>(null);
  const [retry, setRetry] = useState(0);
  const visible = useContext(OpeningBookVisible);
  const url = `/api/opening-explorer/games?${new URLSearchParams({ fen, page: String(page) })}`;
  const data = requests.cached(url) ?? (state?.url === url && state.result.kind === 'ok' ? state.result.data : null);
  const error = !data && state?.url === url && state.result.kind === 'error' ? state.result.message : null;
  useEffect(() => {
    if (!visible || requests.cached(url)) return;
    const controller = new AbortController();
    const timer = setTimeout(() => {
      void requests.lookup(url, controller.signal, signal => fetch(url, { signal, credentials: 'same-origin' }),
        value => value as ExplorerGamePage, 'Example games').then(result => {
        if (!controller.signal.aborted) setState({ url, result });
      });
    }, 150);
    return () => { clearTimeout(timer); controller.abort(); };
  }, [visible, url, retry]);
  return <section className="explorer-games" aria-label="Games reaching this position">
    {error && <p role="status">{error} <button type="button" onClick={() => { setState(null); setRetry(value => value + 1); }}>Retry</button></p>}
    {!data && !error && <p role="status">Loading games…</p>}
    {data && data.games.length === 0 && <p>No games available.</p>}
    <ExplorerGameList data={data} page={page} fen={fen} onPage={setPage} />
  </section>;
}

export function ExplorerGameList({ data, page, fen, onPage }: {
  data: ExplorerGamePage | null; page: number; fen: string;
  onPage: (page: number) => void;
}) {
  return <>
    <div className="explorer-game-list">{data?.games.map(game => <a className="secondary explorer-game"
      key={game.id} href={explorerAnalysisUrl(game.id, fen, game.ply)} target="_blank" rel="noopener noreferrer"
      aria-label={`Open ${game.white_name ?? 'Unknown White'} versus ${game.black_name ?? 'Unknown Black'} in Analysis, new tab`}>
      <span className="explorer-game-heading"><span className="player-name">{game.white_name ?? 'Unknown White'}</span>
        {' — '}<span className="player-name">{game.black_name ?? 'Unknown Black'}</span> · <span className="explorer-game-result">{game.result}</span>
        {' · '}{game.game_date ?? 'Date unavailable'}</span>
      <small>{game.event ?? 'Event unavailable'} · Round {game.round ?? 'unavailable'}
        {game.eco ? ` · ${game.eco}` : ''}</small>
    </a>)}</div>
    {data && <div className="explorer-pagination" aria-label="Example game sample pages">
      <button type="button" aria-label="Previous games" disabled={page === 0} onClick={() => onPage(page - 1)}>‹</button>
      <span>Page {data.totalPages === 0 ? 0 : page + 1}/{data.totalPages}</span>
      <button type="button" aria-label="Next games" disabled={!data.hasMore} onClick={() => onPage(page + 1)}>›</button>
      <small>Up to 50 example games</small></div>}
 </>;
}
