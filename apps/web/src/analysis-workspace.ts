import { evaluationLabel, type EngineEvaluation } from './engine-analysis';
import { graphCentipawns } from './game-review';

export const minimumAnalysisBoardSize = 240;
export const maximumAnalysisBoardSize = 1080;
const minimumDefaultDesktopBoardSize = 334;

export function availableAnalysisBoardWidth(workspaceWidth: number, stacked: boolean,
  chatRail = false, analysis = false): number {
  // The wide site-game grid reserves a 320px chat rail, a 440px move panel,
  // its gaps, and the space around the square board inside its column.
  const reserve = stacked ? 34 : chatRail
    ? 320 + 440 + (analysis ? 2 * 16 + 50 : 2 * 18 + 34)
    : analysis ? 50 + 400 + 16 : 34 + 320 + 18;
  return Math.max(0, workspaceWidth - reserve);
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

/** Default only: explicit resizing remains width-constrained and can extend the page. */
export function defaultAnalysisBoardSize(availableWidth: number, viewportHeight: number,
  workspaceTop: number, upperChrome: number, lowerHeight: number, stacked: boolean): number {
  if (stacked) return Math.max(0, Math.min(availableWidth, maximumAnalysisBoardSize));
  // Budget for the compact cards, but keep the desktop board usable on short screens.
  // The extra height scrolls naturally, as does an expanded full-width report.
  const remaining = viewportHeight - workspaceTop - upperChrome - Math.max(320, Math.min(360, lowerHeight)) - 28;
  return Math.round(Math.max(0, Math.min(availableWidth, maximumAnalysisBoardSize,
    Math.max(minimumDefaultDesktopBoardSize, remaining))));
}
