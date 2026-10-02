import { describe, expect, it } from 'vitest';
import { EngineCache, EngineController, evaluationLabel, parseSearchInfo, variationSan,
  type EngineState, type EngineStorage, type EngineWorker } from '../src/engine-analysis';

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
  it('parses UCI output and presents a legal SAN line from the selected position', () => {
    expect(parseSearchInfo('info depth 14 score mate -2 nodes 30 pv e7e5 g1f3'))
      .toEqual({ depth: 14, score: { kind: 'mate', value: -2 }, pv: ['e7e5', 'g1f3'] });
    expect(parseSearchInfo('info depth 0 score mate 0')).toEqual({ depth: 0,
      score: { kind: 'mate', value: 0 }, pv: [] });
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
});
