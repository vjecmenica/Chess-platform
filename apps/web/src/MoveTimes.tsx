import { useMemo, useState } from 'react';
import type { GameReadResponse } from '@chess/contracts';
import { formatClock } from './ClockValue';
import { moveTimes, type TimedMove } from './move-times';

export function moveTimeDescription(move: TimedMove, remainingMs: number | null): string {
  const number = `${Math.ceil(move.ply / 2)}${move.side === 'white' ? '.' : '...'}`;
  const duration = move.elapsedMs === null ? 'time spent unavailable'
    : `${(move.elapsedMs / 1000).toFixed(1)} seconds spent`;
  const clock = remainingMs === null ? 'recorded clock unavailable'
    : `${formatClock(remainingMs)} remaining`;
  return `${number} ${move.san} · ${duration} · ${clock}`;
}

export function MoveTimes({ game, selectedPly, onSelectPly }: {
  game: GameReadResponse; selectedPly: number | null; onSelectPly: (ply: number) => void;
}) {
  const [hoveredPly, setHoveredPly] = useState<number | null>(null);
  const entries = useMemo(() => moveTimes(game), [game]);
  const known = entries.filter(entry => entry.elapsedMs !== null);
  if (known.length === 0) return null;
  const maximum = Math.max(1_000, ...known.map(entry => entry.elapsedMs!));
  const detailPly = hoveredPly ?? selectedPly;
  const detail = detailPly === null ? null : entries[detailPly - 1];
  const tickEvery = entries.length <= 20 ? 2 : entries.length <= 60 ? 5 : 10;
  return <div className="move-times" aria-label="Move times chart"
    style={{ maxWidth: `${Math.min(920, Math.max(360, entries.length * 20))}px` }}>
    <div className="move-times-key"><span>White above</span><span>Black below</span></div>
    <div className="move-times-scroll">
      <div className="move-times-plot" style={{ minWidth: `${entries.length * 13}px`,
        gridTemplateColumns: `repeat(${entries.length}, minmax(0, 1fr))` }}>
        <span className="move-times-baseline" aria-hidden="true" />
        {entries.map(entry => {
          const remainingMs = game.history[entry.ply - 1]?.remainingMsAfterMove ?? null;
          const moveNumber = Math.ceil(entry.ply / 2);
          const tick = entry.side === 'white' && (moveNumber - 1) % tickEvery === 0;
          return <button key={entry.ply} type="button"
            className={`move-time-column move-time-${entry.side}${entry.elapsedMs === null ? ' move-time-unknown' : ''}`}
            aria-label={moveTimeDescription(entry, remainingMs)}
            aria-current={selectedPly === entry.ply ? 'step' : undefined}
            onMouseEnter={() => setHoveredPly(entry.ply)} onMouseLeave={() => setHoveredPly(null)}
            onFocus={() => setHoveredPly(entry.ply)} onBlur={() => setHoveredPly(null)}
            onClick={() => onSelectPly(entry.ply)}>
            {entry.elapsedMs === null ? <span className="move-time-gap" aria-hidden="true" />
              : <span className="move-time-bar" aria-hidden="true"
                style={{ height: `${Math.max(2, entry.elapsedMs / maximum * 44)}%` }} />}
            {tick && <span className="move-time-axis-label" aria-hidden="true">{moveNumber}</span>}
          </button>;
        })}
      </div>
    </div>
    <div className="move-times-detail">{detail
      ? moveTimeDescription(detail, game.history[detail.ply - 1]?.remainingMsAfterMove ?? null)
      : 'Hover or focus a move for its time and recorded clock.'}</div>
  </div>;
}
