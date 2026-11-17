import { expect, it } from 'vitest';
import { ratingPools, ratingPoolByTimeControl, timeControlPresets } from '@chess/contracts';
import { initialRatingState, rateGame } from '@chess/domain';
import type { RatingPool } from '@chess/contracts';

it('assigns every supported time control to its documented pool exactly once', () => {
  const assignments = {
    bullet: ['1+0'],
    blitz: ['3+0', '3+2', '5+3'],
    rapid: ['10+0', '10+2', '10+5', '15+0', '15+2', '15+5'],
    classical: ['20+0', '20+10', '25+0', '25+10', '30+0', '30+10'],
  } satisfies Record<RatingPool, readonly string[]>;
  expect(Object.keys(ratingPoolByTimeControl).sort()).toEqual(Object.keys(timeControlPresets).sort());
  expect(ratingPools).toEqual(Object.keys(assignments));
  for (const pool of ratingPools) {
    expect(Object.entries(ratingPoolByTimeControl).filter(([, value]) => value === pool).map(([preset]) => preset))
      .toEqual(assignments[pool]);
  }
});

it('leaves unrelated pools unchanged when calculating a Blitz result', () => {
  const states = {
    bullet: initialRatingState(), blitz: initialRatingState(),
    rapid: initialRatingState(), classical: initialRatingState(),
  };
  const pool = ratingPoolByTimeControl['3+2'];
  [states[pool]] = rateGame(states[pool], initialRatingState(), 1, Date.UTC(2026, 0, 1));
  for (const id of ratingPools) {
    expect(states[id].ratedGames).toBe(id === pool ? 1 : 0);
    if (id !== pool) expect(states[id]).toEqual(initialRatingState());
  }
});
