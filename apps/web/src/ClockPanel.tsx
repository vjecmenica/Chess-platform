import { useEffect, useState } from 'react';
import type { ClockState, GameSide } from '@chess/contracts';

export function displayedMs(clock: ClockState, side: GameSide, elapsedMs: number): number {
  return clock.activeSide === side && clock.phase === 'running'
    ? Math.max(0, clock.remainingMs[side] - Math.max(0, elapsedMs))
    : clock.remainingMs[side];
}

export function formatClock(milliseconds: number): string {
  const seconds = Math.ceil(milliseconds / 1000);
  return `${String(Math.floor(seconds / 60)).padStart(2, '0')}:${String(seconds % 60).padStart(2, '0')}`;
}

export function ClockPanel({ clock, side, isYou }: {
  clock: ClockState | null;
  side: GameSide;
  isYou: boolean;
}) {
  const [elapsedMs, setElapsedMs] = useState(0);
  useEffect(() => {
    const observedAt = performance.now();
    setElapsedMs(0);
    if (clock?.phase !== 'running' || clock.activeSide !== side) return;
    const timer = window.setInterval(() => setElapsedMs(performance.now() - observedAt), 250);
    return () => window.clearInterval(timer);
  }, [clock, side]);

  return <div className={`clock ${clock?.activeSide === side ? 'clock-active' : ''}`}
    aria-label={`${isYou ? 'Your' : "Opponent's"} ${side} clock`}>
      <span className="player-label">{isYou ? 'You' : 'Opponent'} <b>{side === 'white' ? 'White' : 'Black'}</b></span>
      <strong aria-live="off">{clock === null ? 'Untimed' : formatClock(displayedMs(clock, side, elapsedMs))}</strong>
      <small>{clock === null ? 'Earlier untimed game' : clock.startMode === 'first_move'
        ? clock.phase === 'awaiting_first_move' ? 'Clock paused'
          : clock.activeSide === side ? 'Running' : 'Stopped'
        : clock.ready[side] ? 'Ready' : 'Not ready'}</small>
  </div>;
}
