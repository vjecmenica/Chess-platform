import type { EngineEvaluation } from './engine-analysis';
import { evaluationBarState } from './analysis-workspace';

export function EvaluationBar({ evaluation, fen }: {
  readonly evaluation: EngineEvaluation | null; readonly fen: string;
}) {
  const state = evaluationBarState(evaluation, fen);
  return <div className="evaluation-bar" role={state === null ? 'group' : 'meter'} tabIndex={0}
    aria-label={state === null ? 'White-perspective evaluation: no evaluation for this position'
      : 'White-perspective evaluation'}
    aria-valuemin={state === null ? undefined : -10} aria-valuemax={state === null ? undefined : 10}
    aria-valuenow={state === null ? undefined
      : Math.round((state.whitePercent - 50) * 20) / 100}
    aria-valuetext={state?.label}>
    <div className={`evaluation-track${state === null ? ' unevaluated' : ''}`}>
      <div className="evaluation-white" aria-hidden="true"
        style={{ height: `${state?.whitePercent ?? 0}%` }} />
    </div>
    <span className="evaluation-tooltip" role="tooltip">
      {state?.label ?? 'No evaluation for this position'}
    </span>
  </div>;
}
