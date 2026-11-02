import { timeControlPresets, type GameState, type TimeControlId } from '@chess/contracts';
import { simplePgnTimeControl } from './move-times';
import { timeControlLabel } from './TimeControlSelect';

export type TimeCategory = 'bullet' | 'blitz' | 'rapid' | 'classical';
// Explicit product assignments (docs/product-spec.md), not a rating calculation.
const categories: Record<TimeControlId, TimeCategory> = {
  '1+0': 'bullet', '3+0': 'blitz', '3+2': 'blitz', '5+3': 'blitz',
  '10+0': 'rapid', '10+2': 'rapid', '10+5': 'rapid',
  '15+0': 'rapid', '15+2': 'rapid', '15+5': 'rapid',
  '20+0': 'classical', '20+10': 'classical', '25+0': 'classical', '25+10': 'classical',
  '30+0': 'classical', '30+10': 'classical',
};
export const timeCategoryLabels: Record<TimeCategory, string> = {
  bullet: 'Bullet', blitz: 'Blitz', rapid: 'Rapid', classical: 'Classical',
};

export function timeCategory(control: { initialMs: number; incrementMs: number }): TimeCategory | null {
  const preset = (Object.keys(timeControlPresets) as TimeControlId[]).find(id => {
    const value = timeControlPresets[id];
    return value.initialMs === control.initialMs && value.incrementMs === control.incrementMs;
  });
  return preset ? categories[preset] : null;
}

export function infoTimeControl(game: Pick<GameState, 'timeControl' | 'clockStatus'>): {
  label: string; category: TimeCategory | null; pgn: boolean;
} {
  const control = game.timeControl;
  if (control === null) return { label: 'Unavailable', category: null, pgn: false };
  if ('source' in control) {
    const parsed = simplePgnTimeControl(control.raw);
    return { label: control.raw.trim() && control.raw.trim() !== '-' ? control.raw : 'Unavailable',
      category: parsed ? timeCategory(parsed) : null, pgn: true };
  }
  if (game.clockStatus === 'not_integrated') return { label: 'Untimed', category: null, pgn: false };
  return { label: timeControlLabel(control.initialMs, control.incrementMs), category: timeCategory(control), pgn: false };
}

/** Original, small outline symbols; their category is always also written as text. */
export function TimeControlIcon({ category }: { category: TimeCategory }) {
  return <svg className="time-control-icon" width="20" height="20" viewBox="0 0 24 24"
    fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round"
    aria-hidden="true" focusable="false" data-category={category}>
    {category === 'bullet' ? <>
      <path d="M8 8h6c3 0 5 2 7 4-2 2-4 4-7 4H8Z M11 8v8 M2 9h3 M1 12h4 M2 15h3" />
    </> : category === 'blitz' ? <path d="m14 3-9 10h6l-1 8 9-12h-6Z" />
      : category === 'rapid' ? <>
        <circle cx="12" cy="14" r="7" /><path d="M9 3h6 M12 3v4 M17 7l2-2 M12 10v4l3 2" />
      </> : <path d="M6 3h12 M6 21h12 M7 3v4c0 2 2 3 5 5-3 2-5 3-5 5v4 M17 3v4c0 2-2 3-5 5 3 2 5 3 5 5v4" />}
  </svg>;
}

export function InfoTimeControl({ game }: { game: Pick<GameState, 'timeControl' | 'clockStatus'> }) {
  const value = infoTimeControl(game);
  return <span className="game-info-time-control">
    {value.category && <TimeControlIcon category={value.category} />}
    <span>{value.label}</span>
    {value.category && <small>{timeCategoryLabels[value.category]}</small>}
    {value.pgn && <small aria-label="PGN time control">PGN</small>}
  </span>;
}
