import { createContext } from 'react';

export const MovesVisible = createContext(true);

/** Move only far enough to keep the selection inside a buffered viewport. */
export function moveListScrollTop(scrollTop: number, clientHeight: number, scrollHeight: number,
  moveTop: number, moveHeight: number, rowHeight: number): number {
  const spareHeight = clientHeight - moveHeight;
  if (spareHeight < 0) {
    // A tall move comment may extend beyond the viewport. Keep the SAN in view.
    return Math.max(0, Math.min(scrollHeight - clientHeight, scrollTop + moveTop));
  }
  const margin = Math.min(3.5 * rowHeight, spareHeight / 2);
  const moveBottom = moveTop + moveHeight;
  const delta = moveTop < margin ? moveTop - margin
    : moveBottom > clientHeight - margin ? moveBottom - clientHeight + margin : 0;
  return Math.max(0, Math.min(scrollHeight - clientHeight, scrollTop + delta));
}
