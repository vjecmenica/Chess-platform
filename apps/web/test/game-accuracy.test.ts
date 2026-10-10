import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { STANDARD_STARTING_FEN } from '@chess/domain';
import { AccuracyEstimate } from '../src/EnginePanel';
import type { EngineEvaluation } from '../src/engine-analysis';
import { accuracyMethodVersion, accuracyVolatility, accuracyWindowSize,
  calculateGameAccuracy, moveAccuracy, whiteWinPercent } from '../src/game-accuracy';
import { buildGameReview, reviewPositions } from '../src/game-review';
import { importPgn } from '../src/pgn-import';

function evaluation(value: number, turn: 'w' | 'b' = 'w', kind: 'cp' | 'mate' = 'cp'): EngineEvaluation {
  return { fen: STANDARD_STARTING_FEN.replace(' w ', ` ${turn} `), depth: 14,
    score: { kind, value }, bestMove: null, variation: [] };
}

describe('local win-percentage accuracy v1', () => {
  // Reference constants were calculated separately with 60-digit Decimal
  // arithmetic from the published equations, not from the production functions.
  it('converts known centipawn evaluations and each UCI score perspective', () => {
    expect(whiteWinPercent(evaluation(0))).toBe(50);
    expect(whiteWinPercent(evaluation(100))).toBeCloseTo(59.10258971916129, 10);
    expect(whiteWinPercent(evaluation(100, 'b'))).toBeCloseTo(40.89741028083871, 10);
    expect(whiteWinPercent(evaluation(-100, 'b'))).toBeCloseTo(59.10258971916129, 10);
    expect(whiteWinPercent(evaluation(1e300))).toBe(100);
    expect(whiteWinPercent(evaluation(-1e300))).toBe(0);
  });

  it('matches known probability losses, with bounded improvements and rounded coefficients', () => {
    expect(moveAccuracy(60, 50)).toBeCloseTo(63.58261930710973, 10);
    expect(moveAccuracy(70, 50)).toBeCloseTo(40.02042700568608, 10);
    expect(moveAccuracy(100, 50)).toBeCloseTo(8.5302719143444, 10);
    expect(moveAccuracy(100, 0)).toBe(0);
    expect(moveAccuracy(50, 50)).toBe(100);
    expect(moveAccuracy(40, 70)).toBe(100);
    expect(moveAccuracy(NaN, 50)).toBeNull();
    expect(moveAccuracy(50, Infinity)).toBeNull();
    expect(moveAccuracy(-1, 50)).toBeNull();
  });

  it('reverses the post-move perspective for both players in the actual review pipeline', () => {
    const game = importPgn('1. e4 e5 1/2-1/2', 'accuracy').game;
    const fens = reviewPositions(game);
    // White loses +100 -> 0 cp; Black loses 0 -> -100 cp in Black's perspective.
    const evaluations = [100, 0, 100].map((cp, index) => ({ ...evaluation(cp), fen: fens[index]! }));
    const review = buildGameReview(game, evaluations);
    for (const side of ['white', 'black'] as const) {
      expect(review.accuracy[side].method).toBe(accuracyMethodVersion);
      expect(review.accuracy[side].value).toBeCloseTo(66.24236357345742, 10);
      expect(review.accuracy[side].moveCount).toBe(1);
    }
    expect(review.moves.map(move => [move.lossCp, move.label]))
      .toEqual([[100, 'Inaccuracy'], [100, 'Inaccuracy']]);
    expect(review.evaluations).toBe(evaluations);
    expect(game.history.map(move => move.san)).toEqual(['e4', 'e5']);
    // Do not infer the mover from even/odd array indices.
    expect(calculateGameAccuracy([evaluation(100, 'b'), evaluation(0)], ['black']).black.value)
      .toBeCloseTo(66.24236357345742, 10);
  });

  it('uses centered population-volatility windows, including shifted edges and even lengths', () => {
    expect([0, 1, 2, 3, 5, 10, 25, 100].map(accuracyWindowSize))
      .toEqual([0, 1, 2, 3, 3, 4, 5, 9]);
    const weights = accuracyVolatility([50, 40, 50, 45, 65]);
    expect(weights[0]).toBeCloseTo(4.714045207910317, 10);
    expect(weights[1]).toBeCloseTo(4.08248290463863, 10);
    expect(weights[2]).toBeCloseTo(8.498365855987975, 10);
    expect(weights[3]).toBe(weights[2]);
    const even = accuracyVolatility([0, 0, 0, 0, 0, 100, 0, 0, 0, 0]);
    expect(even.map(weight => weight > 0)).toEqual([false, false, true, true, true, true, false, false, false]);
    expect(even[2]).toBeCloseTo(43.30127018922193, 10);
    expect(accuracyVolatility([40, 60])).toEqual([10]);
  });

  it('combines each player’s weighted and harmonic means instead of averaging all moves', () => {
    // CP values independently inverted from White win percentages [50,40,50,45,65].
    const whiteCp = [0, -110.11849501047353, 0, -54.49927634982161, 168.12215063394153];
    const evaluations = whiteCp.map((cp, index) => evaluation(index % 2 ? -cp : cp, index % 2 ? 'b' : 'w'));
    const result = calculateGameAccuracy(evaluations, ['white', 'black', 'white', 'black']);
    expect(result.white.weightedMean).toBeCloseTo(74.02477451860823, 9);
    expect(result.white.harmonicMean).toBeCloseTo(70.78087207250801, 9);
    expect(result.white.value).toBeCloseTo(72.40282329555812, 9);
    expect(result.black.weightedMean).toBeCloseTo(47.66635369128587, 9);
    expect(result.black.harmonicMean).toBeCloseTo(49.12217671916530, 9);
    expect(result.black.value).toBeCloseTo(48.39426520522558, 9);
  });

  it('handles empty, one-ply, and flat games without manufacturing a player score', () => {
    const empty = calculateGameAccuracy([evaluation(0)], []);
    expect(empty.white).toMatchObject({ value: null, moveCount: 0, unavailable: 'no_moves' });
    expect(empty.black.value).toBeNull();
    const single = calculateGameAccuracy([evaluation(0), evaluation(0, 'b')], ['white']);
    expect(single.white).toMatchObject({ value: 100, weightedMean: 100, harmonicMean: 100 });
    expect(single.black).toMatchObject({ value: null, moveCount: 0, unavailable: 'no_moves' });
    const flat = calculateGameAccuracy(Array.from({ length: 11 }, () => evaluation(0)),
      Array.from({ length: 10 }, (_, index) => index % 2 ? 'black' : 'white'));
    expect(flat.white.value).toBe(100);
    expect(flat.black.value).toBe(100);
  });

  it('maps mate directly to endpoints, including mate zero, without introducing numeric CPL', () => {
    expect(whiteWinPercent(evaluation(3, 'w', 'mate'))).toBe(100);
    expect(whiteWinPercent(evaluation(3, 'b', 'mate'))).toBe(0);
    expect(whiteWinPercent(evaluation(-3, 'b', 'mate'))).toBe(100);
    expect(whiteWinPercent(evaluation(0, 'w', 'mate'))).toBe(0);
    expect(whiteWinPercent(evaluation(0, 'b', 'mate'))).toBe(100);
    const lostMate = calculateGameAccuracy([evaluation(3, 'w', 'mate'), evaluation(2, 'b', 'mate')], ['white']);
    expect(lostMate.white).toMatchObject({ value: 0, weightedMean: 0, harmonicMean: 0 });
    const escapedMate = calculateGameAccuracy([evaluation(-3, 'w', 'mate'), evaluation(0, 'b')], ['white']);
    expect(escapedMate.white.value).toBe(100);
    const game = importPgn('1. f3 e5 2. g4 Qh4# 0-1', 'mate').game;
    const review = buildGameReview(game, reviewPositions(game).map((fen, index) =>
      ({ ...evaluation(index === 4 ? 0 : -1, 'w', 'mate'), fen })));
    expect(review.moves.every(move => move.lossCp === null && move.label === 'Mate score')).toBe(true);
    expect(review.accuracy.black.value).toBe(100);
  });

  it('rejects incomplete/non-finite evaluation timelines instead of silently scoring a subset', () => {
    for (const missing of [null, undefined, evaluation(NaN), evaluation(Infinity), evaluation(1.5, 'w', 'mate'),
      { ...evaluation(0), fen: 'invalid' }]) {
      const result = calculateGameAccuracy([evaluation(0), missing, evaluation(0)], ['white', 'black']);
      expect(result.white).toMatchObject({ value: null, unavailable: 'missing_evaluation' });
      expect(result.black).toMatchObject({ value: null, unavailable: 'missing_evaluation' });
    }
    expect(calculateGameAccuracy([evaluation(0)], ['white']).white.value).toBeNull();
    expect(calculateGameAccuracy([evaluation(0), evaluation(0), evaluation(0)], ['white']).white.value).toBeNull();
  });

  it('bounds aggregated scores and handles zero move accuracy in the harmonic mean', () => {
    for (const cp of [1e300, -1e300, 10000, -10000, 0]) {
      const result = calculateGameAccuracy([evaluation(cp), evaluation(cp, 'b'), evaluation(-cp),
        evaluation(0, 'b')], ['white', 'black', 'white']);
      for (const side of ['white', 'black'] as const) {
        expect(Number.isFinite(result[side].value)).toBe(true);
        expect(result[side].value).toBeGreaterThanOrEqual(0);
        expect(result[side].value).toBeLessThanOrEqual(100);
      }
    }
    const result = calculateGameAccuracy([evaluation(1e6), evaluation(1e6, 'b'), evaluation(0),
      evaluation(0, 'b')], ['white', 'black', 'white']);
    expect(result.white.harmonicMean).toBe(0);
  });

  it('renders a rounded versioned estimate or a clear unavailable value', () => {
    const result = calculateGameAccuracy([evaluation(100), evaluation(0, 'b')], ['white']);
    const html = renderToStaticMarkup(createElement(AccuracyEstimate, { result: result.white }));
    expect(html).toContain('66.2%');
    expect(html).toContain('Local accuracy');
    expect(html).toContain('data-accuracy-method="local-win-accuracy-v1"');
    expect(result.white.value).toBeCloseTo(66.24236357345742, 10);
    const unavailable = renderToStaticMarkup(createElement(AccuracyEstimate, { result: result.black }));
    expect(unavailable).toContain('Accuracy unavailable. No moves by this player.');
    expect(unavailable).not.toContain('0.0%');
  });
});
