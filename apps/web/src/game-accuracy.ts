import type { GameSide } from '@chess/contracts';
import type { EngineEvaluation } from './engine-analysis';

export const accuracyMethodVersion = 'local-win-accuracy-v1';

export interface PlayerAccuracy {
  readonly method: typeof accuracyMethodVersion;
  readonly value: number | null;
  readonly moveCount: number;
  readonly unavailable: 'no_moves' | 'missing_evaluation' | null;
  readonly weightedMean: number | null;
  readonly harmonicMean: number | null;
}

export interface GameAccuracy {
  readonly windowSize: number;
  readonly white: PlayerAccuracy;
  readonly black: PlayerAccuracy;
}

const bounded = (value: number) => Math.max(0, Math.min(100, value));

// Independently implemented from the published equations; local conventions are
// specified in docs/accuracy-method.md, rather than inferred from Lichess code.
export function whiteWinPercent(evaluation: EngineEvaluation | null | undefined): number | null {
  if (!evaluation || !Number.isFinite(evaluation.score.value)) return null;
  const turn = evaluation.fen.split(' ')[1];
  if (turn !== 'w' && turn !== 'b') return null;
  const sign = turn === 'w' ? 1 : -1;
  if (evaluation.score.kind === 'mate') {
    if (!Number.isInteger(evaluation.score.value)) return null;
    // Mate zero means the side to move is already checkmated. No CP is invented.
    return sign * (evaluation.score.value > 0 ? 1 : -1) > 0 ? 100 : 0;
  }
  const cp = sign * evaluation.score.value;
  const exponential = Math.exp(-0.00368208 * Math.abs(cp));
  return cp >= 0 ? 100 / (1 + exponential) : 100 * exponential / (1 + exponential);
}

export function moveAccuracy(before: number, after: number): number | null {
  if (![before, after].every(value => Number.isFinite(value) && value >= 0 && value <= 100))
    return null;
  if (after >= before) return 100;
  return bounded(103.1668 * Math.exp(-0.04354 * (before - after)) - 3.1669);
}

export function accuracyWindowSize(positionCount: number): number {
  return Math.min(positionCount, Math.max(3, Math.min(9, Math.ceil(Math.sqrt(positionCount)))));
}

export function accuracyVolatility(whitePercentages: readonly number[]): number[] {
  const size = accuracyWindowSize(whitePercentages.length);
  return whitePercentages.slice(1).map((_, index) => {
    const afterPosition = index + 1;
    const start = Math.max(0, Math.min(whitePercentages.length - size,
      afterPosition - Math.floor((size - 1) / 2)));
    const window = whitePercentages.slice(start, start + size);
    const mean = window.reduce((sum, value) => sum + value, 0) / size;
    return Math.sqrt(window.reduce((sum, value) => sum + (value - mean) ** 2, 0) / size);
  });
}

export function calculateGameAccuracy(
  evaluations: readonly (EngineEvaluation | null | undefined)[],
  movingSides: readonly GameSide[],
): GameAccuracy {
  const positionCount = movingSides.length + 1;
  const percentages = Array.from({ length: positionCount }, (_, index) => whiteWinPercent(evaluations[index]));
  const complete = evaluations.length === positionCount && percentages.every(value => value !== null);
  const whitePercentages = complete ? percentages as number[] : [];
  const weights = complete ? accuracyVolatility(whitePercentages) : [];

  function forPlayer(side: GameSide): PlayerAccuracy {
    const indices = movingSides.flatMap((mover, index) => mover === side ? [index] : []);
    const base = { method: accuracyMethodVersion, moveCount: indices.length } as const;
    if (indices.length === 0 || !complete) return { ...base, value: null,
      weightedMean: null, harmonicMean: null,
      unavailable: indices.length === 0 ? 'no_moves' : 'missing_evaluation' };
    const accuracies = indices.map(index => {
      const before = whitePercentages[index]!;
      const after = whitePercentages[index + 1]!;
      return moveAccuracy(side === 'white' ? before : 100 - before,
        side === 'white' ? after : 100 - after)!;
    });
    const weightSum = indices.reduce((sum, index) => sum + weights[index]!, 0);
    const weightedMean = weightSum > 0
      ? accuracies.reduce((sum, value, index) => sum + value * weights[indices[index]!]!, 0) / weightSum
      : accuracies.reduce((sum, value) => sum + value, 0) / accuracies.length;
    const minimum = accuracies.reduce((lowest, value) => Math.min(lowest, value), 100);
    // Scaling by the smallest value avoids reciprocal overflow near zero.
    const harmonicMean = minimum === 0 ? 0
      : minimum * accuracies.length / accuracies.reduce((sum, value) => sum + minimum / value, 0);
    return { ...base, value: bounded((weightedMean + harmonicMean) / 2),
      weightedMean: bounded(weightedMean), harmonicMean: bounded(harmonicMean), unavailable: null };
  }

  return { windowSize: accuracyWindowSize(positionCount), white: forPlayer('white'), black: forPlayer('black') };
}
