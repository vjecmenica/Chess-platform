import { afterEach, expect, it, vi } from 'vitest';
import { boardRows } from '../src/board-model';
import { buildGameReview, reviewedBoardMove, reviewPositions, reviewSummary } from '../src/game-review';
import { importPgn } from '../src/pgn-import';
import { fetchReviewBookPlies, qualifyingBookPlies, reviewBookCandidates } from '../src/review-book';

const supported = { positionGames: 100, moveGames: 5 };
const game = importPgn('[Result "1-0"]\n\n1. e4 e5 2. Nf3 Nc6 3. Bb5 a6 4. Ba4 Nf6 5. O-O 1-0', 'book-pgn').game;
const review = buildGameReview(game, reviewPositions(game).map((fen, index) => ({
  fen, depth: 14, score: { kind: 'cp', value: index === 1 ? 300 : 0 }, bestMove: null, variation: [],
})));

afterEach(() => vi.unstubAllGlobals());

it.each([
  { positionGames: 24, moveGames: 10 },
  { positionGames: 100, moveGames: 4 },
  { positionGames: 1000, moveGames: 29 },
  { positionGames: 0, moveGames: 0 },
  { positionGames: 40, moveGames: 41 },
])('stops at an unsupported move and never re-enters the book: %j', counts => {
  expect(qualifyingBookPlies([supported, counts, supported])).toBe(1);
  expect(qualifyingBookPlies([counts, supported])).toBe(0);
  expect(qualifyingBookPlies([supported, { positionGames: 1000, moveGames: 30 }])).toBe(2);
});

it('takes the imported main-line UCI and the position before each move only for a matching finished review', () => {
  const candidates = reviewBookCandidates(game, review);
  expect(candidates[0]).toEqual({ fen: game.history[0]!.beforeFen, uci: 'e2e4' });
  expect(candidates.at(-1)?.uci).toBe('e1g1');
  expect(reviewBookCandidates({ ...game, id: 'another' }, review)).toEqual([]);
  expect(reviewBookCandidates({ ...game, status: 'active' }, review)).toEqual([]);
  expect(reviewBookCandidates(game, null)).toEqual([]);
  const underpromotion = { ...game, history: game.history.map((move, index) => index === 0 ? { ...move, uci: 'a7a8n' } : move) };
  expect(reviewBookCandidates(underpromotion, review)[0]?.uci).toBe('a7a8n');
});

it('shows Book independently of engine quality on the played squares in either orientation', () => {
  const fen = game.history[0]!.afterFen;
  const cursor = { kind: 'main', ply: 1 } as const;
  const book = new Set([`${game.id}:m1`]);
  const original = reviewSummary(review, 'white');
  const display = reviewedBoardMove(game, review, cursor, fen, book);
  expect(display).toMatchObject({ from: 'e2', to: 'e4', classification: 'book', book: true,
    move: { label: 'Blunder', classification: 'blunder', lossCp: 300 } });
  for (const orientation of ['white', 'black'] as const)
    expect(boardRows(fen, orientation).flat().find(square => square.square === display?.to)?.piece).toBe('P');
  expect(display?.move).toBe(review.moves[0]);
  expect(reviewSummary(review, 'white')).toEqual(original);
  expect(reviewedBoardMove(game, review, { kind: 'branch', id: 1 }, fen, book)).toBeNull();
  expect(reviewedBoardMove({ ...game, status: 'active' }, review, cursor, fen, book)).toBeNull();
});

it('makes a single authenticated batch with an abort signal and rejects unavailable or incomplete responses', async () => {
  const mock = vi.fn().mockResolvedValueOnce(Response.json({ counts: [supported, { positionGames: 100, moveGames: 2 }] }))
    .mockResolvedValueOnce(new Response(null, { status: 503 })).mockResolvedValueOnce(Response.json({ counts: [] }));
  vi.stubGlobal('fetch', mock);
  const signal = new AbortController().signal;
  const body = JSON.stringify({ moves: reviewBookCandidates(game, review).slice(0, 2) });
  expect(await fetchReviewBookPlies(body, 2, 'csrf', signal)).toBe(1);
  expect(mock).toHaveBeenCalledExactlyOnceWith('/api/opening-explorer/book-counts',
    expect.objectContaining({ method: 'POST', body, signal, headers: expect.objectContaining({ 'X-CSRF-Token': 'csrf' }) }));
  await expect(fetchReviewBookPlies(body, 2, 'csrf', signal)).rejects.toThrow('unavailable');
  await expect(fetchReviewBookPlies(body, 2, 'csrf', signal)).rejects.toThrow('Invalid');
});
