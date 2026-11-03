import { useEffect, useRef, useState } from 'react';
import type { GameReadResponse, GameRematchOffer, GameRematchAction, GameRematchResponse } from '@chess/contracts';
import { timeControlLabel } from './TimeControlSelect';
export function ActionIcon({ kind }: {
  kind: 'new' | 'rematch' | 'analysis';
}) { return <svg aria-hidden="true" viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d={kind === 'new' ? 'M12 4v16M4 12h16' : kind === 'rematch' ? 'M4 10a8 8 0 1 1 1 8M4 4v6h6' : 'M4 19V5m0 14h16M7 15l4-5 4 3 5-8'} /></svg>; }
export function GameRematch({ game, csrfToken, revision }: {
  game: GameReadResponse;
  csrfToken: string;
  revision: number;
}) {
  const [offer, setOffer] = useState<GameRematchOffer | null>(null), [error, setError] = useState<string | null>(null), [busy, setBusy] = useState(false);
  const [connectionError, setConnectionError] = useState<string | null>(null);
  const pending = useRef<{
    key: string;
    body: GameRematchAction;
  } | null>(null), posting = useRef(false);
  const mounted = useRef(false);
  const mutation = useRef(0);
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);
  const marker = 'chess.rematch.pending:' + game.id;
  function receive(next: GameRematchOffer | null) {
    setOffer(next);
    if (next?.status === 'pending') {
      try {
        sessionStorage.setItem(marker, next.id);
      }
      catch { }
    }
    if (next?.status === 'accepted' && next.newGameId) {
      let navigate = false;
      try {
        navigate = sessionStorage.getItem(marker) === next.id;
        sessionStorage.removeItem(marker);
      }
      catch { }
      if (navigate)
        window.location.assign('/challenge/' + next.newGameId);
    }
  }
  useEffect(() => {
    let live = true, reading = false;
    const controller = new AbortController();
    const refresh = async () => {
      if (reading || posting.current)
        return;
      reading = true;
      const version = mutation.current;
      try {
          const r = await fetch(`/api/games/${game.id}/rematch`, { cache: 'no-store', signal: AbortSignal.any([controller.signal, AbortSignal.timeout(10000)]) });
          if (!r.ok)
            throw Error();
          const data = await r.json() as GameRematchResponse;
          if (live && version === mutation.current) {
            receive(data.offer);
            setConnectionError(null);
          }
        }
      catch {
        if (live)
          setConnectionError('Rematch could not reconnect. Retrying…');
      }
      finally {
        reading = false;
      }
    };
    void refresh();
    const timer = setInterval(() => void refresh(), 2000);
    window.addEventListener('focus', refresh);
    return () => { live = false; controller.abort(); clearInterval(timer); window.removeEventListener('focus', refresh); };
  }, [game.id, revision]);
  async function act(action: 'offer' | 'accept' | 'decline') {
    if (posting.current)
      return;
    mutation.current++;
    posting.current = true;
    setBusy(true);
    setError(null);
    if (action !== 'offer' && !offer) { posting.current = false; setBusy(false); return; }
    const request = pending.current ?? { key: crypto.randomUUID(), body: { action, ...(action === 'offer' || !offer ? {} : { offerId: offer.id }) } };
    pending.current = request;
    try {
      const r = await fetch(`/api/games/${game.id}/rematch`, { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-CSRF-Token': csrfToken, 'Idempotency-Key': request.key }, body: JSON.stringify(request.body), signal: AbortSignal.timeout(10000) });
      const data = await r.json();
      if (!r.ok) {
        if (r.status < 500)
          pending.current = null;
        throw Error(({ opponent_unavailable: 'The opponent’s guest session is no longer available.', rematch_already_pending: 'A rematch is already pending.', rematch_offer_closed: 'This offer has closed.', not_a_participant: 'Reconnect as a participant.', rematch_rate_limited: 'Please wait before offering another rematch.' } as Record<string, string>)[data.error] ?? 'Rematch could not be updated. Retry.');
      }
      pending.current = null;
      if (mounted.current) receive(data.offer);
    }
    catch (cause) {
      if (mounted.current) setError(cause instanceof Error ? cause.message : 'Rematch could not connect. Retry.');
    }
    finally {
      posting.current = false;
      if (mounted.current) setBusy(false);
    }
  }
  const tc = game.timeControl && 'initialMs' in game.timeControl ? timeControlLabel(game.timeControl.initialMs, game.timeControl.incrementMs) : 'game';
  return <div className="rematch-actions"><button type="button" className="secondary" disabled aria-describedby={'matchmaking-' + game.id}><ActionIcon kind="new" />New {tc}</button><small id={'matchmaking-' + game.id}>Matchmaking coming later</small>
    <button type="button" className="secondary" disabled={busy || offer?.status === 'pending'} onClick={() => void act('offer')}><ActionIcon kind="rematch" />Rematch</button>
    {offer?.status === 'pending' && <span className="rematch-status" role="status">{offer.side === game.yourSeat ? 'Rematch offered. Waiting for opponent (up to two minutes).' : <>Opponent offered a rematch. <button type="button" disabled={busy} onClick={() => void act('accept')}>Accept</button><button type="button" disabled={busy} onClick={() => void act('decline')}>Decline</button></>}</span>}
    {offer && offer.status !== 'pending' && <span className="rematch-status" role="status">Rematch {offer.status}.{offer.newGameId && <a href={'/challenge/' + offer.newGameId}> Open game</a>}</span>}
    {connectionError && <span className="rematch-status" role="status">{connectionError}</span>}
    {error && <span className="error" role="alert">{error} <button type="button" disabled={busy} onClick={() => void act('offer')}>Retry</button></span>}</div>;
}
