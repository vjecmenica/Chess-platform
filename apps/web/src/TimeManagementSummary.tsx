import type { GameSide } from '@chess/contracts';
import { formatClock } from './ClockValue';
import type { PlayerTimeSummary } from './move-times-chart';

export function TimeManagementSummary({ summaries, onSelectPly }: {
  summaries: Readonly<Record<GameSide, PlayerTimeSummary>>;
  onSelectPly: (ply: number) => void;
}) {
  return <div className="time-management-summary" aria-label="Time management summary">
    {(['white', 'black'] as const).map(side => {
      const summary = summaries[side];
      const player = side === 'white' ? 'White' : 'Black';
      const longest = summary.longest;
      const last = summary.lastRecorded;
      return <section key={side} aria-label={`${player} time management`}>
        <header><strong>{player}</strong>
          <small>{summary.measuredMoves} of {summary.totalMoves} moves measured</small></header>
        <dl>
          <div><dt>Longest measured think</dt><dd>{longest === null ? 'Unavailable'
            : <button type="button" onClick={() => onSelectPly(longest.ply)}
              aria-label={`Show ${player}'s longest measured think: ${Math.ceil(longest.ply / 2)}${side === 'white' ? '.' : '...'} ${longest.san}`}>
              {Math.ceil(longest.ply / 2)}{side === 'white' ? '.' : '...'} {longest.san}
              {' · '}{(longest.elapsedMs! / 1000).toFixed(1)}s
            </button>}</dd></div>
          <div><dt>Average think time</dt><dd>{summary.averageMs === null ? 'Unavailable'
            : `${(summary.averageMs / 1000).toFixed(1)}s`}</dd></div>
          <div><dt>Last recorded clock</dt><dd title={last === null ? undefined
            : `After ${Math.ceil(last.ply / 2)}${side === 'white' ? '.' : '...'} ${last.san}`}>
            {last === null ? 'Unavailable' : formatClock(last.remainingMs)}</dd></div>
        </dl>
      </section>;
    })}
  </div>;
}
