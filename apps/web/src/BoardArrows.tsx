import type { GameSide } from '@chess/contracts';
import { arrowCenter, type BoardArrow } from './board-arrows';

export function BoardArrows({ arrows, orientation }: {
  arrows: readonly BoardArrow[]; orientation: GameSide;
}) {
  return <svg className="board-arrows" viewBox="0 0 800 800" aria-hidden="true" focusable="false">
    <defs><marker id="board-arrow-head" markerWidth="38" markerHeight="34" refX="34" refY="17"
      orient="auto" markerUnits="userSpaceOnUse">
      <path d="M 2 2 L 34 17 L 2 32 L 10 17 Z" />
    </marker></defs>
    {arrows.map((arrow, index) => {
      const start = arrowCenter(arrow.from, orientation);
      const end = arrowCenter(arrow.to, orientation);
      const length = Math.hypot(end.x - start.x, end.y - start.y);
      const x2 = end.x - (end.x - start.x) * 10 / length;
      const y2 = end.y - (end.y - start.y) * 10 / length;
      return <line key={`${arrow.from}-${arrow.to}-${index}`} x1={start.x} y1={start.y}
        x2={x2} y2={y2} markerEnd="url(#board-arrow-head)" />;
    })}
  </svg>;
}
