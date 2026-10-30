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

// The last slot is a sentinel, never a depth or time value sent to Stockfish.
export const depthSlider = { min: 1, finiteMax: 40, max: 41, step: 1 } as const;
export const timeSlider = { min: 200, finiteMax: 30_000, max: 30_100, step: 100 } as const;

function sliderLimit(value: number, range: { min: number; finiteMax: number; max: number; step: number }): number | null {
  if (value === range.max) return null;
  if (!Number.isInteger(value) || value < range.min || value > range.finiteMax
    || (value - range.min) % range.step !== 0) throw new RangeError('Invalid search slider value.');
  return value;
}

export function updateDepthSlider(state: InteractiveSettingsState, value: number): InteractiveSettingsState {
  const limit = sliderLimit(value, depthSlider);
  return updateInteractiveSettings(state, { ...state.current,
    depth: limit ?? state.current.depth, unlimitedDepth: limit === null });
}

export function updateTimeSlider(state: InteractiveSettingsState, value: number): InteractiveSettingsState {
  const limit = sliderLimit(value, timeSlider);
  return updateInteractiveSettings(state, { ...state.current,
    timeMs: limit ?? state.current.timeMs, unlimitedTime: limit === null });
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
export function scheduleInteractiveEngine(controller: EngineController, fen: string,
  limits: SearchLimits = interactiveSearchLimits, enabled = true) {
  let cancelled = false;
  controller.setSearchLimits(limits);
  queueMicrotask(() => { if (!cancelled && enabled) controller.start(fen); });
  return () => { cancelled = true; controller.dispose(); };
}
