import { describe, expect, it } from 'vitest';
import {
  calculateGlicko2Period, effectiveRatingDeviation, initialRatingState, isProvisionalRating,
  isRatingState, rateGame,
} from '../src/index.js';
import type { RatingScore, RatingState } from '../src/index.js';

const day = 86_400_000;
const time = Date.UTC(2026, 0, 1);
const initial = Object.freeze(initialRatingState());
const played = Object.freeze({ ...initial, rd: 100, ratedGames: 15, lastRatedAtMs: time });

describe('Glicko-2 rating periods', () => {
  it('matches the official worked example at tau 0.5', () => {
    const result = calculateGlicko2Period({ ...initial, rd: 200 }, [
      { opponent: { rating: 1400, rd: 30 }, score: 1 },
      { opponent: { rating: 1550, rd: 100 }, score: 0 },
      { opponent: { rating: 1700, rd: 300 }, score: 0 },
    ]);
    // The published example rounds intermediate steps. The implementation retains full precision.
    expect(Math.abs(result.rating - 1464.06)).toBeLessThan(0.01);
    expect(Math.abs(result.rd - 151.52)).toBeLessThan(0.01);
    expect(Math.abs(result.volatility - 0.05999)).toBeLessThan(0.00001);
  });

  it('adds one period of variance without changing rating or volatility for an empty period', () => {
    expect(calculateGlicko2Period(initial, [])).toEqual({
      rating: 1500, rd: Math.hypot(350 / 173.7178, 0.06) * 173.7178, volatility: 0.06,
    });
  });

  it('handles extreme mismatches through both branches of the volatility solver', () => {
    const favorite = { ...played, rating: 12_000 };
    const underdog = { ...played, rating: -12_000 };
    const expected = calculateGlicko2Period(favorite, [{ opponent: underdog, score: 1 }]);
    const upset = calculateGlicko2Period(favorite, [{ opponent: underdog, score: 0 }]);
    expect(expected.rating).toBeCloseTo(favorite.rating, 10);
    expect(upset.rating).toBeLessThan(favorite.rating - 20);
    expect(upset.volatility).toBeGreaterThan(expected.volatility);
    expect(calculateGlicko2Period(favorite, [{ opponent: underdog, score: 0 }])).toEqual(upset);
    expect(() => calculateGlicko2Period(
      { ...favorite, rating: Number.MAX_VALUE },
      [{ opponent: underdog, score: 0 }],
    )).toThrow(RangeError);
  });

  it.each([{ rating: NaN }, { rating: Infinity }, { rd: -1 }, { volatility: 0 }, { volatility: Infinity }])
    ('rejects invalid rating values %j', invalid => {
      expect(() => calculateGlicko2Period({ ...initial, ...invalid }, [])).toThrow(RangeError);
    });

  it('rejects invalid opponent deviations and scores', () => {
    expect(() => calculateGlicko2Period(initial, [{ opponent: { ...initial, rd: -1 }, score: 1 }])).toThrow(RangeError);
    for (const score of [-1, 1.5, NaN, Infinity]) {
      expect(() => rateGame(initial, initial, score as RatingScore, time)).toThrow(RangeError);
    }
  });
});

describe('immediate per-game updates', () => {
  it.each([1, 0, 0.5] as const)('uses both frozen pre-game states for score %s', score => {
    const [first, second] = rateGame(initial, initial, score, time);
    expect(Math.sign(first.rating - 1500)).toBe(Math.sign(score - 0.5));
    expect(first.rating + second.rating).toBeCloseTo(3000, 10);
    expect(first.rd).toBe(second.rd);
    expect(first.rd).toBeLessThan(350);
    expect(first).toMatchObject({ ratedGames: 1, lastRatedAtMs: time });
    expect(second).toMatchObject({ ratedGames: 1, lastRatedAtMs: time });
    expect(initial).toEqual({ rating: 1500, rd: 350, volatility: 0.06, ratedGames: 0, lastRatedAtMs: null });
  });

  it('moves ratings more after an upset than after an expected win', () => {
    const favorite = { ...played, rating: 1850 };
    const underdog = { ...played, rating: 1450 };
    const [expectedWinner] = rateGame(favorite, underdog, 1, time);
    const [upsetLoser, upsetWinner] = rateGame(favorite, underdog, 0, time);
    expect(expectedWinner.rating).toBeGreaterThan(favorite.rating);
    expect(upsetWinner.rating).toBeGreaterThan(underdog.rating);
    expect(favorite.rating - upsetLoser.rating).toBeGreaterThan(expectedWinner.rating - favorite.rating);
  });

  it('moves an uncertain rating farther than an established rating for the same result', () => {
    const uncertain = initial;
    const established = { ...played, rd: 45 };
    const [uncertainWinner] = rateGame(uncertain, played, 1, time);
    const [establishedWinner] = rateGame(established, played, 1, time);
    expect(uncertainWinner.rating).toBeGreaterThan(establishedWinner.rating);
    expect(establishedWinner.rd).toBeLessThan(established.rd);
  });

  it('adds no full-period variance to simultaneous games and reanchors after each result', () => {
    const [first, opponent] = rateGame(played, played, 0.5, time);
    const [second] = rateGame(first, opponent, 0.5, time);
    const [later] = rateGame(first, opponent, 0.5, time + day);
    expect(second.rd).toBeLessThan(first.rd);
    expect(second.rd).toBeLessThan(calculateGlicko2Period(first, [{ opponent, score: 0.5 }]).rd);
    expect(later.rd).toBeGreaterThan(second.rd);
    expect(later.lastRatedAtMs).toBe(time + day);
    expect(effectiveRatingDeviation(later, time + day)).toBe(later.rd);
    expect(later.ratedGames).toBe(17);
  });
});

describe('effective deviation', () => {
  it('grows variance proportionally to elapsed days and is repeatable', () => {
    const oneDayVariance = (173.7178 * played.volatility) ** 2;
    expect(effectiveRatingDeviation(played, time)).toBe(played.rd);
    for (const days of [0.5, 1, 7, 90]) {
      const at = time + day * days;
      const effective = effectiveRatingDeviation(played, at);
      expect(effective).toBeCloseTo(Math.sqrt(played.rd ** 2 + days * oneDayVariance), 10);
      expect(effectiveRatingDeviation(played, at)).toBe(effective);
    }
    expect(played).toEqual({ rating: 1500, rd: 100, volatility: 0.06, ratedGames: 15, lastRatedAtMs: time });
  });

  it('caps inactive ratings and leaves new players at the initial RD', () => {
    expect(effectiveRatingDeviation(played, time + 10_000 * day)).toBe(350);
    expect(effectiveRatingDeviation(initial, time + day)).toBe(350);
  });

  it('derives provisional status from the effective RD with a strict cutoff', () => {
    const threshold = { ...played, rd: 110 };
    expect(isProvisionalRating(threshold, time)).toBe(false);
    expect(isProvisionalRating(threshold, time + day)).toBe(true);
    expect(isProvisionalRating(initial, time)).toBe(true);
  });

  it('rejects invalid stored states and out-of-order or invalid timestamps', () => {
    const invalid: Partial<RatingState>[] = [
      { ratedGames: -1 }, { ratedGames: 1.1 }, { ratedGames: 2_147_483_648 }, { ratedGames: 0 },
      { lastRatedAtMs: null }, { lastRatedAtMs: NaN }, { lastRatedAtMs: -1 }, { rd: 351 },
    ];
    for (const fields of invalid) expect(isRatingState({ ...played, ...fields })).toBe(false);
    expect(isRatingState(initial)).toBe(true);
    for (const at of [time - 1, time + 0.5, Infinity, NaN, 8.64e15 + 1]) {
      expect(() => effectiveRatingDeviation(played, at)).toThrow(RangeError);
    }
  });
});
