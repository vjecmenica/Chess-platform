import { useId, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import type { GameReadResponse } from '@chess/contracts';
import { formatClock } from './ClockValue';
import { moveTimes, type TimedMove } from './move-times';
import { moveTimeTooltipPosition, recordedClockSegments, summarizeMoveTimes } from './move-times-chart';
import { TimeManagementSummary } from './TimeManagementSummary';

export function moveTimeDescription(move: TimedMove, remainingMs: number | null): string {
  const number = `${Math.ceil(move.ply / 2)}${move.side === 'white' ? '.' : '...'}`;
  const duration = move.elapsedMs === null ? 'time spent unavailable'
    : `${(move.elapsedMs / 1000).toFixed(1)} seconds spent`;
  const clock = remainingMs === null ? 'recorded clock unavailable'
    : `${formatClock(remainingMs)} remaining`;
  return `${number} ${move.san} · ${duration} · ${clock}`;
}

function MoveTimeTooltip({ id, move, remainingMs, target }: {
  id: string; move: TimedMove; remainingMs: number | null; target: HTMLButtonElement;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const [position, setPosition] = useState<{ left: number; top: number } | null>(null);
  useLayoutEffect(() => {
    const update = () => {
      if (!ref.current) return;
      const column = target.getBoundingClientRect();
      const bar = target.querySelector('.move-time-bar')?.getBoundingClientRect();
      const anchor = bar ?? { left: column.left, right: column.right,
        top: column.top + column.height / 2, bottom: column.top + column.height / 2 };
      setPosition(moveTimeTooltipPosition(anchor, ref.current.getBoundingClientRect(),
        { width: document.documentElement.clientWidth, height: document.documentElement.clientHeight }));
    };
    update();
    window.addEventListener('resize', update);
    window.addEventListener('scroll', update, true);
    return () => {
      window.removeEventListener('resize', update);
      window.removeEventListener('scroll', update, true);
    };
  }, [target, move]);
  return createPortal(<div ref={ref} id={id} role="tooltip" className="move-time-tooltip"
    style={position ?? { visibility: 'hidden' }}>
    <strong>{Math.ceil(move.ply / 2)}{move.side === 'white' ? '.' : '...'} {move.san}</strong>
    <span>Time spent: {move.elapsedMs === null ? 'unavailable' : `${(move.elapsedMs / 1000).toFixed(1)} seconds`}</span>
    <span>Clock: {remainingMs === null ? 'unavailable' : `${formatClock(remainingMs)} remaining`}</span>
  </div>, document.body);
}

export function MoveTimes({ game, selectedPly, onSelectPly }: {
  game: GameReadResponse; selectedPly: number | null; onSelectPly: (ply: number) => void;
}) {
  const [hovered, setHovered] = useState<{ ply: number; target: HTMLButtonElement; order: number } | null>(null);
  const [focused, setFocused] = useState<{ ply: number; target: HTMLButtonElement; order: number } | null>(null);
  const interactionOrder = useRef(0);
  const tooltipId = useId();
  const entries = useMemo(() => moveTimes(game), [game]);
  const clockSegments = useMemo(() => recordedClockSegments(game.history), [game.history]);
  const summaries = useMemo(() => summarizeMoveTimes(game.history, entries), [game.history, entries]);
  const known = entries.filter(entry => entry.elapsedMs !== null);
  if (known.length === 0) return null;
  const maximum = Math.max(1_000, ...known.map(entry => entry.elapsedMs!));
  const active = hovered && focused ? hovered.order > focused.order ? hovered : focused : hovered ?? focused;
  const detail = active === null ? null : entries[active.ply - 1];
  const tickEvery = entries.length <= 20 ? 2 : entries.length <= 60 ? 5 : 10;
  return <div className="move-times-layout">
    <div className="move-times" role="group" aria-label="Move times chart"
    aria-description="White move durations above the baseline; Black below. Blue clock lines use separate scales for each player and break at missing samples.">
    <div className="move-times-scroll">
      <div className="move-times-plot" style={{ minWidth: `${entries.length * 13}px`,
        gridTemplateColumns: `repeat(${entries.length}, minmax(0, 1fr))` }}>
        <span className="move-times-baseline" aria-hidden="true" />
        <svg className="move-time-clocks" viewBox="0 0 1000 240" preserveAspectRatio="none"
          aria-hidden="true">
          {clockSegments.map((segment, index) => segment.points.length === 1
            ? <circle key={index} className={`move-time-clock-${segment.side}`}
              cx={segment.points[0]!.x} cy={segment.points[0]!.y} r="2" />
            : <polyline key={index} className={`move-time-clock-${segment.side}`}
              points={segment.points.map(point => `${point.x},${point.y}`).join(' ')} />)}
        </svg>
        {entries.map(entry => {
          const remainingMs = game.history[entry.ply - 1]?.remainingMsAfterMove ?? null;
          const moveNumber = Math.ceil(entry.ply / 2);
          const tick = entry.side === 'white' && (moveNumber - 1) % tickEvery === 0;
          return <button key={entry.ply} type="button"
            className={`move-time-column move-time-${entry.side}${entry.elapsedMs === null ? ' move-time-unknown' : ''}`}
            aria-label={moveTimeDescription(entry, remainingMs)}
            aria-current={selectedPly === entry.ply ? 'step' : undefined}
            aria-describedby={active?.ply === entry.ply ? tooltipId : undefined}
            onMouseEnter={event => setHovered({ ply: entry.ply, target: event.currentTarget,
              order: ++interactionOrder.current })}
            onMouseLeave={() => setHovered(null)}
            onFocus={event => setFocused({ ply: entry.ply, target: event.currentTarget,
              order: ++interactionOrder.current })}
            onBlur={() => setFocused(null)}
            onKeyDown={event => {
              if (event.key === 'Escape') {
                setHovered(null); setFocused(null); event.stopPropagation();
              } else setFocused({ ply: entry.ply, target: event.currentTarget,
                order: ++interactionOrder.current });
            }}
            onClick={() => onSelectPly(entry.ply)}>
            {entry.elapsedMs === null ? <span className="move-time-gap" aria-hidden="true" />
              : <span className="move-time-bar" aria-hidden="true"
                style={{ height: `${Math.max(2, entry.elapsedMs / maximum * 44)}%` }} />}
            {tick && <span className="move-time-axis-label" aria-hidden="true">{moveNumber}</span>}
          </button>;
        })}
      </div>
    </div>
    {detail && active && <MoveTimeTooltip id={tooltipId} move={detail} target={active.target}
      remainingMs={game.history[detail.ply - 1]?.remainingMsAfterMove ?? null} />}
    </div>
    <TimeManagementSummary summaries={summaries} onSelectPly={onSelectPly} />
  </div>;
}
