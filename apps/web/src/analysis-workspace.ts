import { evaluationLabel, type EngineEvaluation } from './engine-analysis';
import { graphCentipawns } from './game-review';

export const minimumAnalysisBoardSize = 240;
export const maximumAnalysisBoardSize = 1080;

export function availableAnalysisBoardWidth(workspaceWidth: number, stacked: boolean): number {
  // Reserve the evaluation bar in both layouts, and the move panel and gap on desktop.
  return Math.max(0, workspaceWidth - (stacked ? 34 : 34 + 320 + 18));
}

export function resizedBoardSize(startSize: number, deltaX: number, deltaY: number,
  availableWidth: number, availableHeight = maximumAnalysisBoardSize): number {
  const maximum = Math.max(0, Math.min(maximumAnalysisBoardSize, availableWidth, availableHeight));
  const minimum = Math.min(minimumAnalysisBoardSize, maximum);
  return Math.round(Math.max(minimum,
    Math.min(maximum, startSize + (deltaX + deltaY) / 2)));
}

export function evaluationBarState(evaluation: EngineEvaluation | null, fen: string):
  { whitePercent: number; label: string } | null {
  if (evaluation === null || evaluation.fen !== fen) return null;
  const score = graphCentipawns(evaluation);
  const label = evaluation.score.kind === 'mate' && evaluation.score.value === 0
    ? `${score > 0 ? 'White' : 'Black'} wins by mate`
    : `White perspective ${evaluationLabel(evaluation)}`;
  return { whitePercent: 50 + score / 20, label };
}
