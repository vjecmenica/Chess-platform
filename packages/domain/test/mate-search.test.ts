import { describe, expect, it } from 'vitest';
import { createGame, findResignationMateWitness } from '../src/index.js';
import { createGameFromPosition } from '../src/game.js';

describe('resignation and bounded searches', () => {
  it('never depends on a bounded search to finalize a standard resignation', () => {
    const game = createGame();
    expect(game.getMatingPossibility('black')).toBe('unresolved');
    expect(game.resign({ side: 'white' })).toMatchObject({ accepted: true,
      game: { status: 'finished', result: { winner: 'black', reason: 'resignation' } } });
    expect(findResignationMateWitness(game, { maxDepth: 0, maxNodes: 0 }))
      .toMatchObject({ status: 'unresolved', reason: 'not_pending' });
    expect(game.getState().status).toBe('finished');
  });

  it('uses a proof of impossibility to override the concession', () => {
    const game = createGameFromPosition('4k3/8/8/8/8/8/8/R3K3 w - - 0 1');
    expect(game.getMatingPossibility('black')).toBe('impossible');
    expect(game.resign({ side: 'white' })).toMatchObject({ accepted: true,
      game: { status: 'finished', result: { outcome: 'draw',
        reason: 'resignation_no_mating_possibility' } } });
  });
});
