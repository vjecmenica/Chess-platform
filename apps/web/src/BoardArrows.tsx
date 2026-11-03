import type { GameSide } from '@chess/contracts';
import { annotationColors } from './analysis-board';
import { arrowCenter, type BoardArrow } from './board-arrows';
import type { EngineBestMove } from './engine-board';

export function userArrowPath(from: { x: number; y: number }, to: { x: number; y: number }) {
  const length = Math.hypot(to.x - from.x, to.y - from.y);
  if (length === 0) return '';
  const dx = (to.x - from.x) / length, dy = (to.y - from.y) / length;
  const point = (distance: number, offset: number) =>
    `${(from.x + dx * distance - dy * offset).toFixed(2)} ${(from.y + dy * distance + dx * offset).toFixed(2)}`;
  const base = length - 40;
  return `M ${point(0, 10)} L ${point(base, 10)} L ${point(base, 24)} L ${to.x} ${to.y} `
    + `L ${point(base, -24)} L ${point(base, -10)} L ${point(0, -10)} Z`;
}

export function ArrowShape({ from, to, fill }: {
  from: { x: number; y: number }; to: { x: number; y: number }; fill: string;
}) {
  return <path d={userArrowPath(from, to)} fillOpacity=".72" stroke="none" fill={fill} />;
}

export function BoardArrows({ arrows, orientation }: {
  arrows: readonly BoardArrow[]; orientation: GameSide;
}) {
  return <svg className="board-arrows" viewBox="0 0 800 800" aria-hidden="true" focusable="false">
    {arrows.map((arrow, index) => {
      const start = arrowCenter(arrow.from, orientation);
      const end = arrowCenter(arrow.to, orientation);
      return <ArrowShape from={start} to={end} key={`${arrow.from}-${arrow.to}-${index}`}
        fill={arrow.color === undefined || arrow.color === 'orange' ? '#f3b52b' : annotationColors[arrow.color].fill} />;
    })}
  </svg>;
}

export function EngineBestMoveArrow({ move, orientation, threat = false }: { move: EngineBestMove; orientation: GameSide; threat?: boolean }) {
  return <svg className={`board-arrows ${threat ? 'engine-threat-move' : 'engine-best-move'}`} viewBox="0 0 800 800" aria-hidden="true" focusable="false"
    data-from={move.from} data-to={move.to}>
    <ArrowShape from={arrowCenter(move.from, orientation)} to={arrowCenter(move.to, orientation)} fill={threat ? '#dd4941' : '#70bcee'} />
  </svg>;
}
