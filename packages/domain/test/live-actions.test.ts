import { describe, expect, it } from 'vitest';
import { createGameFromPosition } from '../src/game.js';

describe('live result commands at the domain boundary', () => {
  it('accepts resignation without awarding a win to a bare king', () => {
    const game = createGameFromPosition('4k3/8/8/8/8/8/8/3QK3 w - - 0 1');
    expect(game.resign({ side: 'white' })).toMatchObject({ accepted: true,
      game: { status: 'finished', drawOffer: null,
        result: { outcome: 'draw', reason: 'resignation_no_mating_possibility' } } });
    expect(game.resign({ side: 'white' })).toMatchObject({ accepted: false, reason: 'game_finished' });
  });
});
