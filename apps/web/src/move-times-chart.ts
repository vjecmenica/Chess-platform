import type { GameSide, SavedMove } from '@chess/contracts';
import type { TimedMove } from './move-times';

export interface PlayerTimeSummary {
  readonly totalMoves: number;
  readonly measuredMoves: number;
  readonly longest: TimedMove | null;
  readonly averageMs: number | null;
  readonly lastRecorded: { readonly ply: number; readonly san: string; readonly remainingMs: number } | null;
}

export function summarizeMoveTimes(history: readonly SavedMove[], measured: readonly TimedMove[]):
  Readonly<Record<GameSide, PlayerTimeSummary>> {
  const summarize = (side: GameSide): PlayerTimeSummary => {
    const moves = history.filter(move => move.side === side);
    const known = measured.filter(move => move.side === side && move.elapsedMs !== null);
    let longest: TimedMove | null = null;
    let totalMs = 0;
    for (const move of known) {
      totalMs += move.elapsedMs!;
      if (longest === null || move.elapsedMs! > longest.elapsedMs!) longest = move;
    }
    const last = [...moves].reverse().find(move => move.remainingMsAfterMove !== null);
    return { totalMoves: moves.length, measuredMoves: known.length, longest,
      averageMs: known.length === 0 ? null : totalMs / known.length,
      lastRecorded: last ? { ply: last.ply, san: last.san, remainingMs: last.remainingMsAfterMove! } : null };
  };
  return { white: summarize('white'), black: summarize('black') };
}

export interface ClockPoint {
  readonly ply: number;
  readonly remainingMs: number;
  readonly x: number;
  readonly y: number;
}

export interface ClockSegment {
  readonly side: GameSide;
  readonly points: readonly ClockPoint[];
}

/** Each side has its own scale; only consecutive recorded turns are connected. */
export function recordedClockSegments(history: readonly SavedMove[]): readonly ClockSegment[] {
  const segments: ClockSegment[] = [];
  for (const side of ['white', 'black'] as const) {
    const moves = history.filter(move => move.side === side);
    const valid = (value: number | null): value is number => value !== null
      && Number.isFinite(value) && value >= 0;
    const maximum = Math.max(1, ...moves.map(move => valid(move.remainingMsAfterMove)
      ? move.remainingMsAfterMove : 0));
    let points: ClockPoint[] = [];
    const finish = () => {
      if (points.length > 0) segments.push({ side, points });
      points = [];
    };
    for (const move of moves) {
      if (!valid(move.remainingMsAfterMove)) { finish(); continue; }
      const distance = move.remainingMsAfterMove / maximum * 106;
      points.push({ ply: move.ply, remainingMs: move.remainingMsAfterMove,
        x: (move.ply - .5) / history.length * 1000,
        y: side === 'white' ? 120 - distance : 120 + distance });
    }
    finish();
  }
  return segments;
}

export function moveTimeTooltipPosition(anchor: { left: number; right: number; top: number; bottom: number },
  tooltip: { width: number; height: number }, viewport: { width: number; height: number }): {
    left: number; top: number;
  } {
  const gap = 10;
  const clamp = (value: number, maximum: number) => Math.max(8, Math.min(value, maximum - 8));
  const above = anchor.top - tooltip.height - gap;
  return {
    left: clamp((anchor.left + anchor.right - tooltip.width) / 2, viewport.width - tooltip.width),
    top: clamp(above >= 8 ? above : anchor.bottom + gap, viewport.height - tooltip.height),
  };
}
