import { describe, expect, it } from 'vitest';
import { createPositionFromFen, parsePgn } from '../src/index.js';

describe('PGN import', () => {
  it('reads headers, a decisive result, and replayable legal moves', () => {
    const game = parsePgn('[Event "Club match"]\n[White "Ada"]\n[Black "Ben"]\n[Result "1-0"]\n\n1. e4 e5 2. Nf3 Nc6 1-0');
    expect(game.headers).toMatchObject({ Event: 'Club match', White: 'Ada', Black: 'Ben', Result: '1-0' });
    expect(game.moves.map(move => move.san)).toEqual(['e4', 'e5', 'Nf3', 'Nc6']);
    expect(game.moves[0]?.beforeFen).toBe(game.startingFen);
    expect(game.moves.at(-1)?.afterFen).toBe(game.finalFen);
    const replay = createPositionFromFen(game.startingFen);
    for (const move of game.moves) {
      const result = replay.submitMove(move);
      expect(result.accepted).toBe(true);
    }
    expect(replay.getPosition().fen).toBe(game.finalFen);
  });

  it('imports an unfinished main line and clearly rejects custom setups', () => {
    const game = parsePgn('1. d4 d5 *');
    expect(game.result).toBe('*');
    expect(() => parsePgn('[SetUp "1"]\n[FEN "8/P7/8/8/8/8/7k/K7 w - - 0 1"]\n\n1. a8=Q *'))
      .toThrow('custom starting position');
  });

  it('rejects malformed headers, mismatched results, and illegal moves', () => {
    expect(() => parsePgn('[Event Club]\n\n1. e4 *')).toThrow('Invalid PGN header');
    expect(() => parsePgn('[Result "1-0"]\n\n1. e4 0-1')).toThrow('does not match');
    expect(() => parsePgn('1. f3 e5 2. g4 Qh4# 1-0')).toThrow('conflicts with checkmate');
    expect(() => parsePgn('1. e4 e5 2. Ke9 *')).toThrow('Invalid PGN syntax or illegal move');
    expect(() => parsePgn('1. e4 e5')).toThrow('must end');
  });

  it('associates mainline comments and clocks with the move occurrence, even after repetition', () => {
    const game = parsePgn('1. Nf3 {First visit [%clk 0:05:00]} Nf6 2. Ng1 Ng8 '
      + '3. Nf3 {Later visit [%clk 0:04:42.25]} Nf6 ;quiet reply\n*');
    expect(game.moves[0]?.beforeFen.split(' ').slice(0, 4))
      .toEqual(game.moves[4]?.beforeFen.split(' ').slice(0, 4));
    expect(game.annotations).toEqual([
      { ply: 1, comment: 'First visit', remainingMsAfterMove: 300_000 },
      { ply: 5, comment: 'Later visit', remainingMsAfterMove: 282_250 },
      { ply: 6, comment: 'quiet reply' },
    ]);
  });

  it('keeps malformed clock directives as comments without changing legal moves', () => {
    const game = parsePgn('1. e4 {[%clk 0:99:00] useful note} e5 {[%clk 4:58]} *');
    expect(game.moves.map(move => move.san)).toEqual(['e4', 'e5']);
    expect(game.annotations).toEqual([
      { ply: 1, comment: '[%clk 0:99:00] useful note' },
      { ply: 2, remainingMsAfterMove: 298_000 },
    ]);
  });

  it('rejects unsupported annotations and variations rather than dropping them', () => {
    expect(() => parsePgn('1. e4 (1. d4) e5 *')).toThrow('one main line');
    expect(() => parsePgn('1. e4 $1 e5 *')).toThrow('one main line');
    expect(() => parsePgn('1. e4 {unfinished e5 *')).toThrow('closing brace');
  });
});
