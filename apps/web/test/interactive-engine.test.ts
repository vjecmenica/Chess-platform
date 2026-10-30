import { expect, it, vi } from 'vitest';
import { STANDARD_STARTING_FEN } from '@chess/domain';
import { EngineCache, EngineController, searchCommand, searchProfile, type EngineWorker } from '../src/engine-analysis';
import { createInteractiveSettings, interactiveSearchLimits, scheduleInteractiveEngine,
  toggleContinuousSettings, updateInteractiveSettings, updateDepthSlider, updateTimeSlider } from '../src/interactive-engine';
import { interactiveLimits } from '../src/EnginePanel';
import { GameReviewRunner } from '../src/game-review';
import { buildGameReview, type GameReview } from '../src/game-review';
import { publishReviewState, type ReviewState } from '../src/EnginePanel';
import { importPgn } from '../src/pgn-import';
import { MoveTree } from '../src/MoveTree';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';

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

function settingsCommand(state: ReturnType<typeof createInteractiveSettings>): string {
  return searchCommand(interactiveLimits(state.current.unlimitedDepth ? null : state.current.depth,
    state.current.unlimitedTime ? null : state.current.timeMs));
}

it('retains every finite slider value and uses a distinct final position for each unlimited limit', () => {
  for (let depth = 1; depth <= 40; depth++)
    expect(settingsCommand(updateDepthSlider(createInteractiveSettings(), depth)))
      .toBe(`go depth ${depth} movetime 15000`);
  for (let time = 200; time <= 30_000; time += 100)
    expect(settingsCommand(updateTimeSlider(createInteractiveSettings(), time)))
      .toBe(`go depth 25 movetime ${time}`);
  const maximum = updateTimeSlider(updateDepthSlider(createInteractiveSettings(), 40), 30_000);
  expect(settingsCommand(maximum)).toBe('go depth 40 movetime 30000');
  expect(settingsCommand(updateDepthSlider(maximum, 41))).toBe('go movetime 30000');
  expect(settingsCommand(updateTimeSlider(maximum, 30_100))).toBe('go depth 40');
  const infinite = updateTimeSlider(updateDepthSlider(maximum, 41), 30_100);
  expect(settingsCommand(infinite)).toBe('go infinite');
  // One step left from either endpoint restores that finite maximum immediately.
  expect(settingsCommand(updateDepthSlider(infinite, 40))).toBe('go depth 40');
  expect(settingsCommand(updateTimeSlider(infinite, 30_000))).toBe('go movetime 30000');
  expect(settingsCommand(updateTimeSlider(updateDepthSlider(infinite, 40), 30_000)))
    .toBe('go depth 40 movetime 30000');
  for (const depth of [0, 42, 40.5, NaN]) expect(() => updateDepthSlider(maximum, depth)).toThrow(RangeError);
  for (const time of [0, 30_200, 30_050, NaN]) expect(() => updateTimeSlider(maximum, time)).toThrow(RangeError);
});

it('synchronizes the + shortcut with endpoint edits and restores the last bounded combination', () => {
  const bounded = updateTimeSlider(updateDepthSlider(createInteractiveSettings(), 40), 30_000);
  let state = toggleContinuousSettings(bounded);
  expect(settingsCommand(state)).toBe('go infinite');
  state = toggleContinuousSettings(state);
  expect(state.current).toEqual(bounded.current);
  state = updateDepthSlider(state, 41);
  expect(settingsCommand(state)).toBe('go movetime 30000');
  // Both sliders at their endpoints activate the same state as the + button.
  state = updateTimeSlider(state, 30_100);
  expect(settingsCommand(state)).toBe('go infinite');
  state = toggleContinuousSettings(state);
  expect(settingsCommand(state)).toBe('go movetime 30000');
  // A finite edit also exits continuous mode without changing the other limit.
  state = updateTimeSlider(toggleContinuousSettings(state), 700);
  expect(settingsCommand(state)).toBe('go movetime 700');
  state = toggleContinuousSettings(toggleContinuousSettings(state));
  expect(settingsCommand(state)).toBe('go movetime 700');
});

it('runs continuously without the old time limit and restores the exact bounded profile', () => {
  let settings = createInteractiveSettings();
  settings = updateInteractiveSettings(settings, { depth: 18, timeMs: 2400,
    unlimitedDepth: false, unlimitedTime: false });
  const states = vi.fn(), worker = new Worker();
  const controller = new EngineController(() => worker, states, new EngineCache());
  const apply = () => controller.setSearchLimits(interactiveLimits(
    settings.current.unlimitedDepth ? null : settings.current.depth,
    settings.current.unlimitedTime ? null : settings.current.timeMs));
  apply(); controller.start(STANDARD_STARTING_FEN); worker.ready();
  expect(worker.commands.at(-1)).toBe('go depth 18 movetime 2400');
  settings = toggleContinuousSettings(settings); apply();
  expect(settings.current).toMatchObject({ unlimitedDepth: true, unlimitedTime: true });
  expect(worker.commands.at(-1)).toBe('stop');
  worker.emit('bestmove e2e4'); worker.emit('readyok');
  expect(worker.commands.at(-1)).toBe('go infinite');
  worker.emit('info depth 28 score cp 20 pv e2e4');
  expect(states.mock.lastCall?.[0]).toMatchObject({ kind: 'searching', evaluation: { depth: 28 } });
  settings = toggleContinuousSettings(settings); apply();
  worker.emit('bestmove e2e4'); worker.emit('readyok');
  expect(worker.commands.at(-1)).toBe('go depth 18 movetime 2400');
  expect(settings.current).toEqual({ depth: 18, timeMs: 2400,
    unlimitedDepth: false, unlimitedTime: false });
  controller.dispose();
});

it('synchronizes popover edits with continuous mode and remembers partially bounded limits', () => {
  let settings = createInteractiveSettings();
  settings = updateInteractiveSettings(settings, { depth: 22, timeMs: 3700,
    unlimitedDepth: true, unlimitedTime: false });
  settings = toggleContinuousSettings(settings);
  settings = toggleContinuousSettings(settings);
  expect(settings.current).toEqual({ depth: 22, timeMs: 3700,
    unlimitedDepth: true, unlimitedTime: false });
  // Making both limits unlimited uses the same continuous mode as the shortcut.
  settings = updateInteractiveSettings(settings, { ...settings.current, unlimitedTime: true });
  settings = toggleContinuousSettings(settings);
  expect(settings.current.unlimitedTime).toBe(false);
  settings = toggleContinuousSettings(settings);
  // A finite popover edit exits continuous mode and becomes the next restore target.
  settings = updateInteractiveSettings(settings, { ...settings.current, depth: 16, unlimitedDepth: false });
  settings = toggleContinuousSettings(toggleContinuousSettings(settings));
  expect(settings.current).toEqual({ depth: 16, timeMs: 3700,
    unlimitedDepth: false, unlimitedTime: true });
});

it('can stop and restart interactive evaluation while the independent review worker keeps running', async () => {
  vi.useFakeTimers();
  const workers: Worker[] = [];
  const controller = new EngineController(() => {
    const worker = new Worker(); workers.push(worker); return worker;
  }, () => {}, new EngineCache());
  const reviewWorker = new Worker(), complete = vi.fn();
  const runner = new GameReviewRunner([STANDARD_STARTING_FEN], () => reviewWorker,
    new EngineCache(), () => {}, complete, () => {});
  const dispose = scheduleInteractiveEngine(controller, STANDARD_STARTING_FEN);
  try {
    await Promise.resolve(); workers[0]!.ready();
    runner.start(); reviewWorker.ready();
    controller.stop();
    expect(workers[0]!.terminated).toBe(true);
    expect(reviewWorker.terminated).toBe(false);
    controller.start(STANDARD_STARTING_FEN); workers[1]!.ready();
    expect(workers[1]!.commands).toContain('go depth 25 movetime 15000');
    reviewWorker.emit('info depth 14 score cp 20 pv e2e4');
    reviewWorker.emit('bestmove e2e4');
    await vi.runAllTimersAsync();
    expect(complete).toHaveBeenCalledOnce();
    expect(workers[1]!.terminated).toBe(false);
  } finally { runner.cancel(); dispose(); vi.useRealTimers(); }
});

it('keeps the panel report and parent move annotations consistent across restart, cancel, failure and completion', async () => {
  const game = importPgn('[Result "1-0"]\n\n1. e4 e5 1-0', 'lifecycle').game;
  const evaluation = (fen: string, cp: number) => ({ fen, depth: 14,
    score: { kind: 'cp' as const, value: cp }, bestMove: null, variation: [] });
  const report = (cp: number) => buildGameReview(game, [
    evaluation(game.history[0]!.beforeFen, cp),
    ...game.history.map(move => evaluation(move.afterFen, 0)),
  ]);
  let panel: ReviewState = { kind: 'idle' };
  let parent: GameReview | null = null;
  const transition = (next: ReviewState) => publishReviewState(next,
    state => { panel = state; }, review => { parent = review; });
  const annotations = () => renderToStaticMarkup(createElement(MoveTree, { game, tree: null,
    selected: { kind: 'main', ply: 2 }, interactive: true, review: parent,
    onSelect: () => {}, onDelete: () => {} }));
  const worker = new Worker(), interactiveStates = vi.fn();
  const engine = new EngineController(() => worker, interactiveStates, new EngineCache());
  const dispose = scheduleInteractiveEngine(engine, STANDARD_STARTING_FEN);
  await Promise.resolve(); worker.ready();
  const before = interactiveStates.mock.calls.length;
  try {
    for (const ending of [{ kind: 'cancelled' }, { kind: 'error', message: 'Worker failed' }] as const) {
      transition({ kind: 'complete', review: report(400) });
      expect(annotations()).toContain('Engine: Blunder');
      transition({ kind: 'running', progress: { completed: 0, total: 3, cached: 0 } });
      expect(parent).toBeNull(); expect(panel.kind).toBe('running');
      expect(annotations()).not.toContain('Engine:');
      transition(ending);
      expect(parent).toBeNull(); expect(panel.kind).toBe(ending.kind);
      expect(annotations()).not.toContain('Engine:');
    }
    const replacement = report(100);
    transition({ kind: 'complete', review: replacement });
    expect(parent).toBe(replacement); expect(panel.kind).toBe('complete');
    expect(annotations()).toContain('Engine: Inaccuracy');
    expect(annotations()).not.toContain('Engine: Blunder');
    expect(worker.terminated).toBe(false); expect(worker.commands).not.toContain('stop');
    expect(interactiveStates).toHaveBeenCalledTimes(before);
  } finally { dispose(); }
});

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
