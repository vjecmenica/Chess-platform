import { describe, expect, it } from 'vitest';
import { createGame, findTimeoutMateWitness, type ChessGame } from '../src/index.js';
import { createGameFromPosition } from '../src/game.js';

const foolsMate = [
  { from: 'f2', to: 'f3' }, { from: 'e7', to: 'e5' },
  { from: 'g2', to: 'g4' }, { from: 'd8', to: 'h4' },
] as const;

function unchanged(game: ChessGame, action: () => unknown, reason: string): void {
  const state = game.getState();
  const history = game.getHistory();
  expect(action()).toMatchObject({ accepted: false, reason });
  expect(game.getState()).toEqual(state);
  expect(game.getHistory()).toEqual(history);
}

describe('timeout adjudication', () => {
  it('draws when the opponent is proven unable to mate', () => {
    const game = createGameFromPosition('4k3/8/8/8/8/8/8/R3K3 w - - 0 1');
    expect(game.flagTimeout({ flaggedSide: 'white', deadlineMs: 300000 })).toMatchObject({
      accepted: true, game: { status: 'finished', drawOffer: null, result: {
        outcome: 'draw', reason: 'timeout_no_mating_possibility',
        flaggedSide: 'white', deadlineMs: 300000,
      } },
    });
    unchanged(game, () => game.flagTimeout({ flaggedSide: 'white', deadlineMs: 300000 }), 'game_finished');
    unchanged(game, () => game.submitMove({ side: 'white', from: 'a1', to: 'a8' }), 'game_finished');
  });

  it('awards a win from a verified cooperative mate line without playing it', () => {
    const game = createGame('casual_concession');
    expect(game.verifyMateLine('black', foolsMate)).toBe(true);
    expect(game.flagTimeout({ flaggedSide: 'white', deadlineMs: 42, mateLine: foolsMate }))
      .toMatchObject({ accepted: true, game: { status: 'finished', result: {
        outcome: 'win', winner: 'black', reason: 'timeout', flaggedSide: 'white', deadlineMs: 42,
      }, adjudication: { mateLine: foolsMate } } });
    expect(game.getHistory()).toEqual([]);
    unchanged(game, () => game.resolveTimeout({ verdict: 'mate_possible', mateLine: foolsMate }), 'game_finished');
  });

  it('freezes an unresolved flag and accepts only a verified later ruling', () => {
    const game = createGame('casual_concession');
    expect(game.replayAcceptedDrawOffer({ side: 'black' }).accepted).toBe(true);
    expect(game.flagTimeout({ flaggedSide: 'white', deadlineMs: 300000,
      mateLine: [{ from: 'e2', to: 'e4' }] })).toMatchObject({
      accepted: true, game: { status: 'pending_adjudication', result: null, drawOffer: null,
        pending: { kind: 'timeout', flaggedSide: 'white', deadlineMs: 300000 } },
    });
    unchanged(game, () => game.flagTimeout({ flaggedSide: 'white', deadlineMs: 300000 }), 'adjudication_pending');
    unchanged(game, () => game.resign({ side: 'white' }), 'adjudication_pending');
    unchanged(game, () => game.submitMove({ side: 'white', from: 'e2', to: 'e4' }), 'adjudication_pending');
    unchanged(game, () => game.resolveResignation({ verdict: 'mate_possible', mateLine: foolsMate }),
      'no_pending_resignation');
    unchanged(game, () => game.resolveTimeout({ verdict: 'mate_possible',
      mateLine: [{ from: 'e2', to: 'e4' }] }), 'invalid_ruling');
    const search = findTimeoutMateWitness(game);
    expect(search.status).toBe('found');
    if (search.status !== 'found') throw new Error('Expected a mate witness');
    expect(game.verifyTimeoutMateLine(search.mateLine)).toBe(true);
    expect(game.resolveTimeout({ verdict: 'mate_possible', mateLine: search.mateLine }))
      .toMatchObject({ accepted: true, game: { status: 'finished', result: {
        outcome: 'win', winner: 'black', reason: 'timeout',
        flaggedSide: 'white', deadlineMs: 300000,
      } } });
    unchanged(game, () => game.resolveTimeout({ verdict: 'mate_possible', mateLine: search.mateLine }),
      'game_finished');
  });

  it('does not mistake search exhaustion for impossibility', () => {
    const game = createGame('casual_concession');
    expect(game.flagTimeout({ flaggedSide: 'white', deadlineMs: 10 }).accepted).toBe(true);
    const before = game.getState();
    expect(findTimeoutMateWitness(game, { maxNodes: 1 })).toEqual({
      status: 'unresolved', reason: 'budget_exhausted', nodesVisited: 1,
    });
    expect(game.getState()).toEqual(before);
  });

  it('rejects invalid timeout metadata without changing state', () => {
    const game = createGame('casual_concession');
    unchanged(game, () => game.flagTimeout({ flaggedSide: 'black', deadlineMs: 10 }), 'invalid_timeout');
    unchanged(game, () => game.flagTimeout({ flaggedSide: 'white', deadlineMs: -1 }), 'invalid_timeout');
    unchanged(game, () => game.flagTimeout({ flaggedSide: 'white', deadlineMs: 1.5 }), 'invalid_timeout');
    unchanged(game, () => game.resolveTimeout({ verdict: 'mate_possible', mateLine: foolsMate }),
      'no_pending_timeout');
  });
});
