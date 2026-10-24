import { useEffect, useRef, useState } from 'react';
import type { EngineEvaluation } from './engine-analysis';
import { evaluationBarState } from './analysis-workspace';

export function evaluationFillPercent(current: number | null, previous: number): number {
  return current ?? previous;
}

export interface EvaluationVisual {
  readonly gameId: string;
  readonly whitePercent: number;
  readonly hasValue: boolean;
}

export function evaluationVisualState(previous: EvaluationVisual | null, gameId: string,
  current: number | null, pending: boolean): { visual: EvaluationVisual; unevaluated: boolean } {
  const sameGame = previous?.gameId === gameId;
  const visual = { gameId, whitePercent: evaluationFillPercent(current, sameGame ? previous.whitePercent : 50),
    hasValue: current !== null || sameGame && previous.hasValue };
  return { visual, unevaluated: current === null && (!visual.hasValue || !pending) };
}

export function EvaluationBar({ evaluation, fen, gameId, pending = false }: {
  readonly evaluation: EngineEvaluation | null; readonly fen: string; readonly gameId: string;
  readonly pending?: boolean;
}) {
  const state = evaluationBarState(evaluation, fen);
  const lastFill = useRef<EvaluationVisual | null>(null);
  const lookup = useRef({ gameId, fen, version: 0 });
  if (lookup.current.gameId !== gameId || lookup.current.fen !== fen)
    lookup.current = { gameId, fen, version: lookup.current.version + 1 };
  const version = lookup.current.version;
  const [settledVersion, setSettledVersion] = useState(-1);
  // A cache lookup is published by the engine panel's effect after navigation.
  useEffect(() => {
    const timer = window.setTimeout(() => setSettledVersion(version), 150);
    return () => window.clearTimeout(timer);
  }, [version]);
  const waiting = pending || settledVersion !== version;
  const presentation = evaluationVisualState(lastFill.current, gameId, state?.whitePercent ?? null, waiting);
  lastFill.current = presentation.visual;
  const missingLabel = pending || waiting && presentation.visual.hasValue
    ? 'Evaluation pending for this position' : 'No evaluation for this position';
  return <div className="evaluation-bar" role={state === null ? 'group' : 'meter'} tabIndex={0}
    aria-label={state === null ? missingLabel
      : 'White-perspective evaluation'}
    aria-valuemin={state === null ? undefined : -10} aria-valuemax={state === null ? undefined : 10}
    aria-valuenow={state === null ? undefined
      : Math.round((state.whitePercent - 50) * 20) / 100}
    aria-valuetext={state?.label}>
    <div className={`evaluation-track${presentation.unevaluated ? ' unevaluated' : ''}`}>
      <div className="evaluation-white" aria-hidden="true"
        style={{ height: `${presentation.visual.whitePercent}%` }} />
    </div>
    <span className="evaluation-tooltip" role="tooltip">
      {state?.label ?? missingLabel}
    </span>
  </div>;
}
