import type { GameSide } from '@chess/contracts';
import { arrowCenter, type BoardArrow } from './board-arrows';

export function BoardArrows({ arrows, orientation }: {
  arrows: readonly BoardArrow[]; orientation: GameSide;
}) {
  return <svg className="board-arrows" viewBox="0 0 800 800" aria-hidden="true" focusable="false">
    <defs><marker id="board-arrow-head" markerWidth="18" markerHeight="18" refX="14" refY="9"
      orient="auto" markerUnits="userSpaceOnUse">
      <path d="M 2 2 L 14 9 L 2 16" fill="none" strokeWidth="3" strokeLinecap="round"
        strokeLinejoin="round" />
    </marker></defs>
    {arrows.map((arrow, index) => {
      const start = arrowCenter(arrow.from, orientation);
      const end = arrowCenter(arrow.to, orientation);
      const length = Math.hypot(end.x - start.x, end.y - start.y);
      const x2 = end.x - (end.x - start.x) * 12 / length;
      const y2 = end.y - (end.y - start.y) * 12 / length;
      return <line key={`${arrow.from}-${arrow.to}-${index}`} x1={start.x} y1={start.y}
        x2={x2} y2={y2} markerEnd="url(#board-arrow-head)" />;
    })}
  </svg>;
}
