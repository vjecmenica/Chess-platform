import { readFileSync } from 'node:fs';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { createPosition, STANDARD_STARTING_FEN } from '@chess/domain';
import type { GameReadResponse, SavedMove } from '@chess/contracts';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ReviewGraph, reviewAdvantageSegments, reviewGraphX, reviewGraphY,
  reviewPositionText } from '../src/EnginePanel';
import { EngineCache, type EngineEvaluation, type EngineWorker } from '../src/engine-analysis';
import { buildGameReview, GameReviewRunner, graphCentipawns, moveLabel, nextReviewedMovePly,
  reviewBadge, reviewMethodVersion, reviewPositions, reviewSummary,
  type ReviewProgress } from '../src/game-review';

function gameWithMoves(): GameReadResponse {
  const position = createPosition();
  const moves: SavedMove[] = [];
  for (const [side, from, to] of [['white', 'e2', 'e4'], ['black', 'e7', 'e5']] as const) {
    const beforeFen = position.getPosition().fen;
    const result = position.submitMove({ side, from, to });
    if (!result.accepted) throw new Error('Invalid test move');
    moves.push({ ply: moves.length + 1, side, from, to, san: result.move.san,
      uci: result.move.uci, beforeFen, afterFen: result.position.fen });
  }
  return { id: 'reviewed', version: 3, status: 'finished', yourSeat: 'white',
    position: position.getPosition(), result: { outcome: 'draw', reason: 'agreement' },
    history: moves, clocks: null, clockStatus: 'not_integrated',
    timeControl: { initialMs: 300_000, incrementMs: 3_000 }, rated: false };
}

function evaluation(fen: string, cp: number): EngineEvaluation {
  return { fen, depth: 14, score: { kind: 'cp', value: cp }, bestMove: 'e2e4',
    variation: ['e2e4'] };
}

class FakeWorker implements EngineWorker {
  readonly sent: string[] = [];
  terminated = false;
  onmessage: ((event: MessageEvent<string>) => void) | null = null;
  onerror: ((event: ErrorEvent) => void) | null = null;
  postMessage(command: string) { this.sent.push(command); }
  terminate() { this.terminated = true; }
  emit(line: string) { this.onmessage?.({ data: line } as MessageEvent<string>); }
  fail() { this.onerror?.({} as ErrorEvent); }
}

afterEach(() => vi.useRealTimers());

describe('browser-local full-game review', () => {
  it('uses only the confirmed main line, including its starting and final positions', () => {
    const game = gameWithMoves();
    expect(reviewPositions(game)).toEqual([STANDARD_STARTING_FEN,
      game.history[0]?.afterFen, game.position.fen]);
    expect(() => reviewPositions({ ...game, status: 'active' })).toThrow();
    expect(() => reviewPositions({ ...game, history: [game.history[1]!] })).toThrow();
  });

  it('calculates loss from the moving side and defines every label boundary', () => {
    const game = gameWithMoves();
    const fens = reviewPositions(game);
    // White: +0.50 to +0.20 loses 30 cp. Black: +0.20 to +0.90 loses 70 cp.
    const review = buildGameReview(game, [evaluation(fens[0]!, 50),
      evaluation(fens[1]!, -20), evaluation(fens[2]!, 90)]);
    expect(review.method).toBe(reviewMethodVersion);
    expect(review.moves.map(move => [move.lossCp, move.label])).toEqual([
      [30, 'Good'], [70, 'Inaccuracy']]);
    expect([0, 20, 21, 60, 61, 120, 121, 250, 251].map(moveLabel)).toEqual([
      'Strong', 'Strong', 'Good', 'Good', 'Inaccuracy', 'Inaccuracy',
      'Mistake', 'Mistake', 'Blunder']);
    expect(() => buildGameReview(game, [evaluation(fens[0]!, 0)])).toThrow();
    expect(game.history.map(move => move.san)).toEqual(['e4', 'e5']);
  });

  it('shows mate on the graph without inventing a centipawn loss', () => {
    const game = gameWithMoves();
    const fens = reviewPositions(game);
    const mateForBlack = { ...evaluation(fens[1]!, 0),
      score: { kind: 'mate' as const, value: 2 } };
    const checkmatedBlack = { ...evaluation(fens[1]!, 0),
      score: { kind: 'mate' as const, value: 0 } };
    expect(graphCentipawns(mateForBlack)).toBe(-1000);
    expect(graphCentipawns(checkmatedBlack)).toBe(1000);
    const review = buildGameReview(game, [evaluation(fens[0]!, 10), mateForBlack,
      evaluation(fens[2]!, 20)]);
    expect(review.moves.map(move => [move.lossCp, move.label]))
      .toEqual([[null, 'Mate score'], [null, 'Mate score']]);
    const markup = renderToStaticMarkup(createElement(ReviewGraph,
      { review, selectedPly: 1, onSelectPly: () => {} }));
    expect(markup).toContain('White-perspective evaluation');
    expect(markup).toContain('class="review-selected"');
    expect(markup).toContain('role="button"');
    expect(markup).toContain('class="review-hit"');
    expect(markup).not.toContain('class="review-point"');
    expect(markup).toContain('review-fill-black');
    expect(reviewPositionText(review, 0)).toContain('Initial position · Stockfish:');
    expect(reviewPositionText(review, 1)).toBe('After 1. e4 · Stockfish: Mate -2');
    expect(reviewPositionText({ ...review, evaluations: [review.evaluations[0]!, checkmatedBlack,
      review.evaluations[2]!] }, 1)).toContain('White wins by mate');
  });

  it('uses the measured chart width and a readable nonlinear vertical scale', () => {
    expect(reviewGraphX(0, 3, 1000)).toBe(10);
    expect(reviewGraphX(1, 3, 1000)).toBe(500);
    expect(reviewGraphX(2, 3, 1000)).toBe(990);
    expect(reviewGraphY(0)).toBe(80);
    expect(reviewGraphY(1000)).toBeCloseTo(10);
    expect(reviewGraphY(-1000)).toBeCloseTo(150);
    expect(reviewGraphY(100)).toBeLessThan(65);
    const crossing = reviewAdvantageSegments([200, -200], 320);
    expect(crossing.map(segment => segment.side)).toEqual(['white', 'black']);
    expect(crossing[0]?.points).toContain('160,80');
    expect(crossing[1]?.points).toContain('160,80');
    expect(reviewAdvantageSegments([-100, -200], 320).map(segment => segment.side))
      .toEqual(['black']);
    const css = readFileSync(new URL('../src/style.css', import.meta.url), 'utf8');
    expect(css).toMatch(/\.review-fill-white\s*\{[^}]*fill: #eee9d9/);
    expect(css).toMatch(/\.review-fill-black\s*\{[^}]*fill: #333b36/);
  });

  it('cycles each player’s review category in ply order and wraps around', () => {
    const base = buildGameReview(gameWithMoves(), reviewPositions(gameWithMoves())
      .map(fen => evaluation(fen, 0)));
    const review = { ...base, moves: [
      { ply: 1, side: 'white' as const, san: 'e4', lossCp: 90, label: 'Inaccuracy' as const },
      { ply: 2, side: 'black' as const, san: 'e5', lossCp: 300, label: 'Blunder' as const },
      { ply: 3, side: 'white' as const, san: 'Nf3', lossCp: 150, label: 'Mistake' as const },
      { ply: 5, side: 'white' as const, san: 'Bc4', lossCp: 80, label: 'Inaccuracy' as const },
    ] };
    expect(nextReviewedMovePly(review, 'white', 'Inaccuracy', null)).toBe(1);
    expect(nextReviewedMovePly(review, 'white', 'Inaccuracy', 1)).toBe(5);
    expect(nextReviewedMovePly(review, 'white', 'Inaccuracy', 5)).toBe(1);
    expect(nextReviewedMovePly(review, 'white', 'Mistake', 5)).toBe(3);
    expect(nextReviewedMovePly(review, 'black', 'Blunder', 2)).toBe(2);
    expect(nextReviewedMovePly(review, 'black', 'Inaccuracy', 2)).toBeNull();
  });

  it('summarizes each player without treating mate scores as centipawn loss', () => {
    const game = gameWithMoves();
    const fens = reviewPositions(game);
    const review = buildGameReview(game, [evaluation(fens[0]!, 100),
      evaluation(fens[1]!, 0), evaluation(fens[2]!, 200)]);
    expect(reviewSummary(review, 'white')).toEqual({ inaccuracy: 1, mistake: 0,
      blunder: 0, averageLossCp: 100 });
    expect(reviewSummary(review, 'black')).toEqual({ inaccuracy: 0, mistake: 1,
      blunder: 0, averageLossCp: 200 });
    expect(['Strong', 'Good', 'Inaccuracy', 'Mistake', 'Blunder', 'Mate score']
      .map(label => reviewBadge(label as typeof review.moves[number]['label'])))
      .toEqual([null, null, '?!', '?', '??', 'Mate eval']);
    const mate = buildGameReview(game, [evaluation(fens[0]!, 100),
      { ...evaluation(fens[1]!, 0), score: { kind: 'mate', value: 1 } },
      evaluation(fens[2]!, 200)]);
    expect(reviewSummary(mate, 'white').averageLossCp).toBeNull();
  });

  it('reuses cached positions, reports progress, and finishes after bounded searches', () => {
    vi.useFakeTimers();
    const game = gameWithMoves();
    const positions = reviewPositions(game);
    const cache = new EngineCache();
    cache.put(evaluation(positions[0]!, 25));
    const workers: FakeWorker[] = [];
    const progress: ReviewProgress[] = [];
    const completed: EngineEvaluation[][] = [];
    const errors: string[] = [];
    const runner = new GameReviewRunner(positions, () => {
      const worker = new FakeWorker(); workers.push(worker); return worker;
    }, cache, value => progress.push(value), value => completed.push([...value]),
    message => errors.push(message));
    runner.start();
    expect(progress.at(-1)).toEqual({ completed: 1, total: 3, cached: 1 });
    vi.advanceTimersByTime(0);
    const worker = workers[0]!;
    worker.emit('uciok'); worker.emit('readyok');
    expect(worker.sent).toContain(`position fen ${positions[1]}`);
    worker.emit('info depth 14 score cp -10 pv e7e5'); worker.emit('bestmove e7e5');
    vi.advanceTimersByTime(150);
    worker.emit('readyok');
    expect(worker.sent).toContain(`position fen ${positions[2]}`);
    worker.emit('info depth 14 score cp 15 pv g1f3'); worker.emit('bestmove g1f3');
    vi.advanceTimersByTime(150);
    expect(completed).toHaveLength(1);
    expect(completed[0]?.map(item => item.fen)).toEqual(positions);
    expect(progress.at(-1)).toEqual({ completed: 3, total: 3, cached: 1 });
    expect(errors).toEqual([]);
    expect(worker.terminated).toBe(true);
  });

  it('cancels without a result and reports worker failures', () => {
    vi.useFakeTimers();
    const positions = reviewPositions(gameWithMoves());
    const workers: FakeWorker[] = [];
    const completed: EngineEvaluation[][] = [];
    const errors: string[] = [];
    const makeWorker = () => { const worker = new FakeWorker(); workers.push(worker); return worker; };
    const first = new GameReviewRunner(positions, makeWorker, new EngineCache(), () => {},
      value => completed.push([...value]), message => errors.push(message));
    first.start();
    first.cancel();
    workers[0]?.emit('uciok');
    vi.runAllTimers();
    expect(workers[0]?.terminated).toBe(true);
    expect(completed).toEqual([]);
    const second = new GameReviewRunner(positions, makeWorker, new EngineCache(), () => {},
      value => completed.push([...value]), message => errors.push(message));
    second.start();
    workers[1]?.fail();
    expect(errors).toEqual(['Stockfish could not load in this browser.']);
    expect(workers[1]?.terminated).toBe(true);
  });
});
