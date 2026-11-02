import { maximumAnalysisBoardSize, minimumAnalysisBoardSize } from './analysis-workspace';

export const boardSizePreferenceKey = 'chess.board-size.v1';

/** A URL snapshot is contextual; only a deliberate resize writes the preference. */
export function renderedBoardSize(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) && value >= 160 && value <= maximumAnalysisBoardSize
    ? Math.round(value) : null;
}
export function readBoardSizePreference(storage?: Pick<Storage, 'getItem'>): number | null {
  try {
    const raw = storage?.getItem(boardSizePreferenceKey);
    return raw ? renderedBoardSize(Number(raw)) : null;
  } catch { return null; }
}
export function saveBoardSizePreference(storage: Pick<Storage, 'setItem'> | undefined, size: number): void {
  const valid = renderedBoardSize(size);
  if (valid === null || valid < minimumAnalysisBoardSize) return;
  try { storage?.setItem(boardSizePreferenceKey, String(valid)); } catch { /* Sizing works without storage. */ }
}
