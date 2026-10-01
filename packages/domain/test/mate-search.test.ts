import { describe, expect, it } from 'vitest';
import { createGame, findResignationMateWitness } from '../src/index.js';
import { createGameFromPosition } from '../src/game.js';

describe('resignation and bounded searches', () => {
  it('never depends on a bounded search to finalize a standard resignation', () => {
    const game = createGame('casual_concession');
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

  it('keeps an unresolved resignation pending when FIDE proof is required', () => {
    const game = createGame('fide_proof_required');
    expect(game.getMatingPossibility('black')).toBe('unresolved');
    expect(game.resign({ side: 'white' })).toMatchObject({ accepted: true,
      game: { status: 'pending_adjudication', result: null,
        pending: { kind: 'resignation', resigningSide: 'white' } } });
    expect(game.submitMove({ side: 'white', from: 'e2', to: 'e4' }))
      .toMatchObject({ accepted: false, reason: 'adjudication_pending' });
  });

  it('records a proven no-mate draw under either policy', () => {
    for (const policy of ['casual_concession', 'fide_proof_required'] as const) {
      const game = createGameFromPosition('4k3/8/8/8/8/8/8/R3K3 w - - 0 1', policy);
      expect(game.resign({ side: 'white' })).toMatchObject({ accepted: true,
        game: { status: 'finished', result: { outcome: 'draw',
          reason: 'resignation_no_mating_possibility' } } });
    }
  });
});
