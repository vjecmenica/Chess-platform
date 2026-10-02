import type { GameSide } from '@chess/contracts';
import type { Square } from './board-model';

export interface BoardArrow { from: Square; to: Square }

export function toggleArrow(arrows: readonly BoardArrow[], from: Square, to: Square): BoardArrow[] {
  if (from === to) return [...arrows];
  const exists = arrows.some(arrow => arrow.from === from && arrow.to === to);
  return exists ? arrows.filter(arrow => arrow.from !== from || arrow.to !== to)
    : [...arrows, { from, to }];
}

export function arrowCenter(square: Square, orientation: GameSide): { x: number; y: number } {
  const file = square.charCodeAt(0) - 'a'.charCodeAt(0);
  const rank = Number(square[1]) - 1;
  return orientation === 'white' ? { x: file * 100 + 50, y: (7 - rank) * 100 + 50 }
    : { x: (7 - file) * 100 + 50, y: rank * 100 + 50 };
}
