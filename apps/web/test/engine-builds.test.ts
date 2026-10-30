import { afterEach, expect, it, vi } from 'vitest';
import { STANDARD_STARTING_FEN } from '@chess/domain';
import { EngineCache } from '../src/engine-analysis';
import { browserSupportsEngineThreads, effectiveThreads, engineCacheIdentity, engineDescription, enginePreferenceKey,
  fullEngine, fullSingleEngine, liteEngine, maximumEngineThreads, readEnginePreference, resolveEngine,
  saveEnginePreference } from '../src/engine-builds';
import { evaluationBarState } from '../src/analysis-workspace';

afterEach(() => vi.unstubAllGlobals());

it('defaults to Full, persists the choice, and rejects corrupt preferences without breaking analysis', () => {
  expect(readEnginePreference()).toEqual({ choice: 'full', threads: 1 });
  const entries = new Map<string, string>();
  const storage = { getItem: (key: string) => entries.get(key) ?? null,
    setItem: (key: string, value: string) => { entries.set(key, value); } };
  saveEnginePreference(storage, { choice: 'lite', threads: 3 });
  expect(readEnginePreference(storage)).toEqual({ choice: 'lite', threads: 3 });
  for (const value of ['bad json', '{"choice":"other","threads":2}', '{"choice":"full","threads":99}']) {
    entries.set(enginePreferenceKey, value);
    expect(readEnginePreference(storage)).toEqual({ choice: 'full', threads: 1 });
  }
  expect(() => saveEnginePreference({ ...storage, setItem: () => { throw new Error(); } },
    { choice: 'full', threads: 1 })).not.toThrow();
});

it('requires isolation and shared WASM memory, using Full single-threaded otherwise', () => {
  vi.stubGlobal('crossOriginIsolated', false);
  expect(browserSupportsEngineThreads()).toBe(false);
  expect(resolveEngine('full', browserSupportsEngineThreads())).toBe(fullSingleEngine);
  vi.stubGlobal('crossOriginIsolated', true);
  expect(browserSupportsEngineThreads()).toBe(true);
  expect(resolveEngine('full', browserSupportsEngineThreads())).toBe(fullEngine);
  vi.stubGlobal('SharedArrayBuffer', undefined);
  expect(browserSupportsEngineThreads()).toBe(false);
  expect(resolveEngine('lite', true)).toBe(liteEngine);
  expect(resolveEngine('lite', false)).toBe(liteEngine);
});

it('bounds interactive CPU parallelism while reserving a single-thread Lite review', () => {
  expect([1, 2, 4, 6, 64, NaN].map(maximumEngineThreads)).toEqual([1, 1, 2, 4, 4, 1]);
  expect(effectiveThreads(fullEngine, 4, maximumEngineThreads(4))).toBe(2);
  expect(effectiveThreads(fullSingleEngine, 4, 4)).toBe(1);
  expect(effectiveThreads(liteEngine, 4, 4)).toBe(1);
});

it('separates Full, Lite, and thread-specific evaluations including across reloads', () => {
  const entries = new Map<string, string>();
  const storage = { getItem: (key: string) => entries.get(key) ?? null,
    setItem: (key: string, value: string) => { entries.set(key, value); } };
  const evaluation = { fen: STANDARD_STARTING_FEN, depth: 14, score: { kind: 'cp' as const, value: 42 },
    bestMove: 'e2e4', variation: ['e2e4'] };
  const make = (variant: typeof fullEngine, threads: number) => new EngineCache(storage,
    engineCacheIdentity(variant, threads), engineDescription(variant, threads));
  make(fullEngine, 2).put(evaluation);
  expect(make(fullEngine, 2).get(evaluation.fen)).toMatchObject({ score: { value: 42 },
    engine: 'Stockfish 19 Full · 2 threads' });
  expect(make(fullEngine, 1).get(evaluation.fen)).toBeUndefined();
  expect(make(fullSingleEngine, 1).get(evaluation.fen)).toBeUndefined();
  expect(new EngineCache(storage).get(evaluation.fen)).toBeUndefined();
  expect(evaluationBarState(make(fullEngine, 2).get(evaluation.fen)!, evaluation.fen)?.label)
    .toContain('Stockfish 19 Full · 2 threads');
  new EngineCache(storage).put(evaluation);
  expect(new EngineCache(storage).get(evaluation.fen)).toMatchObject({ score: { value: 42 } });
});
