import type { GameSide } from '@chess/contracts';
import { arrowCenter, type BoardArrow } from './board-arrows';

export function arrowPath(from: { x: number; y: number }, to: { x: number; y: number }): string {
  const length = Math.hypot(to.x - from.x, to.y - from.y);
  if (length === 0) return '';
  const forward = { x: (to.x - from.x) / length, y: (to.y - from.y) / length };
  const side = { x: -forward.y, y: forward.x };
  const point = (distance: number, offset: number) =>
    `${(from.x + forward.x * distance + side.x * offset).toFixed(2)} `
    + `${(from.y + forward.y * distance + side.y * offset).toFixed(2)}`;
  const tip = `${to.x} ${to.y}`;
  return `M ${point(0, 6)} L ${point(length - 39, 6)} `
    + `L ${point(length - 52, 24)} L ${tip} `
    + `L ${point(length - 52, -24)} L ${point(length - 39, -6)} `
    + `L ${point(0, -6)} Q ${point(-12, 0)} ${point(0, 6)} Z`;
}

export function BoardArrows({ arrows, orientation }: {
  arrows: readonly BoardArrow[]; orientation: GameSide;
}) {
  return <svg className="board-arrows" viewBox="0 0 800 800" aria-hidden="true" focusable="false">
    {arrows.map((arrow, index) => {
      const start = arrowCenter(arrow.from, orientation);
      const end = arrowCenter(arrow.to, orientation);
      return <path key={`${arrow.from}-${arrow.to}-${index}`} d={arrowPath(start, end)} stroke="none" />;
    })}
  </svg>;
}
