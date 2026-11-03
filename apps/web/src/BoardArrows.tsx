import type { GameSide } from '@chess/contracts';
import { annotationColors } from './analysis-board';
import { arrowCenter, type BoardArrow } from './board-arrows';
import type { EngineBestMove } from './engine-board';

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

export function userArrowPaths(from: { x: number; y: number }, to: { x: number; y: number }) {
  const length = Math.hypot(to.x - from.x, to.y - from.y);
  if (length === 0) return { shaft: '', head: '' };
  const dx = (to.x - from.x) / length, dy = (to.y - from.y) / length;
  const point = (distance: number, offset: number) =>
    `${(from.x + dx * distance - dy * offset).toFixed(2)} ${(from.y + dy * distance + dx * offset).toFixed(2)}`;
  const base = length - 40;
  return {
    shaft: `M ${point(0, 10)} L ${point(base, 10)} L ${point(base, -10)} L ${point(0, -10)} Z`,
    head: `M ${point(base, 24)} L ${to.x} ${to.y} L ${point(base, -24)} Z`,
  };
}

export function BoardArrows({ arrows, orientation }: {
  arrows: readonly BoardArrow[]; orientation: GameSide;
}) {
  return <svg className="board-arrows" viewBox="0 0 800 800" aria-hidden="true" focusable="false">
    {arrows.map((arrow, index) => {
      const start = arrowCenter(arrow.from, orientation);
      const end = arrowCenter(arrow.to, orientation);
      const paths = userArrowPaths(start, end);
      return <g key={`${arrow.from}-${arrow.to}-${index}`} stroke="none"
        fill={arrow.color === undefined || arrow.color === 'orange' ? '#f3b52b' : annotationColors[arrow.color].fill}>
        <path d={paths.shaft} fillOpacity=".65" />
        <path d={paths.head} />
      </g>;
    })}
  </svg>;
}

export function EngineBestMoveArrow({ move, orientation }: { move: EngineBestMove; orientation: GameSide }) {
  return <svg className="board-arrows engine-best-move" viewBox="0 0 800 800" aria-hidden="true" focusable="false"
    data-from={move.from} data-to={move.to}>
    <path d={arrowPath(arrowCenter(move.from, orientation), arrowCenter(move.to, orientation))} stroke="none" />
  </svg>;
}
