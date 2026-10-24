import { Children, createElement, isValidElement, type ReactNode } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import { importPgn } from '../src/pgn-import';
import { moveTimes } from '../src/move-times';
import { summarizeMoveTimes } from '../src/move-times-chart';
import { TimeManagementSummary } from '../src/TimeManagementSummary';

const complete = () => importPgn('[TimeControl "300+3"]\n\n'
  + '1. e4 {[%clk 0:05:00]} e5 {[%clk 0:04:59]} '
  + '2. Nf3 {[%clk 0:04:51]} Nc6 {[%clk 0:04:54]} '
  + '3. Bb5 {[%clk 0:04:45]} a6 {[%clk 0:04:40]} *', 'complete').game;

function findButton(node: ReactNode, label: string): (() => void) | undefined {
  for (const child of Children.toArray(node)) {
    if (!isValidElement<{ children?: ReactNode; 'aria-label'?: string; onClick?: () => void }>(child)) continue;
    if (child.type === 'button' && child.props['aria-label'] === label) return child.props.onClick;
    const found = findButton(child.props.children, label);
    if (found) return found;
  }
  return undefined;
}

describe('time management summary', () => {
  it('uses measured durations for each average and longest move, including increment', () => {
    const game = complete();
    const summary = summarizeMoveTimes(game.history, moveTimes(game));
    expect(summary.white).toEqual({ totalMoves: 3, measuredMoves: 2, averageMs: 10_500,
      longest: expect.objectContaining({ ply: 3, san: 'Nf3', elapsedMs: 12_000 }),
      lastRecorded: { ply: 5, san: 'Bb5', remainingMs: 285_000 } });
    expect(summary.black).toEqual({ totalMoves: 3, measuredMoves: 2, averageMs: 12_500,
      longest: expect.objectContaining({ ply: 6, san: 'a6', elapsedMs: 17_000 }),
      lastRecorded: { ply: 6, san: 'a6', remainingMs: 280_000 } });
  });

  it('reports partial coverage and the last recorded sample even when later samples are absent', () => {
    const game = importPgn('[TimeControl "300+3"]\n\n1. e4 {[%clk 0:05:00]} e5 '
      + '2. Nf3 {[%clk 0:04:53]} Nc6 3. Bb5 a6 4. Ba4 Nf6 *', 'partial').game;
    const summary = summarizeMoveTimes(game.history, moveTimes(game));
    expect(summary.white).toMatchObject({ totalMoves: 4, measuredMoves: 1, averageMs: 10_000,
      lastRecorded: { ply: 3, san: 'Nf3', remainingMs: 293_000 } });
    expect(summary.black).toEqual({ totalMoves: 4, measuredMoves: 0,
      averageMs: null, longest: null, lastRecorded: null });
    const html = renderToStaticMarkup(createElement(TimeManagementSummary,
      { summaries: summary, onSelectPly: () => {} }));
    expect(html).toContain('1 of 4 moves measured');
    expect(html).toContain('0 of 4 moves measured');
    expect(html).toContain('Last recorded clock');
    expect(html).toContain('Unavailable');
    expect(html).not.toContain('Final clock');
  });

  it('counts a measured zero think and preserves the site free-first-move rule', () => {
    const imported = importPgn('1. e4 e5 2. Nf3 Nc6 *', 'source').game;
    const samples = [300_000, 299_000, 300_000, 299_000];
    const game = { ...imported, timeControl: { initialMs: 300_000, incrementMs: 0 },
      history: imported.history.map((move, index) => ({ ...move, remainingMsAfterMove: samples[index]! })) };
    const summary = summarizeMoveTimes(game.history, moveTimes(game));
    expect(summary.white).toMatchObject({ measuredMoves: 1, totalMoves: 2, averageMs: 0,
      longest: { ply: 3, elapsedMs: 0 } });
    expect(summary.black).toMatchObject({ measuredMoves: 2, averageMs: 500,
      longest: { ply: 2, elapsedMs: 1000 } });
    expect(summarizeMoveTimes([], [])).toEqual({
      white: { totalMoves: 0, measuredMoves: 0, longest: null, averageMs: null, lastRecorded: null },
      black: { totalMoves: 0, measuredMoves: 0, longest: null, averageMs: null, lastRecorded: null },
    });
  });

  it('selects the matching mainline ply from either player’s longest-think control', () => {
    const game = complete();
    const onSelectPly = vi.fn();
    const view = TimeManagementSummary({ summaries: summarizeMoveTimes(game.history, moveTimes(game)), onSelectPly });
    const white = findButton(view, "Show White's longest measured think: 2. Nf3");
    const black = findButton(view, "Show Black's longest measured think: 3... a6");
    expect(white).toBeDefined();
    expect(black).toBeDefined();
    white!(); black!();
    expect(onSelectPly.mock.calls).toEqual([[3], [6]]);
  });
});
