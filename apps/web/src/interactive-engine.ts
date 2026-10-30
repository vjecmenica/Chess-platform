import { EngineController, type SearchLimits } from './engine-analysis';

// Review keeps the controller's original single-line depth-14 / 1.2-second profile.
export const interactiveSearchLimits = { mode: 'bounded', depth: 25, timeMs: 15_000 } as const satisfies SearchLimits;

export interface InteractiveSettings {
  readonly depth: number;
  readonly timeMs: number;
  readonly unlimitedDepth: boolean;
  readonly unlimitedTime: boolean;
}

export interface InteractiveSettingsState {
  readonly current: InteractiveSettings;
  readonly bounded: InteractiveSettings;
}

export function createInteractiveSettings(): InteractiveSettingsState {
  const current = { depth: interactiveSearchLimits.depth, timeMs: interactiveSearchLimits.timeMs,
    unlimitedDepth: false, unlimitedTime: false };
  return { current, bounded: current };
}

export function updateInteractiveSettings(state: InteractiveSettingsState,
  current: InteractiveSettings): InteractiveSettingsState {
  return { current, bounded: current.unlimitedDepth && current.unlimitedTime ? state.bounded : current };
}

export function toggleContinuousSettings(state: InteractiveSettingsState): InteractiveSettingsState {
  return updateInteractiveSettings(state, state.current.unlimitedDepth && state.current.unlimitedTime
    ? state.bounded : { ...state.current, unlimitedDepth: true, unlimitedTime: true });
}

/** Configure before opening a worker; a discarded development effect never starts it. */
export function scheduleInteractiveEngine(controller: EngineController, fen: string) {
  let cancelled = false;
  controller.setSearchLimits(interactiveSearchLimits);
  queueMicrotask(() => { if (!cancelled) controller.start(fen); });
  return () => { cancelled = true; controller.dispose(); };
}
