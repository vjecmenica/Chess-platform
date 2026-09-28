import { describe, expect, it } from 'vitest';
import {
  createGame, createPosition, STANDARD_STARTING_FEN,
  type ChessGame, type GameResult, type Promotion, type Side, type SideCommand,
} from '../src/index.js';

function play(game: ChessGame, ...moves: string[]): void {
  for (const uci of moves) {
    const result = game.submitMove({
      side: game.getState().position.sideToMove,
      from: uci.slice(0, 2), to: uci.slice(2, 4),
      ...(uci[4] ? { promotion: uci[4] as Promotion } : {}),
    });
    expect(result.accepted, `Fixture move ${uci}: ${JSON.stringify(result)}`).toBe(true);
  }
}

function rejectUnchanged(game: ChessGame, command: () => unknown, reason: string): void {
  const before = game.getState();
  const history = game.getHistory();
  expect(command()).toMatchObject({ accepted: false, reason, message: expect.any(String) });
  expect(game.getState()).toEqual(before);
  expect(game.getHistory()).toEqual(history);
}

const stalemateMoves = [
  'e2e3', 'a7a5', 'd1h5', 'a8a6', 'h5a5', 'h7h5', 'a5c7', 'a6h6', 'h2h4',
  'f7f6', 'c7d7', 'e8f7', 'd7b7', 'd8d3', 'b7b8', 'd3h7', 'b8c8', 'f7g6', 'c8e6',
];

describe('game lifecycle', () => {
  it('starts active with a standard board, no offer, no result, and no history', () => {
    const game = createGame();
    expect(game.getState()).toEqual({
      status: 'active', result: null, drawOffer: null,
      position: { fen: STANDARD_STARTING_FEN, sideToMove: 'white' },
    });
    expect(game.getHistory()).toEqual([]);
  });

  it.each([
    { winner: 'black', moves: ['f2f3', 'e7e5', 'g2g4', 'd8h4'] },
    { winner: 'white', moves: ['e2e4', 'e7e5', 'f1c4', 'b8c6', 'd1h5', 'g8f6', 'h5f7'] },
  ])('finishes with checkmate by $winner and retains the final move', ({ winner, moves }) => {
    const game = createGame();
    play(game, ...moves.slice(0, -1));
    expect(game.offerDraw({ side: 'white' }).accepted).toBe(true);
    const uci = moves.at(-1)!;
    const last = game.submitMove({ side: winner as Side, from: uci.slice(0, 2), to: uci.slice(2, 4) });
    expect(last).toMatchObject({
      accepted: true, move: { ply: moves.length, uci, san: expect.stringContaining('#') },
      game: { status: 'finished', result: { outcome: 'win', winner, reason: 'checkmate' }, drawOffer: null },
    });
    expect(game.getHistory()).toHaveLength(moves.length);
    const replay = createPosition();
    for (const move of game.getHistory()) expect(replay.submitMove(move).accepted).toBe(true);
    expect(replay.getPosition()).toEqual(game.getState().position);
  });

  it('finishes automatically on stalemate and keeps its final move', () => {
    const game = createGame();
    play(game, ...stalemateMoves.slice(0, -1));
    expect(game.getState().status).toBe('active');
    expect(game.offerDraw({ side: 'white' }).accepted).toBe(true);
    play(game, stalemateMoves.at(-1)!);
    expect(game.getState()).toMatchObject({
      status: 'finished', result: { outcome: 'draw', reason: 'stalemate' }, drawOffer: null,
      position: { sideToMove: 'black' },
    });
    expect(game.getHistory()).toHaveLength(19);
    expect(game.getHistory().at(-1)?.san).toBe('Qe6');
  });

  it.each(['white', 'black'] as const)('allows %s to resign regardless of turn', side => {
    const game = createGame();
    const board = game.getState().position;
    expect(game.resign({ side })).toMatchObject({
      accepted: true, game: { status: 'finished', drawOffer: null,
        result: { outcome: 'win', winner: side === 'white' ? 'black' : 'white', reason: 'resignation' } },
    });
    expect(game.getState().position).toEqual(board);
    expect(game.getHistory()).toEqual([]);
  });

  it('does not silently apply repetition or move-count draw rules', () => {
    const game = createGame();
    for (let i = 0; i < 38; i++) play(game, 'g1f3', 'g8f6', 'f3g1', 'f6g8');
    expect(game.getHistory()).toHaveLength(152);
    expect(game.getState()).toMatchObject({ status: 'active', result: null });
  });

  it('returns detached state, result, and history and isolates game instances', () => {
    const game = createGame();
    const other = createGame();
    play(game, 'e2e4');
    const move = game.getHistory()[0]!;
    Object.assign(move, { san: 'changed', from: 'a1' });
    const response = game.resign({ side: 'black' });
    if (!response.accepted) throw new Error('Fixture resignation failed');
    Object.assign(response.game.position, { fen: 'changed' });
    Object.assign(response.game.result!, { winner: 'black' });
    const snapshot = game.getState();
    Object.assign(snapshot, { status: 'active' });
    expect(game.getState()).toMatchObject({
      status: 'finished', result: { winner: 'white' }, position: { sideToMove: 'black' },
    });
    expect(game.getState().position.fen).not.toBe('changed');
    expect(game.getHistory()[0]).toMatchObject({ san: 'e4', from: 'e2' });
    expect(other.getState()).toMatchObject({ status: 'active', position: { fen: STANDARD_STARTING_FEN } });
  });
});

describe('draw agreement', () => {
  it.each(['white', 'black'] as const)('accepts an offer from %s only through the other side', side => {
    const game = createGame();
    play(game, 'e2e4', 'e7e5');
    const board = game.getState().position;
    const history = game.getHistory();
    expect(game.offerDraw({ side })).toMatchObject({
      accepted: true, game: { status: 'active', result: null, drawOffer: side },
    });
    expect(game.acceptDraw({ side: side === 'white' ? 'black' : 'white' })).toMatchObject({
      accepted: true, game: { status: 'finished', result: { outcome: 'draw', reason: 'agreement' }, drawOffer: null },
    });
    expect(game.getState().position).toEqual(board);
    expect(game.getHistory()).toEqual(history);
  });

  it('requires a move from both sides before an offer', () => {
    const game = createGame();
    rejectUnchanged(game, () => game.offerDraw({ side: 'white' }), 'draw_too_early');
    play(game, 'e2e4');
    rejectUnchanged(game, () => game.offerDraw({ side: 'black' }), 'draw_too_early');
  });

  it('rejects responses without an offer, self-responses, and duplicate or crossed offers', () => {
    const game = createGame();
    play(game, 'e2e4', 'e7e5');
    rejectUnchanged(game, () => game.acceptDraw({ side: 'black' }), 'no_draw_offer');
    rejectUnchanged(game, () => game.declineDraw({ side: 'white' }), 'no_draw_offer');
    expect(game.offerDraw({ side: 'white' }).accepted).toBe(true);
    rejectUnchanged(game, () => game.acceptDraw({ side: 'white' }), 'own_draw_offer');
    rejectUnchanged(game, () => game.declineDraw({ side: 'white' }), 'own_draw_offer');
    for (const side of ['white', 'black'] as const) {
      rejectUnchanged(game, () => game.offerDraw({ side }), 'draw_offer_pending');
    }
  });

  it('declines without ending the game and permits a later offer', () => {
    const game = createGame();
    play(game, 'e2e4', 'e7e5');
    const before = game.getState();
    expect(game.offerDraw({ side: 'white' }).accepted).toBe(true);
    expect(game.declineDraw({ side: 'black' })).toEqual({ accepted: true, game: before });
    rejectUnchanged(game, () => game.declineDraw({ side: 'black' }), 'no_draw_offer');
    expect(game.offerDraw({ side: 'black' }).accepted).toBe(true);
  });

  it('preserves an offer through the offerer’s move and all rejected moves, then declines on the recipient’s move', () => {
    const game = createGame();
    play(game, 'e2e4', 'e7e5');
    expect(game.offerDraw({ side: 'white' }).accepted).toBe(true);
    play(game, 'g1f3');
    expect(game.getState().drawOffer).toBe('white');
    rejectUnchanged(game, () => game.submitMove({ side: 'white', from: 'f3', to: 'g1' }), 'wrong_turn');
    rejectUnchanged(game, () => game.submitMove({ side: 'black', from: 'e5', to: 'e3' }), 'illegal_move');
    rejectUnchanged(game, () => game.submitMove({ side: 'black', from: 'z9', to: 'e3' }), 'invalid_input');
    play(game, 'b8c6');
    expect(game.getState()).toMatchObject({ status: 'active', result: null, drawOffer: null });
    rejectUnchanged(game, () => game.acceptDraw({ side: 'black' }), 'no_draw_offer');
  });
});

const sideMethods = ['resign', 'offerDraw', 'acceptDraw', 'declineDraw'] as const;
describe('invalid acting sides', () => {
  it.each(sideMethods)('rejects invalid and missing sides for %s without changing an offer', method => {
    const game = createGame();
    play(game, 'e2e4', 'e7e5');
    expect(game.offerDraw({ side: 'white' }).accepted).toBe(true);
    for (const command of [{ side: 'spectator' }, {}]) {
      rejectUnchanged(game, () => game[method](command as SideCommand), 'invalid_side');
    }
  });

  it('rejects a move from an invalid side', () => {
    const game = createGame();
    rejectUnchanged(game, () => game.submitMove({ side: 'spectator' as Side, from: 'e2', to: 'e4' }), 'invalid_side');
  });
});

const endings: { name: string; finish: (game: ChessGame) => void; result: GameResult }[] = [
  { name: 'checkmate', finish: game => play(game, 'f2f3', 'e7e5', 'g2g4', 'd8h4'),
    result: { outcome: 'win', winner: 'black', reason: 'checkmate' } },
  { name: 'stalemate', finish: game => play(game, ...stalemateMoves),
    result: { outcome: 'draw', reason: 'stalemate' } },
  { name: 'resignation', finish: game => {
    play(game, 'e2e4', 'e7e5');
    expect(game.offerDraw({ side: 'white' }).accepted).toBe(true);
    expect(game.resign({ side: 'black' }).accepted).toBe(true);
  }, result: { outcome: 'win', winner: 'white', reason: 'resignation' } },
  { name: 'agreement', finish: game => {
    play(game, 'e2e4', 'e7e5');
    expect(game.offerDraw({ side: 'white' }).accepted).toBe(true);
    expect(game.acceptDraw({ side: 'black' }).accepted).toBe(true);
  }, result: { outcome: 'draw', reason: 'agreement' } },
];

describe.each(endings)('after $name', ({ finish, result }) => {
  it('rejects all move and result commands, including terminal retries, without changing state', () => {
    const game = createGame();
    finish(game);
    expect(game.getState()).toMatchObject({ status: 'finished', result, drawOffer: null });
    for (const side of ['white', 'black'] as const) {
      rejectUnchanged(game, () => game.submitMove({ side, from: 'g1', to: 'f3' }), 'game_finished');
      for (const method of sideMethods) rejectUnchanged(game, () => game[method]({ side }), 'game_finished');
    }
    const lastMove = game.getHistory().at(-1)!;
    rejectUnchanged(game, () => game.submitMove(lastMove), 'game_finished');
    rejectUnchanged(game, () => game.resign({ side: 'spectator' as Side }), 'game_finished');
  });
});
