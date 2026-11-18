import type { GameReadResponse, GameSide, RatingDisplay, SettledPlayerRating } from '@chess/contracts';

export type SitePlayerRating = RatingDisplay | SettledPlayerRating;

export function formatRating(value: RatingDisplay | null): string {
  return value === null ? '—' : `${Math.round(value.rating)}${value.provisional ? '?' : ''}`;
}

export function formatRatingChange(value: SettledPlayerRating): string {
  // Keep the shown change equal to the difference between the two shown ratings.
  const change = Math.round(value.after.rating) - Math.round(value.before.rating);
  return change < 0 ? `−${-change}` : `+${change}`;
}

export function gamePlayerRating(game: GameReadResponse, side: GameSide): SitePlayerRating | null {
  const ratings = game.playerRatings;
  if (!ratings || game.status === 'aborted') return null;
  if (game.status === 'finished') return game.rated && ratings.source === 'settlement' ? ratings.players[side] : null;
  return ratings.source === 'current' ? ratings.players[side] : null;
}

export function SiteRating({ value, showChange = true }: { value: SitePlayerRating | null; showChange?: boolean }) {
  const settled = value && 'before' in value ? value : null;
  const rating = value && 'before' in value ? value.before : value;
  const label = rating
    ? `${rating.provisional ? 'Provisional rating' : 'Rating'} ${Math.round(rating.rating)}${settled ? ' before settlement' : ''}`
    : 'Site rating unavailable';
  const change = settled && showChange ? formatRatingChange(settled) : null;
  return <span className="site-rating">
    <span title={label} aria-label={label}>{formatRating(rating)}</span>
    {change !== null && settled && <span className="rating-change"
      data-direction={change === '+0' ? 'neutral' : change.startsWith('+') ? 'positive' : 'negative'}
      title={`Rating after settlement ${formatRating(settled.after)}`}
      aria-label={`Rating change ${change}. Rating after settlement ${formatRating(settled.after)}`}>{change}</span>}
  </span>;
}
