import { useEffect, useMemo, useRef, useState } from 'react';
import type { GameReadResponse } from '@chess/contracts';
import type { AnalysisTree } from './analysis-model';
import { cursorKey } from './analysis-model';
import { isBookMove, mastersPath, MastersClient, previousMastersPath,
  type MastersResult } from './masters-explorer';
import { beginLichessConnect, currentLichessToken, disconnectLichess,
  finishLichessConnect, forgetLichessToken } from './lichess-oauth';

interface MastersPanelProps {
  readonly game: GameReadResponse;
  readonly tree: AnalysisTree;
  readonly onExplore: (uci: string) => void;
  readonly onBook: (key: string, confirmed: boolean) => void;
}

// Shared within the page so navigation cannot issue overlapping Explorer requests.
const mastersClient = new MastersClient();

function percent(count: number, total: number): string {
  return `${(count * 100 / total).toFixed(1)}%`;
}

export function MastersPanel({ game, tree, onExplore, onBook }: MastersPanelProps) {
  const onBookRef = useRef(onBook);
  onBookRef.current = onBook;
  const path = mastersPath(game, tree);
  const previous = previousMastersPath(game, tree);
  const currentKey = JSON.stringify(path);
  const previousKey = previous === null ? null : JSON.stringify(previous.path);
  const selectedKey = cursorKey(tree.cursor);
  const [retry, setRetry] = useState(0);
  const [result, setResult] = useState<MastersResult | null>(null);
  const [auth, setAuth] = useState(() => ({ token: currentLichessToken(),
    checking: new URL(location.href).searchParams.has('code'), message: null as string | null }));
  const currentPath = useMemo(() => path, [currentKey]);
  const prior = useMemo(() => previous, [previousKey, previous?.uci]);

  useEffect(() => {
    let active = true;
    void finishLichessConnect().then(value => {
      if (active) setAuth({ token: value.connected ? currentLichessToken() : null,
        checking: false, message: value.message });
    });
    return () => { active = false; };
  }, []);

  function requireReconnect() {
    forgetLichessToken();
    setAuth({ token: null, checking: false,
      message: 'Your Lichess connection expired or was revoked. Connect again to use Masters Explorer.' });
  }

  useEffect(() => {
    if (auth.checking || auth.token === null) { setResult(null); return; }
    const controller = new AbortController();
    setResult(null);
    void mastersClient.lookup(currentPath, auth.token, controller.signal).then(value => {
      if (!controller.signal.aborted) {
        if (value.kind === 'auth_required') requireReconnect();
        else setResult(value);
      }
    });
    return () => controller.abort();
  }, [currentPath, retry, auth.token, auth.checking]);

  useEffect(() => {
    if (prior === null || auth.checking || auth.token === null) return;
    const controller = new AbortController();
    void mastersClient.lookup(prior.path, auth.token, controller.signal).then(value => {
      if (!controller.signal.aborted && value.kind === 'auth_required') requireReconnect();
      if (!controller.signal.aborted && value.kind === 'ok')
        onBookRef.current(selectedKey, isBookMove(value.data, prior.uci));
    });
    return () => controller.abort();
  }, [prior, selectedKey, retry, auth.token, auth.checking]);

  const data = auth.token !== null && result?.kind === 'ok' ? result.data : null;
  return <section className="masters-panel" aria-label="Masters opening explorer">
    <div className="masters-heading"><strong>Masters opening explorer</strong>
      {data?.opening && <span>{data.opening.eco} · {data.opening.name}</span>}</div>
    {auth.checking && <p role="status">Connecting with Lichess…</p>}
    {!auth.checking && auth.token === null && <p role="status">{auth.message
      ?? 'Connect your Lichess account to view master-game statistics.'} <button type="button"
        className="secondary" onClick={() => { void beginLichessConnect().then(url =>
          location.assign(url)).catch(() => setAuth({ token: null, checking: false,
            message: 'Could not start the Lichess connection.' })); }}>Connect with Lichess</button></p>}
    {!auth.checking && auth.token !== null && result === null
      && <p role="status">Loading master-game statistics…</p>}
    {auth.token !== null && result?.kind === 'error' && <p role="status">{result.message} <button type="button"
      className="secondary" onClick={() => setRetry(value => value + 1)}>Retry</button></p>}
    {data && (data.moves.length === 0 ? <p>No master games found for this position.</p>
      : <div className="masters-moves" role="list" aria-label="Master-game candidate moves">
        {data.moves.map(move => <div className="masters-move" role="listitem" key={move.uci}>
          <button type="button" onClick={() => onExplore(move.uci)}
            title={`Explore ${move.san} as a local analysis variation`}>{move.san}</button>
          <span>{move.games.toLocaleString()} games</span>
          <span>White {percent(move.white, move.games)}</span>
          <span>Draw {percent(move.draws, move.games)}</span>
          <span>Black {percent(move.black, move.games)}</span>
        </div>)}</div>)}
    <small>Master-game statistics: <a href="https://explorer.lichess.org/masters"
      target="_blank" rel="noreferrer">Lichess Masters Explorer</a>.
      {auth.token !== null && <> <button type="button" className="secondary" onClick={() => {
        setAuth({ token: null, checking: false, message: null });
        void disconnectLichess();
      }}>Disconnect Lichess</button></>}</small>
  </section>;
}
