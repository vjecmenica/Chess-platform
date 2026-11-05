import { useLayoutEffect, useRef, useState } from 'react';
import { createBrowserEngineWorker } from './browser-engine-worker';
import { engineDescription, liteEngine, type EngineVariant } from './engine-builds';
import type { EngineBestMove } from './engine-board';
import { ThreatController, type ThreatState } from './threat-analysis';
import { browserThreatDevice, threatEnginePlan } from './threat-engine';

export function ThreatControl({ fen, gameId, requestKey, available, reviewing, selected, onMove }: {
  fen: string; gameId: string; requestKey: string; available: boolean; reviewing: boolean;
  selected: EngineVariant;
  onMove?: ((move: EngineBestMove | null) => void) | undefined;
}) {
  const [enabled, setEnabled] = useState(false);
  const [state, setState] = useState<ThreatState>({ kind: 'off' });
  const [device] = useState(browserThreatDevice);
  const [failed, setFailed] = useState<string | null>(null);
  const controller = useRef<ThreatController | null>(null);
  const plan = threatEnginePlan(selected, device, failed);
  const engine = plan.engine;

  useLayoutEffect(() => {
    onMove?.(null); setState({ kind: 'off' });
    if (!enabled || !available || reviewing) return;
    let cancelled = false;
    const current = new ThreatController(() => createBrowserEngineWorker(engine.url), next => {
      if (cancelled) return;
      setState(next);
      onMove?.('move' in next ? next.move : null);
      if (next.kind === 'error' && engine.id !== liteEngine.id) setFailed(engine.id);
    }, engine);
    controller.current = current;
    return () => {
      cancelled = true; controller.current = null; current.dispose(); onMove?.(null);
    };
  }, [enabled, available, reviewing, requestKey, engine.id, onMove]);

  useLayoutEffect(() => {
    onMove?.(null);
    const current = controller.current;
    if (!current) return;
    setState({ kind: 'loading', move: null });
    let cancelled = false;
    // StrictMode's provisional effect must not open a second runtime. On navigation,
    // reuse this worker and the controller's stop/ready barrier instead of reloading Full.
    queueMicrotask(() => { if (!cancelled) current.start(fen, gameId); });
    return () => { cancelled = true; onMove?.(null); };
  }, [fen, gameId, enabled, available, reviewing, requestKey, engine.id, onMove]);

  const label = engineDescription(engine, 1);
  const message = !available ? 'Threat waits for the interactive engine.'
    : reviewing ? 'Threat paused during Computer Analysis.'
      : state.kind === 'unavailable' || state.kind === 'error' ? state.message
        : state.kind === 'done' && !state.move ? `No legal threat returned by ${label}.`
          : state.kind === 'loading' || state.kind === 'off' ? `Loading Threat · ${label}…`
            : `Threat · ${label}`;
  return <>
    <button type="button" className="engine-threat-toggle" aria-pressed={enabled}
      aria-label="Show threat" aria-description="Opponent's move after a hypothetical pass. Unavailable in check."
      onClick={() => { if (!enabled) setFailed(null); setEnabled(value => !value); }}>
      <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" strokeWidth="1.8"
        aria-hidden="true" focusable="false"><circle cx="12" cy="12" r="7"/><circle cx="12" cy="12" r="2"/>
        <path d="M12 2v5m0 10v5M2 12h5m10 0h5"/></svg>
    </button>
    {enabled && <small className="engine-threat-status" role="status">{message}
      {available && !reviewing && plan.reason ? ` · ${plan.reason}` : ''}
    </small>}
  </>;
}
