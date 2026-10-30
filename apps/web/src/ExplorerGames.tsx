import { useEffect, useRef, useState } from 'react';
import type { ExplorerGamePage } from '@chess/contracts';
import type { ParsedPgn } from '@chess/domain';

export function ExplorerGames({ fen, onOpen }: {
  fen: string; onOpen: (game: ParsedPgn, id: string, ply: number) => void;
}) {
  const onOpenRef = useRef(onOpen); onOpenRef.current = onOpen;
  const [page, setPage] = useState(0);
  const [data, setData] = useState<ExplorerGamePage | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loadingId, setLoadingId] = useState<string | null>(null);
  const [retry, setRetry] = useState(0);
  const [selection, setSelection] = useState<string | null>(null);
  useEffect(() => {
    const controller = new AbortController(); setData(null); setError(null);
    const timeout = setTimeout(() => { setError('Games request timed out.'); controller.abort(); }, 5_000);
    const timer = setTimeout(() => {
      void fetch(`/api/opening-explorer/games?${new URLSearchParams({ fen, page: String(page) })}`,
        { signal: controller.signal, credentials: 'same-origin' }).then(async response => {
        if (!response.ok) throw new Error(response.status === 429 ? 'Too many requests. Try again in a minute.'
          : response.status === 401 ? 'Your session expired. Refresh to reconnect.' : 'Games could not be loaded.');
        const value = await response.json() as ExplorerGamePage;
        if (!controller.signal.aborted) setData(value);
        clearTimeout(timeout);
      }).catch((cause: unknown) => { if (!controller.signal.aborted) setError(cause instanceof Error ? cause.message : 'Games could not be loaded.'); })
        .finally(() => clearTimeout(timeout));
    }, 150);
    return () => { clearTimeout(timeout); clearTimeout(timer); controller.abort(); };
  }, [fen, page, retry]);
  useEffect(() => {
    if (selection === null) return;
    const id = selection, controller = new AbortController(); setLoadingId(id); setError(null);
    const timeout = setTimeout(() => { setError('Game replay request timed out.'); controller.abort(); setLoadingId(null); setSelection(null); }, 5_000);
    void fetch(`/api/opening-explorer/games/${id}?${new URLSearchParams({ fen })}`,
      { signal: controller.signal, credentials: 'same-origin' }).then(async response => {
      if (!response.ok) throw new Error(response.status === 429 ? 'Too many requests. Try again in a minute.' : 'This game could not be opened.');
      const value = await response.json() as { game: ParsedPgn; ply: number };
      if (!controller.signal.aborted) onOpenRef.current(value.game, id, value.ply);
    }).catch((cause: unknown) => { if (!controller.signal.aborted) setError(cause instanceof Error ? cause.message : 'This game could not be opened.'); })
      .finally(() => { clearTimeout(timeout); if (!controller.signal.aborted) { setLoadingId(null); setSelection(null); } });
    return () => { clearTimeout(timeout); controller.abort(); };
  }, [selection, fen]);
  return <section className="explorer-games" aria-label="Games reaching this position">
    {error && <p role="status">{error} <button type="button" onClick={() => setRetry(value => value + 1)}>Retry</button></p>}
    {!data && !error && <p role="status">Loading games…</p>}
    {data && data.games.length === 0 && <p>No games available.</p>}
    <ExplorerGameList data={data} page={page} loadingId={loadingId} onSelect={setSelection} onPage={setPage} />
  </section>;
}

export function ExplorerGameList({ data, page, loadingId, onSelect, onPage }: {
  data: ExplorerGamePage | null; page: number; loadingId: string | null;
  onSelect: (id: string) => void; onPage: (page: number) => void;
}) {
  return <>
    <div className="explorer-game-list">{data?.games.map(game => <button type="button" className="secondary explorer-game"
      key={game.id} disabled={loadingId !== null} aria-busy={loadingId === game.id}
      onClick={() => onSelect(game.id)}>
      <span className="explorer-game-heading">{game.white_name ?? 'Unknown White'}
        {' — '}{game.black_name ?? 'Unknown Black'} · <span className="explorer-game-result">{game.result}</span>
        {' · '}{game.game_date ?? 'Date unavailable'}</span>
      <small>{game.event ?? 'Event unavailable'} · Round {game.round ?? 'unavailable'}
        {game.eco ? ` · ${game.eco}` : ''}</small>
    </button>)}</div>
    {loadingId !== null && <span role="status">Opening game…</span>}
    {data && <div className="explorer-pagination"><button type="button" disabled={page === 0} onClick={() => onPage(page - 1)}>Previous games</button>
      <span>Page {page + 1}</span><button type="button" disabled={!data.hasMore} onClick={() => onPage(page + 1)}>Next games</button></div>}
 </>;
}
