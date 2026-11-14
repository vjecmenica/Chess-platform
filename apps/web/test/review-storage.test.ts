import { expect, it, vi } from 'vitest';
import { defaultSearchLimits, searchCommand } from '../src/engine-analysis';
import { liteEngine } from '../src/engine-builds';
import { accuracyMethodVersion } from '../src/game-accuracy';
import { buildGameReview, reviewMethodVersion, reviewPositions, reviewSummary } from '../src/game-review';
import { importPgn } from '../src/pgn-import';
import { loadCompletedReview, restoreReviewRecord, reviewStorageIdentity, reviewStorageKey, saveCompletedReview,
  validStoredBook } from '../src/review-storage';

const text = '[Result "1-0"]\n\n1. e4 e5 2. Nf3 Nc6 1-0';
const game = importPgn(text, 'import-first').game;
const reopened = importPgn(text, 'import-second').game;
const engine = { variant: liteEngine.id, threads: 1 };
const original = buildGameReview(game, reviewPositions(game).map((fen, index) => ({
  fen, engine: liteEngine.label, depth: 14, score: { kind: 'cp', value: index % 2 ? -65 : 25 },
  bestMove: index === 0 ? 'e2e4' : null, variation: index === 0 ? ['e2e4'] : [],
})));
const record = { key: 'test', version: 1, method: reviewMethodVersion, accuracyMethod: accuracyMethodVersion,
  profile: searchCommand(defaultSearchLimits), savedAt: 100, engine, evaluations: original.evaluations };

it('keys imports by the exact played line, while namespacing site and Explorer games by source ID', async () => {
  const identity = reviewStorageIdentity(game, true);
  expect(identity).toBe(reviewStorageIdentity(reopened, true));
  expect(identity).not.toBe(reviewStorageIdentity(importPgn('1. d4 d5 *', game.id).game, true));
  expect(reviewStorageIdentity({ ...game, id: 'explorer-1' }, true)).not.toBe(reviewStorageIdentity({ ...game, id: 'explorer-2' }, true));
  expect(reviewStorageIdentity({ ...game, id: 'site-1' }, false)).not.toBe(reviewStorageIdentity({ ...game, id: 'site-2' }, false));
  expect(reviewStorageIdentity({ ...game, status: 'active' }, false)).toBe('');
  expect(await reviewStorageKey(identity)).toMatch(/^[a-f0-9]{64}$/);
});

it('rebuilds completed engine classifications, accuracy, CPL and graph data from stored evaluations', () => {
  const restored = restoreReviewRecord(record, record.key, reopened);
  expect(restored).toEqual({ engine, review: { ...original, gameId: reopened.id } });
  expect(reviewSummary(restored!.review, 'white')).toEqual(reviewSummary(original, 'white'));
});

it('rejects incompatible methodology, data, engine settings and FEN sequences', () => {
  for (const value of [null, { ...record, key: 'other' }, { ...record, version: 2 },
    { ...record, method: 'old' }, { ...record, accuracyMethod: 'old' }, { ...record, profile: 'go depth 2' },
    { ...record, engine: { ...engine, threads: 2 } }, { ...record, evaluations: record.evaluations.slice(1) },
    { ...record, evaluations: [record.evaluations[1], ...record.evaluations.slice(1)] },
    { ...record, evaluations: [null, ...record.evaluations.slice(1)] }]) {
    expect(restoreReviewRecord(value, record.key, game)).toBeNull();
  }
  expect(restoreReviewRecord(record, record.key, { ...game, status: 'active' })).toBeNull();
});

it('ignores expired, incompatible or impossible Book metadata', () => {
  const book = { criteria: 'criteria', checkedAt: 100, plies: 2 };
  expect(validStoredBook(book, 'criteria', 4, 200)).toBe(true);
  expect(validStoredBook({ ...book, plies: 0 }, 'criteria', 4, 200)).toBe(true);
  expect(validStoredBook(book, 'new criteria', 4, 200)).toBe(false);
  expect(validStoredBook(book, 'criteria', 1, 200)).toBe(false);
  expect(validStoredBook(book, 'criteria', 4, 50)).toBe(false);
  expect(validStoredBook(book, 'criteria', 4, 8 * 86_400_000)).toBe(false);
});

it('treats unavailable IndexedDB as a cache miss and leaves the review usable', async () => {
  vi.stubGlobal('indexedDB', { open: () => { throw Error('Storage disabled'); } });
  try {
    await expect(saveCompletedReview(record.key, original, engine)).resolves.toBeUndefined();
    await expect(loadCompletedReview(record.key, game)).resolves.toBeNull();
    expect(original.moves).toHaveLength(game.history.length);
  } finally { vi.unstubAllGlobals(); }
});
