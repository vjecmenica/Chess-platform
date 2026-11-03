import { useLayoutEffect, useState } from 'react';
import { createBrowserEngineWorker } from './browser-engine-worker';
import { liteEngine } from './engine-builds';
import type { EngineBestMove } from './engine-board';
import { ThreatController, type ThreatState } from './threat-analysis';

export function ThreatControl({ fen, gameId, requestKey, available, reviewing, onMove }: {
  fen: string; gameId: string; requestKey: string; available: boolean; reviewing: boolean;
  onMove?: ((move: EngineBestMove | null) => void) | undefined;
}) {
  const [enabled, setEnabled] = useState(false);
  const [state, setState] = useState<ThreatState>({ kind: 'off' });
  useLayoutEffect(() => {
    onMove?.(null); setState({ kind: 'off' });
    if (!enabled || !available || reviewing) return;
    let cancelled = false;
    const controller = new ThreatController(() => createBrowserEngineWorker(liteEngine.url), next => {
      if (cancelled) return;
      setState(next);
      onMove?.('move' in next ? next.move : null);
    });
    // React development effect cleanup cancels before a duplicate worker is opened.
    queueMicrotask(() => { if (!cancelled) controller.start(fen, gameId); });
    return () => { cancelled = true; controller.dispose(); onMove?.(null); };
  }, [enabled, available, reviewing, fen, gameId, requestKey, onMove]);

  const message = !available ? 'Threat waits for the interactive engine.'
    : reviewing ? 'Threat paused during Computer Analysis.'
      : state.kind === 'unavailable' || state.kind === 'error' ? state.message
        : state.kind === 'done' && !state.move ? 'No legal threat returned by Stockfish 19 Lite.'
          : state.kind === 'loading' || state.kind === 'off' ? 'Loading Threat · Stockfish 19 Lite…'
            : 'Threat · Stockfish 19 Lite';
  return <>
    <button type="button" className="secondary engine-threat-toggle" aria-pressed={enabled}
      aria-label="Threat" aria-description="Opponent's move after a hypothetical pass. Stockfish 19 Lite, one thread, depth 14 or 1.2 seconds. Unavailable in check."
      onClick={() => setEnabled(value => !value)}>Threat</button>
    {enabled && <small className="engine-threat-status" role="status">{message}</small>}
  </>;
}
