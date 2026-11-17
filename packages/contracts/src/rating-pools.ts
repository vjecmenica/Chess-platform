import type { TimeControlId } from './time-controls.js';

export const ratingPools = ['bullet', 'blitz', 'rapid', 'classical'] as const;
export type RatingPool = typeof ratingPools[number];

export const ratingPoolByTimeControl = {
  '1+0': 'bullet',
  '3+0': 'blitz',
  '3+2': 'blitz',
  '5+3': 'blitz',
  '10+0': 'rapid',
  '10+2': 'rapid',
  '10+5': 'rapid',
  '15+0': 'rapid',
  '15+2': 'rapid',
  '15+5': 'rapid',
  '20+0': 'classical',
  '20+10': 'classical',
  '25+0': 'classical',
  '25+10': 'classical',
  '30+0': 'classical',
  '30+10': 'classical',
} as const satisfies Record<TimeControlId, RatingPool>;
