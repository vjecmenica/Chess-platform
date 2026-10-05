import type { EngineEvaluation } from './engine-analysis';
import { evaluationBarState } from './analysis-workspace';

export function EvaluationBar({ evaluation, fen }: {
  readonly evaluation: EngineEvaluation | null; readonly fen: string;
}) {
  const state = evaluationBarState(evaluation, fen);
  return <div className="evaluation-bar" role={state === null ? 'group' : 'meter'}
    aria-label="White-perspective evaluation"
    aria-valuemin={-10} aria-valuemax={10}
    aria-valuenow={state === null ? undefined
      : Math.round((state.whitePercent - 50) * 20) / 100}
    aria-valuetext={state?.label ?? 'No evaluation for this position'}>
    <div className={`evaluation-track${state === null ? ' unevaluated' : ''}`}>
      {state !== null && <div className="evaluation-white"
        style={{ height: `${state.whitePercent}%` }} />}
    </div>
    <span className="evaluation-score" title={state?.label ?? 'No evaluation for this position'}>
      {state === null ? 'White —' : state.label.replace('White perspective ', 'White ')}
    </span>
  </div>;
}
