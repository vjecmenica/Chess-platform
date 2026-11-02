import { describe, expect, it } from 'vitest';
import { STANDARD_STARTING_FEN } from '@chess/domain';
import { createEngineVariationReader, engineVariation } from '../src/engine-variation';
import { createEngineStatePublisher } from '../src/engine-ui-updates';
import type { EngineState } from '../src/engine-analysis';
import { MoveSelection } from '../src/move-selection';
import { boardSizePreferenceKey, readBoardSizePreference, saveBoardSizePreference } from '../src/board-size-preference';
import { analysisEntry, siteAnalysisUrl } from '../src/analysis-links';

describe('interactive PV derivation', () => {
  it('reuses validated occurrences while independently validating a changed suffix', () => {
    const read = createEngineVariationReader();
    const first = read(STANDARD_STARTING_FEN, ['e2e4', 'e7e5', 'g1f3']);
    const next = read(STANDARD_STARTING_FEN, ['e2e4', 'e7e5', 'f1c4']);
    expect(next.map(move => move.san)).toEqual(['e4', 'e5', 'Bc4']);
    expect(next[0]).toBe(first[0]); expect(next[1]).toBe(first[1]);
    expect(next[2]?.fen).toBe('rnbqkbnr/pppp1ppp/8/4p3/2B1P3/8/PPPP1PPP/RNBQK1NR b KQkq - 1 2');
    expect(read(STANDARD_STARTING_FEN, ['e2e4', 'e7e5', 'f1f8']).map(move => move.san)).toEqual(['e4', 'e5']);
    const differentRoot = read(first[1]!.fen, ['g1f3']);
    expect(differentRoot[0]).not.toBe(first[2]);
    expect(differentRoot[0]?.san).toBe('Nf3');
  });
  it('remains correct after bounded cache eviction and for repeated positions and promotions', () => {
    const read = createEngineVariationReader(2);
    const moves = ['g1f3', 'g8f6', 'f3g1', 'f6g8', 'e2e4'];
    expect(read(STANDARD_STARTING_FEN, moves)).toEqual(engineVariation(STANDARD_STARTING_FEN, moves));
    expect(read(STANDARD_STARTING_FEN, moves)).toEqual(engineVariation(STANDARD_STARTING_FEN, moves));
    const promotion = 'r6k/1P6/8/8/8/8/8/7K w - - 0 1';
    expect(read(promotion, ['b7a8n'])[0]?.san).toBe('bxa8=N');
    expect(read(promotion, ['b7a8q'])[0]?.san).toBe('bxa8=Q+');
  });
});

describe('engine UI publication', () => {
  it('shows the latest independent ranks once per frame and drops superseded positions', () => {
    const frames = new Map<number, FrameRequestCallback>(); let id = 0;
    const published: EngineState[] = [];
    const output = createEngineStatePublisher(state => published.push(state), callback => { frames.set(++id, callback); return id; }, key => { frames.delete(key); });
    const old: EngineState = { kind: 'searching', fen: 'old', lines: [{ rank: 1, score: { kind: 'cp', value: 10 }, variation: ['e2e4'] }] };
    output.push(old); output.push({ ...old, lines: [...old.lines!, { rank: 2, score: { kind: 'mate', value: -2 }, variation: ['d2d4'] }] });
    expect(frames.size).toBe(1); expect(published).toEqual([]);
    const flush = () => { const queued = [...frames.values()]; frames.clear(); queued.forEach(callback => callback(0)); };
    flush(); expect(published[0]).toMatchObject({ lines: [{ rank: 1 }, { rank: 2 }] });
    output.push(old); output.push({ kind: 'searching', fen: 'new' }); flush();
    expect(published.at(-1)).toEqual({ kind: 'searching', fen: 'new' });
    output.push(old); output.push({ kind: 'off' }); flush();
    expect(published.at(-1)).toEqual({ kind: 'off' });
    output.push(old); output.push({ kind: 'error', message: 'Worker unavailable' }); flush();
    expect(published.at(-1)?.kind).toBe('error');
    output.push(old); output.cancel(); flush(); expect(published.at(-1)?.kind).toBe('error');
    output.push(old);
    output.push({ kind: 'done', cached: true, evaluation: { fen: STANDARD_STARTING_FEN, depth: 14,
      bestMove: 'e2e4', score: { kind: 'cp', value: 15 }, variation: ['e2e4'] } }); flush();
    expect(published.at(-1)?.kind).toBe('done');
  });
});

describe('move-list selection isolation', () => {
  it('notifies only the previous and next selection in a large nested list', () => {
    const selection = new MoveSelection({ kind: 'branch', id: 478 });
    const changed: number[] = [];
    for (let id = 1; id <= 500; id++) selection.subscribe(`b${id}`, () => changed.push(id));
    selection.update({ kind: 'branch', id: 477 });
    expect(changed).toEqual([478, 477]); expect(selection.snapshot('b478')).toBe(0);
    expect(selection.snapshot('b477')).toBe(1);
    selection.update({ kind: 'branch', id: 477 }); expect(changed).toHaveLength(2);
    selection.update({ kind: 'main', ply: 12 }); expect(changed).toEqual([478, 477, 477]);
    expect(selection.snapshot('m12')).toBe(1);
    let calls = 0; const unsubscribe = selection.subscribe('m12', () => calls++); unsubscribe();
    selection.update({ kind: 'main', ply: 0 }); expect(calls).toBe(0);
    expect(new MoveSelection({ kind: 'main', ply: 12 }).snapshot('m12')).toBe(1);
    expect(selection.snapshot('m12')).toBe(0);
  });
});

describe('site-game board-size continuity', () => {
  it('carries the rendered size through new-tab links and reload without overwriting a saved preference', () => {
    const data = new Map<string, string>([[boardSizePreferenceKey, '640']]);
    const storage = { getItem: (key: string) => data.get(key) ?? null, setItem: (key: string, value: string) => { data.set(key, value); } };
    const url = siteAnalysisUrl('298953a3-d5e8-408d-a612-7a63af5f93d7', 12, 500);
    const entry = analysisEntry(new URL(url, 'http://localhost'));
    expect(entry).toMatchObject({ kind: 'site', ply: 12, boardSize: 500 });
    expect(analysisEntry(new URL(url, 'http://localhost'))).toEqual(entry);
    expect(readBoardSizePreference(storage)).toBe(640);
    saveBoardSizePreference(storage, 560); expect(readBoardSizePreference(storage)).toBe(560);
    saveBoardSizePreference(storage, NaN); expect(readBoardSizePreference(storage)).toBe(560);
  });
  it('ignores invalid URL/storage sizes and works without browser storage', () => {
    const root = '/challenge/298953a3-d5e8-408d-a612-7a63af5f93d7?analysis=1';
    for (const value of ['NaN', 'Infinity', '0', '-1', '9000'])
      expect(analysisEntry(new URL(`${root}&board=${value}`, 'http://localhost'))).not.toHaveProperty('boardSize');
    expect(readBoardSizePreference({ getItem: () => { throw new Error('Unavailable'); } })).toBeNull();
    expect(readBoardSizePreference()).toBeNull();
    expect(() => saveBoardSizePreference(undefined, 500)).not.toThrow();
  });
});
