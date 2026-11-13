import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { expect, it } from 'vitest';
import { createPositionFromFen } from '@chess/domain';
import { boardRows } from '../src/board-model';
import type { EngineEvaluation } from '../src/engine-analysis';
import { buildGameReview, describeReviewedMove, reviewedDestination, reviewPositions } from '../src/game-review';
import { moveClassifications } from '../src/move-classification';
import { MoveClassificationBadge } from '../src/MoveClassificationBadge';
import { importPgn } from '../src/pgn-import';

const game = importPgn('[Result "1-0"]\n\n1. e4 e5 1-0', 'classification').game;

function score(fen: string, bestMove: string | null = null, value = 0): EngineEvaluation {
  return { fen, bestMove, depth: 14, score: { kind: 'cp', value }, variation: bestMove ? [bestMove] : [] };
}

it.each([
  ['1. e4', 'e2e4'],
  ['1. e4 e5', 'e7e5'],
  ['1. e4 e5 2. Nf3 Nc6 3. Bc4 Nf6 4. O-O', 'e1g1'],
])('recognizes the exact legal pre-move choice in %s', (movetext, uci) => {
  const imported = importPgn(`[Result "1-0"]\n\n${movetext} 1-0`, 'best-move').game;
  const fens = reviewPositions(imported);
  const review = buildGameReview(imported, fens.map((position, index) =>
    score(position, index === fens.length - 2 ? uci : null)));
  expect(review.moves.at(-1)).toMatchObject({ label: 'Strong', classification: 'best' });
  expect(review.moves.at(-1)?.ply).toBe(imported.history.length);
});

it('distinguishes an engine-matched underpromotion from a different promotion on the same square', () => {
  const before = '4k3/P7/8/8/8/8/8/4K3 w - - 0 1';
  const position = createPositionFromFen(before);
  const result = position.submitMove({ from: 'a7', to: 'a8', promotion: 'n', side: 'white' });
  if (!result.accepted) throw new Error('Invalid test promotion');
  const promoted = { ...game, position: result.position, history: [{ ...result.move, remainingMsAfterMove: null }] };
  const after = score(result.position.fen);
  expect(buildGameReview(promoted, [score(before, 'a7a8n'), after]).moves[0]?.classification).toBe('best');
  expect(buildGameReview(promoted, [score(before, 'a7a8q'), after]).moves[0]?.classification).toBe('excellent');
});

it('keeps the CPL or neutral mate result when the Best evidence is missing or inconsistent', () => {
  const [before, after, end] = reviewPositions(game) as [string, string, string];
  const best = score(before, 'e2e4');
  const first = (evaluation: EngineEvaluation, next = score(after)) =>
    buildGameReview(game, [evaluation, next, score(end)]).moves[0]!;
  expect(first(score(before)).classification).toBe('excellent');
  expect(first(score(before, 'e2e4q')).classification).toBe('excellent');
  expect(first({ ...best, variation: ['d2d4'] }).classification).toBe('excellent');
  expect(first({ ...best, lines: [{ rank: 1, score: best.score, variation: ['d2d4'] }] }).classification).toBe('excellent');
  expect(first(best, score(after, null, 21)).classification).toBe('good');
  expect(first(best, score(after, null, 300)).classification).toBe('blunder');
  expect(first(best, { ...score(after), score: { kind: 'mate', value: 0 } }).classification).toBe('mate');
  expect(() => first({ ...best, fen: end })).toThrow('saved main line');
});

it('resolves only the displayed, reviewed main-line destination of this finished game', () => {
  const fens = reviewPositions(game);
  const review = buildGameReview(game, fens.map((fen, index) =>
    score(fen, index === 0 ? 'e2e4' : null)));
  const first = { kind: 'main', ply: 1 } as const;
  const destination = reviewedDestination(game, review, first, fens[1]!);
  expect(destination).toEqual({ square: 'e4', move: review.moves[0] });
  expect(reviewedDestination(game, review, { kind: 'main', ply: 2 }, fens[2]!)?.square).toBe('e5');
  for (const orientation of ['white', 'black'] as const) {
    const squares = boardRows(fens[1]!, orientation).flat().filter(square => square.square === destination?.square);
    expect(squares).toMatchObject([{ square: 'e4', piece: 'P' }]);
  }
  expect(reviewedDestination(game, review, { kind: 'main', ply: 0 }, fens[0]!)).toBeNull();
  expect(reviewedDestination(game, review, { kind: 'branch', id: 1 }, fens[1]!)).toBeNull();
  expect(reviewedDestination(game, review, first, fens[2]!)).toBeNull();
  expect(reviewedDestination({ ...game, id: 'another-game' }, review, first, fens[1]!)).toBeNull();
  expect(reviewedDestination({ ...game, status: 'active' }, review, first, fens[1]!)).toBeNull();
  expect(reviewedDestination(game, null, first, fens[1]!)).toBeNull();
  const replacement = buildGameReview(game, fens.map((fen, index) => score(fen, null, index === 1 ? 300 : 0)));
  expect(reviewedDestination(game, replacement, first, fens[1]!)?.move.classification).toBe('blunder');
  expect(describeReviewedMove(destination!.move)).toBe('Engine: Best move, 0 centipawn loss');
});

it('shares unique theme-independent colors and symbols between board and list badges', () => {
  const visuals = Object.entries(moveClassifications);
  expect(new Set(visuals.map(([, visual]) => visual.color)).size).toBe(visuals.length);
  expect(new Set(visuals.map(([, visual]) => visual.path)).size).toBe(visuals.length);
  for (const classification of Object.keys(moveClassifications) as (keyof typeof moveClassifications)[]) {
    const visual = moveClassifications[classification];
    for (const placement of ['board', 'list'] as const) {
      const html = renderToStaticMarkup(createElement(MoveClassificationBadge, { classification, placement }));
      expect(html).toContain(`data-classification="${classification}"`);
      expect(html).toContain(`--move-classification-color:${visual.color}`);
      expect(html).toContain(`d="${visual.path}"`);
    }
  }
});
