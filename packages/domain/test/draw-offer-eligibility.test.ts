import { Chess } from 'chess.js';
import { describe, expect, it } from 'vitest';
import { createGame, type ChessGame } from '../src/index.js';

function playPawnMovesTo(game: ChessGame, targetPly: number) {
  while (game.getHistory().length < targetPly) {
    const state = game.getState();
    const choice = new Chess(state.position.fen).moves({ verbose: true })
      .find(move => move.piece === 'p' && move.promotion === undefined);
    if (!choice) throw new Error('Fixture ran out of legal pawn moves.');
    const result = game.submitMove({ side: state.position.sideToMove,
      from: choice.from, to: choice.to });
    expect(result.accepted).toBe(true);
  }
}

function rejectedWithoutChange(game: ChessGame, side: 'white' | 'black', reason: string) {
  const before = game.getState();
  const eligibility = game.getDrawOfferNextEligiblePly();
  expect(game.offerDraw({ side })).toMatchObject({ accepted: false, reason });
  expect(game.getState()).toEqual(before);
  expect(game.getDrawOfferNextEligiblePly()).toEqual(eligibility);
}

describe('draw offer eligibility', () => {
  it('requires two played half-moves for either player', () => {
    const game = createGame();
    expect(game.getDrawOfferNextEligiblePly()).toEqual({ white: 2, black: 2 });
    for (const ply of [0, 1]) {
      expect(game.getHistory()).toHaveLength(ply);
      rejectedWithoutChange(game, 'white', 'draw_offer_too_early');
      rejectedWithoutChange(game, 'black', 'draw_offer_too_early');
      playPawnMovesTo(game, ply + 1);
    }
    expect(game.offerDraw({ side: 'white' }).accepted).toBe(true);
  });

  it('starts an independent 21-ply cooldown from each accepted offer, even after decline', () => {
    const game = createGame();
    playPawnMovesTo(game, 2);
    expect(game.offerDraw({ side: 'white' }).accepted).toBe(true);
    expect(game.declineDraw({ side: 'black' }).accepted).toBe(true);
    expect(game.getDrawOfferNextEligiblePly()).toEqual({ white: 23, black: 2 });
    rejectedWithoutChange(game, 'white', 'draw_offer_cooldown');
    expect(game.offerDraw({ side: 'black' }).accepted).toBe(true);
    expect(game.declineDraw({ side: 'white' }).accepted).toBe(true);
    expect(game.getDrawOfferNextEligiblePly()).toEqual({ white: 23, black: 23 });
    playPawnMovesTo(game, 22);
    rejectedWithoutChange(game, 'white', 'draw_offer_cooldown');
    rejectedWithoutChange(game, 'black', 'draw_offer_cooldown');
    playPawnMovesTo(game, 23);
    expect(game.offerDraw({ side: 'white' }).accepted).toBe(true);
    expect(game.getDrawOfferNextEligiblePly()).toEqual({ white: 44, black: 23 });
  });

  it('retains cooldown after an offer expires on the opponent move', () => {
    const game = createGame();
    playPawnMovesTo(game, 2);
    expect(game.offerDraw({ side: 'white' }).accepted).toBe(true);
    playPawnMovesTo(game, 3);
    expect(game.getState().drawOffer).toBe('white');
    playPawnMovesTo(game, 4);
    expect(game.getState().drawOffer).toBeNull();
    expect(game.getDrawOfferNextEligiblePly()).toEqual({ white: 23, black: 2 });
    rejectedWithoutChange(game, 'white', 'draw_offer_cooldown');
  });

  it('can replay an older accepted early offer without allowing another early offer', () => {
    const game = createGame();
    expect(game.replayAcceptedDrawOffer({ side: 'white' }).accepted).toBe(true);
    expect(game.declineDraw({ side: 'black' }).accepted).toBe(true);
    expect(game.getDrawOfferNextEligiblePly()).toEqual({ white: 21, black: 2 });
    rejectedWithoutChange(game, 'white', 'draw_offer_too_early');
    playPawnMovesTo(game, 2);
    rejectedWithoutChange(game, 'white', 'draw_offer_cooldown');
  });
});
