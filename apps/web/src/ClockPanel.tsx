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

export function ClockPanel({ clock }: { clock: ClockState }) {
  const [elapsedMs, setElapsedMs] = useState(0);
  useEffect(() => {
    const observedAt = performance.now();
    setElapsedMs(0);
    if (clock.phase !== 'running') return;
    const timer = window.setInterval(() => setElapsedMs(performance.now() - observedAt), 250);
    return () => window.clearInterval(timer);
  }, [clock]);

  return <div className="clocks" aria-label="Server-authoritative chess clocks">
    {(['white', 'black'] as const).map(side => <div key={side}
      className={`clock ${clock.activeSide === side ? 'clock-active' : ''}`}>
      <span>{side === 'white' ? 'White' : 'Black'}</span>
      <strong aria-live="off">{formatClock(displayedMs(clock, side, elapsedMs))}</strong>
      <small>{clock.startMode === 'first_move'
        ? clock.phase === 'awaiting_first_move' ? 'Clock paused'
          : clock.activeSide === side ? 'Running' : 'Stopped'
        : clock.ready[side] ? 'Ready' : 'Not ready'}</small>
    </div>)}
  </div>;
}
