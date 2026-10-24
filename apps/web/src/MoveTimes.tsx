import type { GameReadResponse } from '@chess/contracts';
import { moveTimes } from './move-times';

export function MoveTimes({ game, onSelectPly }: {
  game: GameReadResponse; onSelectPly: (ply: number) => void;
}) {
  const entries = moveTimes(game);
  const known = entries.filter(entry => entry.elapsedMs !== null);
  if (known.length === 0) return null;
  const scale = Math.max(1000, ...known.map(entry => entry.elapsedMs!));
  return <details className="move-times" aria-label="Move times">
    <summary>Move times</summary>
    <p>Time spent per move from recorded clocks. Gaps mean the duration is unavailable.</p>
    <div className="move-times-list" role="list">
      {entries.map(entry => <div className="move-time-row" role="listitem" key={entry.ply}>
        <span className="move-time-number">{Math.ceil(entry.ply / 2)}{entry.side === 'white' ? '.' : '...'}</span>
        <button type="button" className="move-time-link" onClick={() => onSelectPly(entry.ply)}
          aria-label={`Show move ${entry.ply}, ${entry.san}`} title={`Show ${entry.san} on the board`}>{entry.san}</button>
        <div className="move-time-track" aria-hidden="true">{entry.elapsedMs !== null &&
          <span className={`move-time-bar move-time-${entry.side}`}
            style={{ width: `${Math.max(2, entry.elapsedMs / scale * 100)}%` }} />}</div>
        <span className="move-time-value">{entry.elapsedMs === null ? '—'
          : `${(entry.elapsedMs / 1000).toFixed(1)}s`}</span>
      </div>)}
    </div>
  </details>;
}
