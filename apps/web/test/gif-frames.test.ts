import { expect, it } from 'vitest';
import { gifFrames, gifMaxPlies } from '../src/gif-frames';
import { importPgn } from '../src/pgn-import';

it('uses the saved starting position and every confirmed main-line position in order', () => {
  const game = importPgn('1. e4 {idea} e5 2. Nf3 Nc6 1-0', 'local').game;
  const frames = gifFrames(game);
  expect(frames).toHaveLength(5);
  expect(frames[0]).toEqual({ fen: game.history[0]!.beforeFen, from: null, to: null });
  expect(frames.slice(1).map(frame => [frame.from, frame.to])).toEqual([
    ['e2', 'e4'], ['e7', 'e5'], ['g1', 'f3'], ['b8', 'c6'],
  ]);
  expect(frames.map(frame => frame.fen)).toEqual([game.history[0]!.beforeFen, ...game.history.map(move => move.afterFen)]);
  expect(() => gifFrames({ ...game, position: { ...game.position, fen: frames[0]!.fen } })).toThrow('confirmed position');
});

it('exports every frame of long games within the bound and declines longer games without dropping moves', () => {
  const pgn = Array.from({ length: gifMaxPlies / 4 }, (_, index) =>
    `${index * 2 + 1}. Nf3 Nf6 ${index * 2 + 2}. Ng1 Ng8`).join(' ');
  expect(gifFrames(importPgn(pgn + ' *', 'local').game)).toHaveLength(gifMaxPlies + 1);
  expect(() => gifFrames(importPgn(pgn + ` ${gifMaxPlies / 2 + 1}. e4 *`, 'local').game))
    .toThrow(`${gifMaxPlies} half-moves`);
});

it('keeps the full-game export restrictions', () => {
  const game = importPgn('1. e4 e5 1-0', 'local').game;
  for (const restricted of [{ ...game, status: 'active' as const }, { ...game, id: 'explorer-12' },
    { ...game, id: 'blank-1' }, { ...game, history: [] }])
    expect(() => gifFrames(restricted)).toThrow('unavailable');
});
