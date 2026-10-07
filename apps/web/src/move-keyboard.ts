export function nextReplaySelection(selectedPly: number | null, moveCount: number,
  direction: -1 | 1, followLive: boolean): number | null {
  const current = Math.max(0, Math.min(moveCount, selectedPly ?? moveCount));
  const next = Math.max(0, Math.min(moveCount, current + direction));
  return followLive && next === moveCount ? null : next;
}

export function isViewingLiveHistory(status: string | undefined, selectedPly: number | null,
  moveCount: number): boolean {
  return status === 'active' && selectedPly !== null && selectedPly < moveCount;
}

export function isEditableKeyTarget(target: EventTarget | null): boolean {
  if (target === null || typeof (target as Element).closest !== 'function') return false;
  return (target as Element).closest('input, textarea, select, [contenteditable]:not([contenteditable="false"]), [role="textbox"]') !== null;
}
