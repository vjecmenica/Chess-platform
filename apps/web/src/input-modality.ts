import { moveNavigationDirection } from './move-keyboard';

export function initializeInputModality() {
  const root = document.documentElement;
  document.addEventListener('pointerdown', () => { root.dataset.pointerInput = ''; }, true);
  document.addEventListener('keydown', event => {
    if (event.altKey || event.ctrlKey || event.metaKey || event.key === 'Shift') return;
    const target = event.target instanceof Element ? event.target : null;
    // Board shortcuts can change the position while focus remains on a pointer-clicked control.
    if (moveNavigationDirection(event) !== null && !target?.closest('.move-link, .board-resize-grip')) return;
    delete root.dataset.pointerInput;
  }, true);
}
