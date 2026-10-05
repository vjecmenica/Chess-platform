import { useEffect, useState } from 'react';
import type { ClockState, GameSide, SavedMove } from '@chess/contracts';

export function historicalClockMs(history: readonly SavedMove[], ply: number,
  side: GameSide, initialMs: number, timed: boolean): number | null {
  if (!timed) return null;
  for (let index = Math.min(ply, history.length) - 1; index >= 0; index -= 1) {
    if (history[index]!.side === side) return history[index]!.remainingMsAfterMove;
  }
  return initialMs;
}

export function displayedMs(clock: ClockState, side: GameSide, elapsedMs: number): number {
  return clock.activeSide === side && clock.phase === 'running'
    ? Math.max(0, clock.remainingMs[side] - Math.max(0, elapsedMs))
    : clock.remainingMs[side];
}

export function firstMoveRemainingMs(clock: ClockState, side: GameSide, elapsedMs: number): number | null {
  const deadlineMs = clock.firstMoveDeadlineMs[side];
  return deadlineMs === null ? null
    : Math.max(0, deadlineMs - clock.serverNowMs - Math.max(0, elapsedMs));
}

export function formatClock(milliseconds: number): string {
  const hundredths = Math.ceil(Math.max(0, milliseconds) / 10);
  const seconds = Math.floor(hundredths / 100);
  return `${String(Math.floor(seconds / 60)).padStart(2, '0')}:${String(seconds % 60).padStart(2, '0')}.${String(hundredths % 100).padStart(2, '0')}`;
}

export function ClockPanel({ clock, side, isYou, materialAdvantage, historicalMs }: {
  clock: ClockState | null;
  side: GameSide;
  isYou: boolean;
  materialAdvantage?: number | null;
  historicalMs?: number | null | undefined;
}) {
  const [elapsedMs, setElapsedMs] = useState(0);
  useEffect(() => {
    const observedAt = performance.now();
    setElapsedMs(0);
    if (historicalMs !== undefined || clock === null || (clock.activeSide !== side
      && clock.firstMoveDeadlineMs[side] === null)) return;
    const timer = window.setInterval(() => setElapsedMs(performance.now() - observedAt), 50);
    return () => window.clearInterval(timer);
  }, [clock, side, historicalMs]);

  const graceMs = historicalMs !== undefined || clock === null ? null
    : firstMoveRemainingMs(clock, side, elapsedMs);
  return <div className={`clock ${historicalMs === undefined && clock?.activeSide === side ? 'clock-active' : ''}`}
    aria-label={`${isYou ? 'Your' : "Opponent's"} ${side} clock`}>
      <span className="player-label">{isYou ? 'You' : 'Opponent'}
        {materialAdvantage != null && materialAdvantage > 0 &&
          <span className="material-advantage" aria-label={`${side} leads by ${materialAdvantage} material points`}>
            +{materialAdvantage}</span>}
        <b>{side === 'white' ? 'White' : 'Black'}</b></span>
      <strong aria-live="off">{historicalMs !== undefined
        ? historicalMs === null ? '—' : formatClock(historicalMs)
        : clock === null ? 'Untimed' : formatClock(displayedMs(clock, side, elapsedMs))}</strong>
      <small>{historicalMs !== undefined ? historicalMs === null ? 'Time unavailable' : 'At selected move'
        : clock === null ? 'Earlier untimed game' : clock.startMode !== 'readiness'
        ? clock.phase === 'awaiting_first_move' ? 'Clock paused'
          : clock.activeSide === side ? 'Running' : 'Stopped'
        : clock.ready[side] ? 'Ready' : 'Not ready'}</small>
      {graceMs !== null && <span className="first-move-countdown"
        aria-label={`${side === 'white' ? 'White' : 'Black'} first-move deadline, ${formatClock(graceMs)} remaining`}>
        First move <b aria-live="off">{formatClock(graceMs)}</b>
      </span>}
  </div>;
}
