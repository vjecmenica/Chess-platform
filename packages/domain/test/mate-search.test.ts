import { describe, expect, it } from 'vitest';
import { createGame, findResignationMateWitness, STANDARD_STARTING_FEN } from '../src/index.js';
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

  it('requires full-history verification even when the same legal sequence would otherwise mate', () => {
    const mate = ['g1f3', 'g8f6', 'f3g1', 'f6g8', 'f2f3', 'e7e5', 'g2g4', 'd8h4']
      .map(uci => ({ from: uci.slice(0, 2), to: uci.slice(2) }));
    const ordinary = createGame('fide_proof_required');
    expect(ordinary.resign({ side: 'white' }).accepted).toBe(true);
    expect(ordinary.verifyResignationMateLine(mate)).toBe(true);

    const late = createGameFromPosition(STANDARD_STARTING_FEN.replace(' 0 1', ' 149 76'), 'fide_proof_required');
    expect(late.resign({ side: 'white' }).accepted).toBe(true);
    expect(late.resolveResignation({ verdict: 'mate_possible', mateLine: mate }))
      .toMatchObject({ accepted: false, reason: 'invalid_ruling' });
    expect(late.getState()).toMatchObject({ status: 'pending_adjudication', result: null });
  });

  it.each([
    ['7k/8/5KQ1/8/8/8/8/8 w - - 0 1', 'g6', 'g7'],
    ['7k/5K2/8/8/8/8/R7/8 w - - 0 1', 'a2', 'h2'],
  ])('recognizes a legal queen or rook mate in one under strict resignation rules', (fen, from, to) => {
    const game = createGameFromPosition(fen, 'fide_proof_required');
    expect(game.verifyMateLine('white', [{ from, to }])).toBe(true);
    expect(game.resign({ side: 'black' })).toMatchObject({ accepted: true,
      game: { status: 'finished', result: { outcome: 'win', winner: 'white', reason: 'resignation' } } });
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
