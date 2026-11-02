import { expect, it } from 'vitest';
import { siteGameInfo } from '../src/game-service.js';

it('serializes the persisted acceptance timestamp as the start of current standard games', () => {
  const accepted = new Date('2026-11-02T13:18:36.000Z');
  for (const mode of ['first_move', 'first_move_grace'] as const)
    expect(JSON.parse(JSON.stringify(siteGameInfo(accepted, 'five_plus_three', mode))))
      .toEqual({ variant: 'standard', startedAt: accepted.toISOString(), acceptedAt: accepted.toISOString() });
});
it('does not invent a Ready-transition start time or substitute game/challenge creation for acceptance', () => {
  const accepted = new Date('2026-11-02T13:18:36.000Z');
  for (const mode of ['five_plus_three', 'legacy_untimed'] as const)
    expect(siteGameInfo(accepted, mode, 'readiness')).toEqual({
      variant: 'standard', startedAt: null, acceptedAt: accepted.toISOString(),
    });
  expect(siteGameInfo(null, 'five_plus_three', 'first_move_grace'))
    .toEqual({ variant: 'standard', startedAt: null, acceptedAt: null });
});
