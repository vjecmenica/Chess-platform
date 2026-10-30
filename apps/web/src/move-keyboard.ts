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
  return (target as Element).closest('input, textarea, select, [contenteditable]:not([contenteditable="false"]), '
    + '[role="textbox"], [role="slider"], [role="spinbutton"], [role="combobox"], [role="listbox"], '
    + '[role="menu"], [role="menubar"], [role="tree"], [role="grid"], [role="tablist"], [role="radiogroup"]') !== null;
}

/** Ordinary panel buttons leave horizontal arrows to the window's move navigation. */
export function moveNavigationDirection(event: Pick<KeyboardEvent,
  'key' | 'defaultPrevented' | 'altKey' | 'ctrlKey' | 'metaKey' | 'shiftKey' | 'target'>): -1 | 1 | null {
  if (event.defaultPrevented || event.altKey || event.ctrlKey || event.metaKey || event.shiftKey
    || isEditableKeyTarget(event.target)) return null;
  return event.key === 'ArrowLeft' ? -1 : event.key === 'ArrowRight' ? 1 : null;
}
