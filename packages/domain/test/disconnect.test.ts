import { expect, it } from 'vitest';
import { createGame, createGameFromPosition } from '../src/index.js';

it('uses the same practical no-mate exception and preserves move history for a disconnect', () => {
  const game = createGameFromPosition('4k3/8/8/8/8/8/8/R3K3 w - - 0 1', 'casual_concession');
  expect(game.submitMove({ side: 'white', from: 'a1', to: 'a2' }).accepted).toBe(true);
  expect(game.submitMove({ side: 'black', from: 'e8', to: 'e7' }).accepted).toBe(true);
  const history = game.getHistory().slice();
  expect(game.forfeitDisconnect({ disconnectedSide: 'white', deadlineMs: 135_000 })).toMatchObject({
    accepted: true, game: { status: 'finished', result: { outcome: 'draw', reason: 'disconnect_no_mating_possibility',
      disconnectedSide: 'white', deadlineMs: 135_000 } },
  });
  expect(game.getHistory()).toEqual(history);
  expect(game.forfeitDisconnect({ disconnectedSide: 'black', deadlineMs: 160_000 }))
    .toMatchObject({ accepted: false, reason: 'game_finished' });
});

it('rejects disconnect forfeits before both players have moved or while a ruling is pending', () => {
  const game = createGame('fide_proof_required');
  const event = { disconnectedSide: 'black', deadlineMs: 135_000 } as const;
  expect(game.forfeitDisconnect(event)).toMatchObject({ accepted: false, reason: 'invalid_disconnect' });
  game.submitMove({ side: 'white', from: 'e2', to: 'e4' });
  game.submitMove({ side: 'black', from: 'e7', to: 'e5' });
  expect(game.resign({ side: 'white' })).toMatchObject({ accepted: true, game: { status: 'pending_adjudication' } });
  expect(game.forfeitDisconnect(event)).toMatchObject({ accepted: false, reason: 'adjudication_pending' });
});
