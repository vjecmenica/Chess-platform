import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { STANDARD_STARTING_FEN } from '@chess/domain';
import { createBrowserEngineWorker } from '../src/browser-engine-worker';
import { EngineCache, EngineController, type EngineState } from '../src/engine-analysis';
import { fullEngine } from '../src/engine-builds';

function setup() {
  const raw = { postMessage: vi.fn(), terminate: vi.fn(), onmessage: null as Worker['onmessage'], onerror: null as Worker['onerror'] };
  const channel = { port1: { onmessage: null as MessagePort['onmessage'], close: vi.fn() }, port2: { close: vi.fn() } };
  const make = vi.fn(() => raw as unknown as Worker);
  const states: EngineState[] = [];
  const worker = createBrowserEngineWorker(fullEngine.url, make, () => channel as unknown as MessageChannel);
  const controller = new EngineController(() => worker, state => states.push(state), new EngineCache(), { threads: 2 });
  const emit = (data: string) => raw.onmessage?.call(raw as unknown as Worker, { data } as MessageEvent<string>);
  return { raw, channel, make, states, worker, controller, emit };
}
beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());

it('reports real progress and configures bounded threads before searching', () => {
  const { raw, channel, make, states, controller, emit } = setup();
  expect(make).toHaveBeenCalledWith('/engine/stockfish-19.0.0/stockfish-19.js');
  expect(raw.postMessage).toHaveBeenCalledWith({ progressPort: channel.port2 }, [channel.port2]);
  controller.start(STANDARD_STARTING_FEN);
  channel.port1.onmessage?.call(channel.port1 as unknown as MessagePort, { data: { percent: 0.42 } } as MessageEvent);
  expect(states.at(-1)).toEqual({ kind: 'loading', progress: 42 });
  const progressCount = states.length;
  channel.port1.onmessage?.call(channel.port1 as unknown as MessagePort, { data: { percent: 0.421 } } as MessageEvent);
  expect(states).toHaveLength(progressCount);
  emit('uciok'); emit('readyok');
  const commands = raw.postMessage.mock.calls.map(call => call[0]);
  expect(commands).toContain('setoption name Threads value 2');
  expect(commands).toContain('setoption name Hash value 16');
  expect(commands.indexOf('setoption name Threads value 2')).toBeLessThan(commands.indexOf('isready'));
  expect(commands.at(-1)).toBe('go depth 14 movetime 1200');
  expect(channel.port1.close).toHaveBeenCalled();
  controller.stop(); const count = states.length;
  emit('info depth 25 score cp 999 pv e2e4');
  expect(states).toHaveLength(count);
  expect(raw.terminate).toHaveBeenCalled();
});

it('reports worker/download failures and releases the loading timeout and progress channel', () => {
  const { raw, channel, controller, states } = setup();
  controller.start(STANDARD_STARTING_FEN);
  raw.onerror?.call(raw as unknown as Worker, {} as ErrorEvent);
  expect(states.at(-1)).toMatchObject({ kind: 'error' });
  expect(channel.port1.close).toHaveBeenCalled();
  expect(raw.terminate).toHaveBeenCalled();
  expect(vi.getTimerCount()).toBe(0);
});

it('does not leak a worker or timeout if its progress channel cannot be created or transferred', () => {
  const raw = { terminate: vi.fn(), postMessage: vi.fn(() => { throw new Error('Cannot transfer'); }) };
  expect(() => createBrowserEngineWorker(fullEngine.url, () => raw as unknown as Worker,
    () => { throw new Error('No channel'); })).toThrow('No channel');
  expect(raw.terminate).toHaveBeenCalledOnce();
  const channel = { port1: { close: vi.fn() }, port2: { close: vi.fn() } };
  expect(() => createBrowserEngineWorker(fullEngine.url, () => raw as unknown as Worker,
    () => channel as unknown as MessageChannel)).toThrow('Cannot transfer');
  expect(channel.port1.close).toHaveBeenCalled();
  expect(raw.terminate).toHaveBeenCalledTimes(2);
  expect(vi.getTimerCount()).toBe(0);
});

it('fails a stalled engine load instead of leaving it loading indefinitely, and cancels cleanly', () => {
  const first = setup(); first.controller.start(STANDARD_STARTING_FEN);
  vi.advanceTimersByTime(120_000);
  expect(first.states.at(-1)).toMatchObject({ kind: 'error' });
  const second = setup(); second.controller.start(STANDARD_STARTING_FEN); second.controller.dispose();
  const count = second.states.length;
  vi.advanceTimersByTime(120_000);
  expect(second.states).toHaveLength(count);
  expect(vi.getTimerCount()).toBe(0);
});

it('rejects excessive or invalid UCI thread counts', () => {
  for (const threads of [0, 5, 1.5, NaN]) expect(() => new EngineController(() => { throw new Error(); },
    () => {}, new EngineCache(), { threads })).toThrow('between 1 and 4');
});
