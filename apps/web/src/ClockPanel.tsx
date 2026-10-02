import { useEffect, useState } from 'react';
import type { ClockState, GameSide } from '@chess/contracts';

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
  const seconds = Math.ceil(milliseconds / 1000);
  return `${String(Math.floor(seconds / 60)).padStart(2, '0')}:${String(seconds % 60).padStart(2, '0')}`;
}

export function ClockPanel({ clock, side, isYou, materialAdvantage }: {
  clock: ClockState | null;
  side: GameSide;
  isYou: boolean;
  materialAdvantage?: number | null;
}) {
  const [elapsedMs, setElapsedMs] = useState(0);
  useEffect(() => {
    const observedAt = performance.now();
    setElapsedMs(0);
    if (clock === null || (clock.activeSide !== side
      && clock.firstMoveDeadlineMs[side] === null)) return;
    const timer = window.setInterval(() => setElapsedMs(performance.now() - observedAt), 250);
    return () => window.clearInterval(timer);
  }, [clock, side]);

  const graceMs = clock === null ? null : firstMoveRemainingMs(clock, side, elapsedMs);
  return <div className={`clock ${clock?.activeSide === side ? 'clock-active' : ''}`}
    aria-label={`${isYou ? 'Your' : "Opponent's"} ${side} clock`}>
      <span className="player-label">{isYou ? 'You' : 'Opponent'}
        {materialAdvantage != null && materialAdvantage > 0 &&
          <span className="material-advantage" aria-label={`${side} leads by ${materialAdvantage} material points`}>
            +{materialAdvantage}</span>}
        <b>{side === 'white' ? 'White' : 'Black'}</b></span>
      <strong aria-live="off">{clock === null ? 'Untimed' : formatClock(displayedMs(clock, side, elapsedMs))}</strong>
      <small>{clock === null ? 'Earlier untimed game' : clock.startMode !== 'readiness'
        ? clock.phase === 'awaiting_first_move' ? 'Clock paused'
          : clock.activeSide === side ? 'Running' : 'Stopped'
        : clock.ready[side] ? 'Ready' : 'Not ready'}</small>
      {graceMs !== null && <span className="first-move-countdown"
        aria-label={`${side === 'white' ? 'White' : 'Black'} first-move deadline, ${formatClock(graceMs)} remaining`}>
        First move <b aria-live="off">{formatClock(graceMs)}</b>
      </span>}
  </div>;
}
