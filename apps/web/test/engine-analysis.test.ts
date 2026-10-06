import { describe, expect, it } from 'vitest';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import type { GameReadResponse } from '@chess/contracts';
import { EngineCache, EngineController, evaluationLabel, parseSearchInfo, searchCommand,
  searchProfile, variationSan,
  type EngineState, type EngineStorage, type EngineWorker } from '../src/engine-analysis';
import { candidateLines, EnginePanel, interactiveLimits } from '../src/EnginePanel';

const start = 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1';
const afterE4 = 'rnbqkbnr/pppppppp/8/8/4P3/8/PPPP1PPP/RNBQKBNR b KQkq - 0 1';

class FakeWorker implements EngineWorker {
  readonly commands: string[] = [];
  terminated = false;
  onmessage: ((event: MessageEvent<string>) => void) | null = null;
  onerror: ((event: ErrorEvent) => void) | null = null;
  postMessage(message: string) { this.commands.push(message); }
  terminate() { this.terminated = true; }
  emit(message: string) { this.onmessage?.({ data: message } as MessageEvent<string>); }
  fail() { this.onerror?.({} as ErrorEvent); }
}

function setup(storage?: EngineStorage) {
  const workers: FakeWorker[] = [];
  const states: EngineState[] = [];
  const cache = new EngineCache(storage);
  const engine = new EngineController(() => {
    const worker = new FakeWorker();
    workers.push(worker);
    return worker;
  }, state => states.push(state), cache);
  return { workers, states, engine, cache };
}

function ready(worker: FakeWorker) {
  worker.emit('uciok');
  worker.emit('readyok');
}

function finish(worker: FakeWorker, pv = 'e2e4 e7e5 g1f3') {
  worker.emit(`info depth 12 seldepth 18 score cp 34 nodes 2000 pv ${pv}`);
  worker.emit(`bestmove ${pv.split(' ')[0]}`);
}

describe('browser Stockfish controller', () => {
  it('shows bounded interactive controls without changing the review budget', () => {
    const game = { id: 'test', status: 'finished', history: [], position: { fen: start,
      sideToMove: 'white' }, result: { outcome: 'draw', reason: 'agreement' } } as GameReadResponse;
    const html = renderToStaticMarkup(createElement(EnginePanel, { game, fen: start,
      selectedPly: 0, onSelectPly: () => {}, onReviewChange: () => {},
      onEvaluationChange: () => {} }));
    expect(html).toContain('Depth and time');
    expect(html).toContain('Depth only');
    expect(html).toContain('Time only');
    expect(html).toContain('Unlimited');
    expect(html).toContain('Candidate lines');
    expect(html).toContain('Start engine');
    expect(html).not.toContain('More lines share the 1.2-second search budget');
  });

  it('uses the first depth or time limit and requires explicit infinite mode', () => {
    expect(searchCommand(interactiveLimits('both', 18, 2400))).toBe('go depth 18 movetime 2400');
    expect(searchCommand(interactiveLimits('depth', 18, 2400))).toBe('go depth 18');
    expect(searchCommand(interactiveLimits('time', 18, 2400))).toBe('go movetime 2400');
    expect(searchCommand(interactiveLimits('infinite', 18, 2400))).toBe('go infinite');
    expect(() => searchCommand({ mode: 'bounded', depth: null, timeMs: null })).toThrow();
    expect(searchProfile(interactiveLimits('both', 14, 1200))).toBe('default');
  });

  it('restarts with the latest limits, ignores replaced output, and separates cache profiles', () => {
    const { engine, workers, states, cache } = setup();
    engine.setSearchLimits(interactiveLimits('depth', 18, 1200));
    engine.start(start);
    const worker = workers[0]!;
    ready(worker);
    expect(worker.commands.at(-1)).toBe('go depth 18');
    engine.setSearchLimits(interactiveLimits('time', 18, 2400));
    expect(worker.commands.at(-1)).toBe('stop');
    worker.emit('info depth 18 score cp 88 pv e2e4');
    worker.emit('bestmove e2e4');
    expect(states.some(state => state.kind === 'done')).toBe(false);
    worker.emit('readyok');
    expect(worker.commands.at(-1)).toBe('go movetime 2400');
    finish(worker);
    expect(cache.get(start, 1)).toBeUndefined();
    expect(cache.get(start, 1, searchProfile(interactiveLimits('time', 18, 2400))))
      .toMatchObject({ bestMove: 'e2e4' });
    engine.setSearchLimits(interactiveLimits('both', 14, 1200));
    expect(worker.commands.at(-1)).toBe('isready');
    worker.emit('readyok');
    expect(worker.commands.at(-1)).toBe('go depth 14 movetime 1200');
  });

  it('streams coherent infinite output and drops it after stop, position change, or disposal', () => {
    const { engine, workers, states } = setup();
    engine.setLineCount(2);
    engine.setSearchLimits({ mode: 'infinite' });
    engine.start(start);
    const worker = workers[0]!;
    ready(worker);
    expect(worker.commands.at(-1)).toBe('go infinite');
    worker.emit('info depth 10 multipv 1 score cp 22 pv e2e4');
    worker.emit('info depth 10 multipv 2 score cp 10 pv d2d4');
    expect(states.at(-1)).toMatchObject({ kind: 'searching', evaluation: { depth: 10,
      lines: [{ rank: 1 }, { rank: 2 }] } });
    engine.setPosition(afterE4);
    const count = states.length;
    worker.emit('info depth 11 multipv 1 score cp 99 pv e2e4');
    expect(states).toHaveLength(count);
    worker.emit('bestmove e2e4'); worker.emit('readyok');
    expect(worker.commands.at(-1)).toBe('go infinite');
    worker.emit('info depth 4 multipv 1 score cp -32 pv e7e5');
    expect(states.at(-1)).toMatchObject({ kind: 'searching', evaluation: { fen: afterE4 } });
    engine.stop();
    expect(worker.terminated).toBe(true);
    const stoppedCount = states.length;
    worker.emit('info depth 20 score cp 999 pv e7e5');
    expect(states).toHaveLength(stoppedCount);
    engine.start(afterE4);
    const replacement = workers[1]!;
    engine.dispose();
    replacement.emit('uciok');
    expect(replacement.terminated).toBe(true);
  });

  it('parses UCI output and presents a legal SAN line from the selected position', () => {
    expect(parseSearchInfo('info depth 14 score mate -2 nodes 30 pv e7e5 g1f3'))
      .toEqual({ depth: 14, rank: 1, score: { kind: 'mate', value: -2 }, pv: ['e7e5', 'g1f3'] });
    expect(parseSearchInfo('info depth 0 score mate 0')).toEqual({ depth: 0,
      rank: 1, score: { kind: 'mate', value: 0 }, pv: [] });
    expect(parseSearchInfo('info depth 12 multipv 3 score cp -51 pv g1f3'))
      .toEqual({ depth: 12, rank: 3, score: { kind: 'cp', value: -51 }, pv: ['g1f3'] });
    expect(parseSearchInfo('info depth 14 score cp 20 upperbound pv e2e4')).toBeNull();
    expect(variationSan(start, ['e2e4', 'e7e5', 'g1f3'])).toEqual(['e4', 'e5', 'Nf3']);
    expect(variationSan(start, ['e2e4', 'a1a8'])).toEqual(['e4']);
    expect(evaluationLabel({ fen: afterE4, depth: 12, score: { kind: 'cp', value: 34 },
      bestMove: 'e7e5', variation: ['e7e5'] })).toBe('-0.34');
  });

  it('searches only on demand and caches a completed evaluation across controller instances', () => {
    const saved = new Map<string, string>();
    const storage = { getItem: (key: string) => saved.get(key) ?? null,
      setItem: (key: string, value: string) => { saved.set(key, value); } };
    const first = setup(storage);
    expect(first.workers).toHaveLength(0);
    first.engine.start(start);
    expect(first.workers[0]?.commands).toEqual(['uci']);
    ready(first.workers[0]!);
    expect(first.workers[0]?.commands).toContain(`position fen ${start}`);
    expect(first.workers[0]?.commands).toContain('go depth 14 movetime 1200');
    finish(first.workers[0]!);
    expect(first.states.at(-1)).toMatchObject({ kind: 'done', cached: false,
      evaluation: { bestMove: 'e2e4', score: { kind: 'cp', value: 34 } } });
    first.engine.stop();
    expect(first.workers[0]?.terminated).toBe(true);
    const second = setup(storage);
    second.engine.start(start);
    expect(second.workers).toHaveLength(0);
    expect(second.states.at(-1)).toMatchObject({ kind: 'done', cached: true });
  });

  it('discards a stopped position and waits for its bestmove before starting the new one', () => {
    const { engine, workers, states } = setup();
    engine.start(start);
    const worker = workers[0]!;
    ready(worker);
    worker.emit('info depth 4 score cp 20 pv e2e4');
    engine.setPosition(afterE4);
    expect(worker.commands.at(-1)).toBe('stop');
    engine.setPosition(start);
    engine.setPosition(afterE4);
    worker.emit('info depth 14 score cp 99 pv e2e4');
    worker.emit('bestmove e2e4');
    expect(worker.commands.at(-1)).toBe('isready');
    expect(states.some(state => state.kind === 'done')).toBe(false);
    worker.emit('readyok');
    expect(worker.commands.slice(-2)).toEqual([`position fen ${afterE4}`, 'go depth 14 movetime 1200']);
    finish(worker, 'e7e5 g1f3');
    expect(states.at(-1)).toMatchObject({ kind: 'done', evaluation: { fen: afterE4,
      bestMove: 'e7e5' } });
  });

  it('stops and terminates the worker, and reports load and runtime failures', () => {
    const first = setup();
    first.engine.start(start);
    first.workers[0]!.fail();
    expect(first.states.at(-1)?.kind).toBe('error');
    expect(first.workers[0]?.terminated).toBe(true);
    first.engine.start(start);
    expect(first.workers).toHaveLength(2);
    first.engine.stop();
    expect(first.workers[1]?.terminated).toBe(true);
    expect(first.states.at(-1)).toEqual({ kind: 'off' });
    first.engine.start(start);
    const stateCount = first.states.length;
    first.engine.dispose();
    expect(first.workers[2]?.terminated).toBe(true);
    first.workers[2]?.emit('uciok');
    expect(first.states).toHaveLength(stateCount);
    const states: EngineState[] = [];
    const broken = new EngineController(() => { throw new Error('worker unavailable'); },
      state => states.push(state), new EngineCache());
    broken.start(start);
    expect(states.at(-1)?.kind).toBe('error');
  });

  it('groups MultiPV ranks at one complete depth and presents legal White-perspective lines', () => {
    const { engine, workers, states } = setup();
    engine.setLineCount(2);
    engine.start(afterE4);
    const worker = workers[0]!;
    ready(worker);
    expect(worker.commands).toContain('setoption name MultiPV value 2');
    worker.emit('info depth 10 multipv 1 score cp 32 pv e7e5 g1f3');
    worker.emit('info depth 10 multipv 2 score mate -3 pv c7c5 g1f3');
    worker.emit('info depth 11 multipv 1 score cp 45 pv e7e5');
    worker.emit('bestmove e7e5');
    const completed = states.at(-1);
    expect(completed).toMatchObject({ kind: 'done', evaluation: { depth: 10,
      lines: [{ rank: 1, score: { kind: 'cp', value: 32 } },
        { rank: 2, score: { kind: 'mate', value: -3 } }] } });
    if (completed?.kind !== 'done') throw new Error('Expected completed search.');
    expect(candidateLines(completed.evaluation)).toEqual([
      { rank: 1, score: '-0.32', san: ['e5', 'Nf3'] },
      { rank: 2, score: 'Mate +3', san: ['c5', 'Nf3'] },
    ]);
  });

  it('cancels old settings and keeps each line count in a separate cache entry', () => {
    const saved = new Map<string, string>();
    const storage = { getItem: (key: string) => saved.get(key) ?? null,
      setItem: (key: string, value: string) => { saved.set(key, value); } };
    const { engine, workers, states, cache } = setup(storage);
    engine.start(start);
    const worker = workers[0]!;
    ready(worker);
    engine.setLineCount(2);
    expect(worker.commands.at(-1)).toBe('stop');
    worker.emit('info depth 12 score cp 99 pv e2e4');
    worker.emit('bestmove e2e4');
    worker.emit('readyok');
    expect(worker.commands.slice(-3)).toEqual(['setoption name MultiPV value 2',
      `position fen ${start}`, 'go depth 14 movetime 1200']);
    worker.emit('info depth 8 multipv 1 score cp 34 pv e2e4 e7e5');
    worker.emit('info depth 8 multipv 2 score cp 17 pv d2d4 d7d5');
    worker.emit('bestmove e2e4');
    expect(states.at(-1)?.kind).toBe('done');
    expect(cache.get(start, 1)).toBeUndefined();
    expect(cache.get(start, 2)?.lines).toHaveLength(2);
    expect(new EngineCache(storage).get(start, 2)?.lines).toHaveLength(2);
    engine.setLineCount(1);
    expect(states.at(-1)?.kind).toBe('searching');
    expect(worker.commands.at(-1)).toBe('isready');
  });

  it('keeps only usable ranks from incomplete engine output', () => {
    const saved = new Map<string, string>();
    const storage = { getItem: (key: string) => saved.get(key) ?? null,
      setItem: (key: string, value: string) => { saved.set(key, value); } };
    const { engine, workers, states } = setup(storage);
    engine.setLineCount(3);
    engine.start(start);
    const worker = workers[0]!;
    ready(worker);
    worker.emit('info depth 7 multipv 1 score mate 2 pv e2e4');
    worker.emit('info depth 7 multipv 2 score cp 10 pv d2d4');
    worker.emit('info depth 8 multipv 2 score cp 20 pv d2d4');
    worker.emit('bestmove e2e4');
    expect(states.at(-1)).toMatchObject({ kind: 'done', evaluation: {
      depth: 7, score: { kind: 'mate', value: 2 }, lines: [{ rank: 1 }, { rank: 2 }],
    } });
    expect(new EngineCache(storage).get(start, 3)?.lines).toHaveLength(2);
  });
});
