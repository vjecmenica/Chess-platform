/** Move the floating piece without rerendering the entire game workspace on each pointer event. */
export function advanceDragVisual(
  active: { x: number; y: number; moved: boolean },
  x: number, y: number, overlay: { style: { left: string; top: string } } | null,
): 'idle' | 'started' | 'moved' {
  if (!active.moved && Math.hypot(x - active.x, y - active.y) < 6) return 'idle';
  const started = !active.moved;
  active.moved = true;
  if (overlay !== null) {
    overlay.style.left = `${x}px`;
    overlay.style.top = `${y}px`;
  }
  return started ? 'started' : 'moved';
}
