import { describe, expect, it } from 'vitest';
import { createGame, findResignationMateWitness, type ChessGame, type Side } from '../src/index.js';
import { createGameFromPosition } from '../src/game.js';

function play(game: ChessGame, ...moves: string[]): void {
  for (const uci of moves) {
    const result = game.submitMove({ side: game.getState().position.sideToMove,
      from: uci.slice(0, 2), to: uci.slice(2, 4) });
    expect(result.accepted, `Fixture move ${uci}: ${JSON.stringify(result)}`).toBe(true);
  }
}

describe('bounded cooperative mate search', () => {
  it.each(['white', 'black'] as const)('resolves a standard-start resignation by %s', resigningSide => {
    const game = createGame();
    const resignation = game.resign({ side: resigningSide });
    expect(resignation).toMatchObject({ accepted: true,
      game: { status: 'pending_adjudication', pending: { resigningSide } } });
    const state = game.getState();
    const search = findResignationMateWitness(game);
    expect(search.status).toBe('found');
    expect(findResignationMateWitness(game)).toEqual(search);
    if (search.status !== 'found') throw new Error('Expected a mate witness');
    expect(game.getState()).toEqual(state);
    expect(game.verifyResignationMateLine(search.mateLine)).toBe(true);
    const winner: Side = resigningSide === 'white' ? 'black' : 'white';
    expect(game.resolveResignation({ verdict: 'mate_possible', mateLine: search.mateLine }))
      .toMatchObject({ accepted: true, game: { status: 'finished',
        result: { outcome: 'win', winner, reason: 'resignation' } } });
    expect(game.getHistory()).toEqual([]);
    expect(findResignationMateWitness(game)).toMatchObject({ status: 'unresolved', reason: 'not_pending' });
  });

  it('finds a cooperative mate in a developed position without an opening template', () => {
    const game = createGame();
    play(game, 'e2e4', 'e7e5', 'f1c4', 'b8c6', 'd2d3', 'd7d6',
      'b1c3', 'c8g4', 'g1h3', 'g4h5', 'a2a3', 'a7a6',
      'b2b3', 'b7b6', 'g2g3', 'h7h6', 'd1h5');
    const history = game.getHistory();
    expect(game.resign({ side: 'black' })).toMatchObject({ accepted: true,
      game: { status: 'pending_adjudication' } });
    const search = findResignationMateWitness(game, { maxDepth: 2, maxNodes: 1000 });
    expect(search.status).toBe('found');
    if (search.status !== 'found') throw new Error('Expected a mate witness');
    expect(search.mateLine).toHaveLength(2);
    expect(game.verifyResignationMateLine(search.mateLine)).toBe(true);
    expect(game.resolveResignation({ verdict: 'mate_possible', mateLine: search.mateLine }))
      .toMatchObject({ accepted: true, game: { status: 'finished',
        result: { outcome: 'win', winner: 'white', reason: 'resignation' } } });
    expect(game.getHistory()).toEqual(history);
  });

  it('finds a different cooperative mate after central and flank development', () => {
    const game = createGame();
    play(game, 'a2a3', 'a7a6', 'b2b3', 'b7b6', 'c2c3', 'c7c6',
      'h2h3', 'h7h6', 'a1a2', 'a8a7', 'f2f3', 'e7e5');
    expect(game.resign({ side: 'white' })).toMatchObject({ accepted: true,
      game: { status: 'pending_adjudication' } });
    const search = findResignationMateWitness(game, { maxDepth: 2, maxNodes: 1000 });
    expect(search.status).toBe('found');
    if (search.status !== 'found') throw new Error('Expected a mate witness');
    expect(search.mateLine).toHaveLength(2);
    expect(game.resolveResignation({ verdict: 'mate_possible', mateLine: search.mateLine }))
      .toMatchObject({ accepted: true, game: { status: 'finished',
        result: { outcome: 'win', winner: 'black', reason: 'resignation' } } });
  });

  it('keeps a proven no-mate resignation as a draw without searching', () => {
    const game = createGameFromPosition('4k3/8/8/8/8/8/8/R3K3 w - - 0 1');
    expect(game.getMatingPossibility('black')).toBe('impossible');
    expect(game.resign({ side: 'white' })).toMatchObject({ accepted: true,
      game: { status: 'finished', result: { outcome: 'draw',
        reason: 'resignation_no_mating_possibility' } } });
    expect(findResignationMateWitness(game)).toMatchObject({ status: 'unresolved', reason: 'not_pending' });
  });

  it('leaves a game pending when the node budget is exhausted', () => {
    const game = createGame();
    expect(game.resign({ side: 'white' }).accepted).toBe(true);
    const before = game.getState();
    expect(findResignationMateWitness(game, { maxDepth: 7, maxNodes: 1 }))
      .toEqual({ status: 'unresolved', reason: 'budget_exhausted', nodesVisited: 1 });
    expect(findResignationMateWitness(game, { maxDepth: 1, maxNodes: 100 }))
      .toMatchObject({ status: 'unresolved', reason: 'depth_exhausted' });
    expect(game.getState()).toEqual(before);
    expect(game.getHistory()).toEqual([]);
    expect(() => findResignationMateWitness(game, { maxDepth: 9 })).toThrow(RangeError);
    expect(() => findResignationMateWitness(game, { maxNodes: 20001 })).toThrow(RangeError);
    expect(game.getState()).toEqual(before);
  });

  it('rejects invalid witnesses without changing the pending game', () => {
    const game = createGame();
    expect(game.resign({ side: 'white' }).accepted).toBe(true);
    const before = game.getState();
    const invalidLine = [{ from: 'e2', to: 'e4' }];
    expect(game.verifyResignationMateLine(invalidLine)).toBe(false);
    expect(game.resolveResignation({ verdict: 'mate_possible', mateLine: invalidLine }))
      .toMatchObject({ accepted: false, reason: 'invalid_ruling' });
    expect(game.getState()).toEqual(before);
    expect(game.getHistory()).toEqual([]);
  });
});
