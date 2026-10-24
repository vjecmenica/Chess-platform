import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { importPgn } from '../src/pgn-import';
import { moveTimes, simplePgnTimeControl } from '../src/move-times';
import { MoveTimes, moveTimeDescription } from '../src/MoveTimes';
import { moveTimeTooltipPosition, recordedClockSegments } from '../src/move-times-chart';

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
    const html = renderToStaticMarkup(createElement(MoveTimes,
      { game, selectedPly: 3, onSelectPly: () => {} }));
    expect(html).not.toContain('>White above<');
    expect(html).not.toContain('>Black below<');
    expect(html).not.toContain('max-width:');
    expect(html).toContain('2. Nf3 · 5.0 seconds spent · 04:56 remaining');
    expect(html).toContain('aria-current="step"');
    expect(html).toContain('1. e4 · time spent unavailable · 04:58 remaining');
    expect(html.match(/move-time-bar/g)).toHaveLength(2);
    expect(html.match(/move-time-gap/g)).toHaveLength(2);
    expect(moveTimeDescription(moveTimes(game)[2]!, null)).toContain('recorded clock unavailable');
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
    expect(renderToStaticMarkup(createElement(MoveTimes,
      { game: imported, selectedPly: null, onSelectPly: () => {} })))
      .toBe('');
    const unknownControl = { ...imported, timeControl: { source: 'pgn' as const, raw: '40/7200:3600' } };
    expect(moveTimes(unknownControl).every(move => move.elapsedMs === null)).toBe(true);
  });

  it('keeps long main lines chronological with one focusable bar per ply', () => {
    const short = importPgn('[TimeControl "300+3"]\n\n1. Nf3 {[%clk 0:04:58]} Nf6 {[%clk 0:04:59]} '
      + '2. Ng1 {[%clk 0:04:56]} Ng8 {[%clk 0:04:57]} *', 'short').game;
    const game = { ...short, history: Array.from({ length: 100 }, (_, index) => ({
      ...short.history[index % 4]!, ply: index + 1,
      side: index % 2 === 0 ? 'white' as const : 'black' as const,
      remainingMsAfterMove: 300_000 - index * 1000,
    })) };
    const html = renderToStaticMarkup(createElement(MoveTimes,
      { game, selectedPly: 50, onSelectPly: () => {} }));
    expect(html.match(/class="move-time-column/g)).toHaveLength(100);
    expect(html).toContain('min-width:1300px');
    expect(html).not.toContain('max-width:');
    expect(html).toContain('aria-current="step"');
    expect(html).toContain('50... Ng8');
  });

  it('breaks each clock line at that player’s missing sample without adding clock values', () => {
    const game = importPgn('1. e4 e5 2. Nf3 Nc6 3. Bb5 a6 4. Ba4 Nf6 *', 'gaps').game;
    const samples = [300_000, 200_000, null, 190_000, 290_000, null, 280_000, 180_000];
    const history = game.history.map((move, index) => ({ ...move, remainingMsAfterMove: samples[index]! }));
    const segments = recordedClockSegments(history);
    expect(segments.map(segment => ({ side: segment.side,
      samples: segment.points.map(point => [point.ply, point.remainingMs]) }))).toEqual([
      { side: 'white', samples: [[1, 300_000]] },
      { side: 'white', samples: [[5, 290_000], [7, 280_000]] },
      { side: 'black', samples: [[2, 200_000], [4, 190_000]] },
      { side: 'black', samples: [[8, 180_000]] },
    ]);
    for (const segment of segments) for (const point of segment.points) {
      expect(point.x).toBeGreaterThan(0);
      expect(point.x).toBeLessThan(1000);
      expect(segment.side === 'white' ? point.y < 120 : point.y > 120).toBe(true);
    }
    expect(recordedClockSegments(game.history)).toEqual([]);
  });

  it('keeps tooltip data honest and positions it within desktop and mobile edges', () => {
    expect(moveTimeDescription({ ply: 4, side: 'black', san: 'exd5', elapsedMs: null }, null))
      .toBe('2... exd5 · time spent unavailable · recorded clock unavailable');
    expect(moveTimeDescription({ ply: 5, side: 'white', san: 'Nf3', elapsedMs: 1250 }, 29_450))
      .toBe('3. Nf3 · 1.3 seconds spent · 00:29.45 remaining');
    for (const width of [390, 1440]) {
      for (const anchor of [{ left: 0, right: 13, top: 0, bottom: 20 },
        { left: width - 13, right: width, top: 800, bottom: 840 }]) {
        const position = moveTimeTooltipPosition(anchor, { width: 260, height: 90 }, { width, height: 844 });
        expect(position.left).toBeGreaterThanOrEqual(8);
        expect(position.left + 260).toBeLessThanOrEqual(width - 8);
        expect(position.top).toBeGreaterThanOrEqual(8);
        expect(position.top + 90).toBeLessThanOrEqual(836);
      }
    }
  });
});
