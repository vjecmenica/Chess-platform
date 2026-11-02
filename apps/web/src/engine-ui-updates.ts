import type { EngineState } from './engine-analysis';

/** Coalesce rank-by-rank UCI bursts without delaying lifecycle transitions or retaining stale output. */
export function createEngineStatePublisher(publish: (state: EngineState) => void,
  request: (callback: FrameRequestCallback) => number = requestAnimationFrame,
  cancel: (id: number) => void = cancelAnimationFrame) {
  let frame: number | null = null;
  let latest: EngineState | null = null;
  const clear = () => { if (frame !== null) cancel(frame); frame = null; latest = null; };
  return {
    push(state: EngineState) {
      if (state.kind !== 'searching') { clear(); publish(state); return; }
      latest = state;
      if (frame === null) frame = request(() => {
        frame = null; const next = latest; latest = null; if (next) publish(next);
      });
    },
    cancel: clear,
  };
}
