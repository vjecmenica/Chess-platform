import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { importPgn } from '../src/pgn-import';
import { moveTimes, simplePgnTimeControl } from '../src/move-times';
import { MoveTimes } from '../src/MoveTimes';

describe('recorded move times', () => {
  it('uses simple PGN controls without coercing unsupported metadata', () => {
    expect(simplePgnTimeControl('300+3')).toEqual({ initialMs: 300_000, incrementMs: 3_000 });
    expect(simplePgnTimeControl('600')).toEqual({ initialMs: 600_000, incrementMs: 0 });
    expect(simplePgnTimeControl('40/7200:3600')).toBeNull();
    expect(simplePgnTimeControl('-')).toBeNull();
  });

  it('keeps imported first moves unknown and adds increment between recorded samples', () => {
    const game = importPgn('[TimeControl "300+3"]\n\n1. e4 {[%clk 0:04:58]} e5 {[%clk 0:04:57]} '
      + '2. Nf3 {[%clk 0:04:56]} Nc6 {[%clk 0:04:55]} *', 'timed').game;
    expect(moveTimes(game).map(move => move.elapsedMs)).toEqual([null, null, 5_000, 5_000]);
    const html = renderToStaticMarkup(createElement(MoveTimes, { game, onSelectPly: () => {} }));
    expect(html).toContain('Move times');
    expect(html).toContain('5.0s');
    expect(html).toContain('Show move 3, Nf3');
    expect(html.match(/move-time-bar/g)).toHaveLength(2);
  });

  it('derives the site clock handoff but never invents time for its free first White move', () => {
    const imported = importPgn('1. e4 e5 2. Nf3 Nc6 *', 'source').game;
    const history = imported.history.map((move, index) => ({ ...move,
      remainingMsAfterMove: [300_000, 299_500, 301_000, 301_000][index]! }));
    const game = { ...imported, id: 'site-game', history,
      timeControl: { initialMs: 300_000, incrementMs: 3_000 } };
    expect(moveTimes(game).map(move => move.elapsedMs)).toEqual([null, 3_500, 2_000, 1_500]);
  });

  it('leaves gaps after missing samples and with unknown increments', () => {
    const imported = importPgn('[TimeControl "300+3"]\n\n1. e4 {[%clk 0:04:58]} e5 '
      + '2. Nf3 {[%clk broken]} Nc6 {[%clk 0:04:55]} 3. Bb5 {[%clk 0:04:51]} *', 'missing').game;
    expect(moveTimes(imported).map(move => move.elapsedMs)).toEqual([null, null, null, null, null]);
    expect(renderToStaticMarkup(createElement(MoveTimes, { game: imported, onSelectPly: () => {} })))
      .toBe('');
    const unknownControl = { ...imported, timeControl: { source: 'pgn' as const, raw: '40/7200:3600' } };
    expect(moveTimes(unknownControl).every(move => move.elapsedMs === null)).toBe(true);
  });
});
