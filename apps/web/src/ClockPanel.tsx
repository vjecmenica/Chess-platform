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
  const seconds = milliseconds > 30_000 ? Math.ceil(milliseconds / 1000)
    : Math.floor(hundredths / 100);
  const main = `${String(Math.floor(seconds / 60)).padStart(2, '0')}:${String(seconds % 60).padStart(2, '0')}`;
  return milliseconds <= 30_000 ? `${main}.${String(hundredths % 100).padStart(2, '0')}` : main;
}

function ClockValue({ milliseconds }: { milliseconds: number }) {
  const value = formatClock(milliseconds);
  const [main, fraction] = value.split('.');
  return <><span>{main}</span>{fraction !== undefined &&
    <span className="clock-hundredths">.{fraction}</span>}</>;
}

export function ClockPanel({ clock, side, isYou, historicalMs }: {
  clock: ClockState | null;
  side: GameSide;
  isYou: boolean;
  historicalMs?: number | null | undefined;
}) {
  const [elapsedMs, setElapsedMs] = useState(0);
  useEffect(() => {
    const observedAt = performance.now();
    setElapsedMs(0);
    if (historicalMs !== undefined || clock === null || (clock.activeSide !== side
      && clock.firstMoveDeadlineMs[side] === null)) return;
    let timer: number;
    const tick = () => {
      const elapsed = performance.now() - observedAt;
      setElapsedMs(elapsed);
      const clockLeft = displayedMs(clock, side, elapsed);
      const graceLeft = firstMoveRemainingMs(clock, side, elapsed);
      timer = window.setTimeout(tick, clockLeft <= 0 && (graceLeft === null || graceLeft <= 0)
        ? 1_000 : clockLeft <= 30_000 || graceLeft !== null && graceLeft <= 30_000 ? 50 : 250);
    };
    timer = window.setTimeout(tick, 50);
    return () => window.clearTimeout(timer);
  }, [clock, side, historicalMs]);

  const graceMs = historicalMs !== undefined || clock === null ? null
    : firstMoveRemainingMs(clock, side, elapsedMs);
  const valueMs = historicalMs !== undefined ? historicalMs
    : clock === null ? null : displayedMs(clock, side, elapsedMs);
  return <div className={`clock ${historicalMs === undefined && clock?.activeSide === side ? 'clock-active' : ''} ${valueMs !== null && valueMs <= 30_000 ? 'clock-warning' : ''}`}
    aria-label={`${isYou ? 'Your' : "Opponent's"} ${side} clock`}>
      <span className="player-label">{isYou ? 'You' : 'Opponent'}
        <b>{side === 'white' ? 'White' : 'Black'}</b></span>
      <strong aria-live="off">{valueMs === null
        ? historicalMs !== undefined ? '—' : 'Untimed' : <ClockValue milliseconds={valueMs} />}</strong>
      <small>{historicalMs !== undefined ? historicalMs === null ? 'Time unavailable' : 'At selected move'
        : clock === null ? 'Earlier untimed game' : clock.startMode !== 'readiness'
        ? clock.phase === 'awaiting_first_move' ? 'Clock paused'
          : clock.activeSide === side ? 'Running' : 'Stopped'
        : clock.ready[side] ? 'Ready' : 'Not ready'}</small>
      {graceMs !== null && <span className="first-move-countdown"
        aria-label={`${side === 'white' ? 'White' : 'Black'} first-move deadline, ${formatClock(graceMs)} remaining`}>
        First move <b aria-live="off"><ClockValue milliseconds={graceMs} /></b>
      </span>}
  </div>;
}
