import type { GameSide } from '@chess/contracts';
import { arrowCenter, type BoardArrow } from './board-arrows';

export function BoardArrows({ arrows, orientation }: {
  arrows: readonly BoardArrow[]; orientation: GameSide;
}) {
  return <svg className="board-arrows" viewBox="0 0 800 800" aria-hidden="true" focusable="false">
    <defs><marker id="board-arrow-head" markerWidth="56" markerHeight="52" refX="54" refY="26"
      orient="auto" markerUnits="userSpaceOnUse">
      <path d="M 2 2 L 54 26 L 2 50 L 15 26 Z" />
    </marker></defs>
    {arrows.map((arrow, index) => {
      const start = arrowCenter(arrow.from, orientation);
      const end = arrowCenter(arrow.to, orientation);
      return <line key={`${arrow.from}-${arrow.to}-${index}`} x1={start.x} y1={start.y}
        x2={end.x} y2={end.y} markerEnd="url(#board-arrow-head)" />;
    })}
  </svg>;
}
