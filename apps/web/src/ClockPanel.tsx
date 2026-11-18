import { useEffect, useState } from 'react';
import type { ClockState, GamePlayerNames, GameReadResponse, GameSide, PlayerAvatar, SavedMove } from '@chess/contracts';
import { PlayerIdentity, sitePlayerName } from './PlayerIdentity';
import { ClockValue, formatClock, PlayerClockValue } from './ClockValue';
import type { SitePlayerRating } from './rating-display';
export { formatClock } from './ClockValue';

export function historicalClockMs(history: readonly SavedMove[], ply: number,
  side: GameSide, initialMs: number | null, timed: boolean): number | null {
  if (!timed) return null;
  for (let index = Math.min(ply, history.length) - 1; index >= 0; index -= 1) {
    if (history[index]!.side === side) return history[index]!.remainingMsAfterMove;
  }
  return initialMs;
}

export function siteReplayClockMs(game: GameReadResponse, displayedPly: number,
  side: GameSide, onVariation: boolean): number | null | undefined {
  if (game.status !== 'finished') return undefined;
  if (onVariation) return null;
  if (displayedPly === game.history.length && game.clocks) return game.clocks.remainingMs[side];
  const initialMs = game.timeControl && 'initialMs' in game.timeControl ? game.timeControl.initialMs : null;
  return historicalClockMs(game.history, displayedPly, side, initialMs, true);
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

export function ClockPanel({ clock, side, isYou, playerNames, avatar, rating, historicalMs, isReplayTurn = false }: {
  clock: ClockState | null;
  side: GameSide;
  isYou: boolean;
  playerNames?: GamePlayerNames | undefined;
  avatar?: PlayerAvatar | null | undefined;
  rating?: SitePlayerRating | null | undefined;
  historicalMs?: number | null | undefined;
  isReplayTurn?: boolean;
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
  const running = historicalMs === undefined && clock?.phase === 'running' && clock.activeSide === side;
  return <div className={`clock${running ? ' clock-active' : ''}${isReplayTurn ? ' clock-replay-turn' : ''}`}
    aria-label={`${isYou ? 'Your' : "Opponent's"} ${side} clock`}>
      <PlayerIdentity side={side} name={sitePlayerName(playerNames, side)} rating={rating}
        accountName={playerNames?.[side]} avatarUrl={avatar?.url} />
      <PlayerClockValue side={side} milliseconds={valueMs} fallback={historicalMs !== undefined ? '—' : 'Untimed'} />
      {graceMs !== null && <span className="first-move-countdown"
        aria-label={`${side === 'white' ? 'White' : 'Black'} first-move deadline, ${formatClock(graceMs)} remaining`}>
        First move <b aria-live="off"><ClockValue milliseconds={graceMs} /></b>
      </span>}
  </div>;
}
