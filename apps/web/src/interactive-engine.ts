import { EngineController, type SearchLimits } from './engine-analysis';

// Review keeps the controller's original single-line depth-14 / 1.2-second profile.
export const interactiveSearchLimits = { mode: 'bounded', depth: 25, timeMs: 15_000 } as const satisfies SearchLimits;

/** Configure before opening a worker; a discarded development effect never starts it. */
export function scheduleInteractiveEngine(controller: EngineController, fen: string) {
  let cancelled = false;
  controller.setSearchLimits(interactiveSearchLimits);
  queueMicrotask(() => { if (!cancelled) controller.start(fen); });
  return () => { cancelled = true; controller.dispose(); };
}
