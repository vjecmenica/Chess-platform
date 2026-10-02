import { useEffect, useRef, useState } from 'react';
import { EngineCache, EngineController, engineBuild, engineWorkerUrl,
  evaluationLabel, variationSan, type EngineState, type EngineWorker } from './engine-analysis';

export function EnginePanel({ fen }: { readonly fen: string }) {
  const [enabled, setEnabled] = useState(false);
  const [state, setState] = useState<EngineState>({ kind: 'off' });
  const controller = useRef<EngineController | null>(null);

  useEffect(() => {
    let storage: Storage | undefined;
    try { storage = window.localStorage; } catch { /* Analysis still works without storage. */ }
    controller.current = new EngineController(
      () => new Worker(engineWorkerUrl) as EngineWorker, setState, new EngineCache(storage));
    return () => { controller.current?.dispose(); controller.current = null; };
  }, []);

  useEffect(() => { if (enabled) controller.current?.setPosition(fen); }, [enabled, fen]);

  const evaluation = state.kind === 'done' && state.evaluation.fen === fen
    ? state.evaluation : null;
  const line = evaluation === null ? [] : variationSan(fen, evaluation.variation);

  return <section className="engine-panel" aria-label="Stockfish analysis">
    <div className="engine-heading">
      <strong>Stockfish</strong>
      <button type="button" className="secondary" aria-pressed={enabled}
        onClick={() => {
          if (enabled && state.kind === 'error') controller.current?.start(fen);
          else if (enabled) { controller.current?.stop(); setEnabled(false); }
          else { controller.current?.start(fen); setEnabled(true); }
        }}>{enabled ? state.kind === 'error' ? 'Retry engine' : 'Stop engine' : 'Start engine'}</button>
    </div>
    {enabled && state.kind === 'loading' && <span role="status">Loading engine…</span>}
    {enabled && state.kind === 'searching' && <span role="status">Evaluating position…</span>}
    {enabled && state.kind === 'error' && <span role="alert">{state.message}</span>}
    {enabled && evaluation !== null && <div className="engine-result" role="status">
      <span className="engine-score" aria-label={`Evaluation from White's perspective ${evaluationLabel(evaluation)}`}>
        {evaluationLabel(evaluation)}</span>
      <span>Best: {line[0] ?? (evaluation.bestMove === null ? 'No legal move' : evaluation.bestMove)}</span>
      <small>Depth {evaluation.depth}{state.kind === 'done' && state.cached ? ' · cached' : ''}</small>
      {line.length > 0 && <span className="engine-line" aria-label={`Principal variation ${line.join(' ')}`}>
        {line.join(' ')}</span>}
    </div>}
    <a className="engine-credit" href="/engine/NOTICE.md" target="_blank" rel="noreferrer"
      title={`${engineBuild}, GPLv3. Runs in this browser.`}>Engine license and source</a>
  </section>;
}
