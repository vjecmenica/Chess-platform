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

  it('rejects unsupported annotations and variations rather than dropping them', () => {
    expect(() => parsePgn('1. e4 (1. d4) e5 *')).toThrow('one main line');
    expect(() => parsePgn('1. e4 {idea} e5 *')).toThrow('one main line');
    expect(() => parsePgn('1. e4 $1 e5 *')).toThrow('one main line');
  });
});
