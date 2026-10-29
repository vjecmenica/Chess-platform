import { expect, it, vi } from 'vitest';
import { STANDARD_STARTING_FEN } from '@chess/domain';
import { EngineCache, EngineController, searchProfile, type EngineWorker } from '../src/engine-analysis';
import { interactiveSearchLimits, scheduleInteractiveEngine } from '../src/interactive-engine';
import { GameReviewRunner } from '../src/game-review';

class Worker implements EngineWorker {
  commands: string[] = [];
  terminated = false;
  onmessage: EngineWorker['onmessage'] = null;
  onerror: EngineWorker['onerror'] = null;
  postMessage(command: string) { this.commands.push(command); }
  terminate() { this.terminated = true; }
  emit(data: string) { this.onmessage?.({ data } as MessageEvent<string>); }
  ready() { this.emit('uciok'); this.emit('readyok'); }
}

it('starts once after development effect replay with interactive limits configured before UCI search', async () => {
  const workers: Worker[] = [];
  const make = () => { const worker = new Worker(); workers.push(worker); return worker; };
  const discarded = new EngineController(make, () => {}, new EngineCache());
  scheduleInteractiveEngine(discarded, STANDARD_STARTING_FEN)();
  const current = new EngineController(make, () => {}, new EngineCache());
  const dispose = scheduleInteractiveEngine(current, STANDARD_STARTING_FEN);
  expect(workers).toHaveLength(0);
  await Promise.resolve();
  expect(workers).toHaveLength(1); workers[0]!.ready();
  expect(workers[0]!.commands).toContain('go depth 25 movetime 15000');
  current.stop(); expect(workers[0]!.terminated).toBe(true);
  current.start(STANDARD_STARTING_FEN); expect(workers).toHaveLength(2);
  dispose(); expect(workers[1]!.terminated).toBe(true);
});

it.each(['cancel', 'fail', 'complete'] as const)('keeps interactive analysis independent when review ends with %s', async outcome => {
  vi.useFakeTimers();
  const cache = new EngineCache(), interactive = new Worker(), review = new Worker();
  const states = vi.fn(), complete = vi.fn(), failure = vi.fn();
  const controller = new EngineController(() => interactive, states, cache);
  const dispose = scheduleInteractiveEngine(controller, STANDARD_STARTING_FEN);
  await Promise.resolve(); interactive.ready();
  const runner = new GameReviewRunner([STANDARD_STARTING_FEN], () => review, cache, () => {}, complete, failure);
  try {
    runner.start(); review.ready();
    expect(review.commands).toContain('go depth 14 movetime 1200');
    expect(interactive.commands).toContain('go depth 25 movetime 15000');
    const before = states.mock.calls.length;
    if (outcome === 'cancel') runner.cancel();
    else if (outcome === 'fail') review.onerror?.({} as ErrorEvent);
    else {
      review.emit('info depth 14 score cp 12 pv e2e4'); review.emit('bestmove e2e4');
      await vi.runAllTimersAsync(); expect(complete).toHaveBeenCalledTimes(1);
      expect(cache.get(STANDARD_STARTING_FEN)).toBeDefined();
      expect(cache.get(STANDARD_STARTING_FEN, 1, searchProfile(interactiveSearchLimits))).toBeUndefined();
    }
    expect(states).toHaveBeenCalledTimes(before);
    expect(interactive.terminated).toBe(false); expect(interactive.commands).not.toContain('stop');
    interactive.emit('info depth 18 score cp 35 pv d2d4');
    expect(states).toHaveBeenLastCalledWith(expect.objectContaining({ kind: 'searching',
      evaluation: expect.objectContaining({ depth: 18 }) }));
  } finally { runner.cancel(); dispose(); vi.useRealTimers(); }
});
