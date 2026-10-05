import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import type { ClockState, SavedMove } from '@chess/contracts';
import { ClockPanel, displayedMs, firstMoveRemainingMs, formatClock,
  historicalClockMs } from '../src/ClockPanel';

const running: ClockState = {
  startMode: 'readiness', phase: 'running', ready: { white: true, black: true },
  remainingMs: { white: 300_000, black: 303_000 }, activeSide: 'white',
  deadlineMs: 1_000_300_000, flaggedSide: null, flaggedAtMs: null,
  firstMoveDeadlineMs: { white: null, black: null },
  serverNowMs: 1_000_000_000, outagePolicy: 'continues_through_server_outage',
};

describe('display clocks', () => {
  it('interpolates only the active side and never invents negative time', () => {
    expect(displayedMs(running, 'white', 1_250)).toBe(298_750);
    expect(displayedMs(running, 'black', 1_250)).toBe(303_000);
    expect(displayedMs(running, 'white', 400_000)).toBe(0);
    expect(displayedMs({ ...running, phase: 'flagged', activeSide: null }, 'white', 400_000)).toBe(300_000);
  });

  it('shows remaining seconds without rounding away the final fraction', () => {
    expect(formatClock(300_000)).toBe('05:00');
    expect(formatClock(30_001)).toBe('00:31');
    expect(formatClock(30_000)).toBe('00:30.00');
    expect(formatClock(29_999)).toBe('00:30.00');
    expect(formatClock(1)).toBe('00:00.01');
    expect(formatClock(12_345)).toBe('00:12.35');
    expect(formatClock(0)).toBe('00:00.00');
  });

  it('shows paused initial clocks without Ready labels for new games', () => {
    const html = renderToStaticMarkup(createElement(ClockPanel, { clock: {
      ...running, startMode: 'first_move', phase: 'awaiting_first_move',
      ready: { white: false, black: false }, activeSide: null, deadlineMs: null,
      remainingMs: { white: 300_000, black: 300_000 },
    }, side: 'white', isYou: true }));
    expect(html).toContain('You');
    expect(html).toContain('White');
    expect(html).toContain('05:00');
    expect(html).toContain('Clock paused');
    expect(html).not.toContain('Not ready');
  });

  it('shows a distinct first-move countdown from the authoritative deadline', () => {
    const grace = { ...running, startMode: 'first_move_grace' as const,
      phase: 'awaiting_first_move' as const, activeSide: null,
      firstMoveDeadlineMs: { white: 1_000_030_000, black: null } };
    expect(firstMoveRemainingMs(grace, 'white', 2_000)).toBe(28_000);
    expect(firstMoveRemainingMs(grace, 'white', 40_000)).toBe(0);
    expect(firstMoveRemainingMs(grace, 'black', 2_000)).toBeNull();
    const html = renderToStaticMarkup(createElement(ClockPanel,
      { clock: grace, side: 'white', isYou: false }));
    expect(html).toContain('First move <b aria-live="off"><span>00:30</span><span class="clock-hundredths">.00</span></b>');
    expect(html).toContain('White first-move deadline, 00:30.00 remaining');
    expect(html).toContain('05:00');
  });

  it('labels the opponent and the player by side', () => {
    const opponent = renderToStaticMarkup(createElement(ClockPanel,
      { clock: running, side: 'white', isYou: false }));
    const player = renderToStaticMarkup(createElement(ClockPanel,
      { clock: running, side: 'black', isYou: true }));
    expect(opponent).toContain("Opponent&#x27;s white clock");
    expect(opponent).toContain('clock-active');
    expect(player).toContain('Your black clock');
    expect(player).not.toContain('clock-active');
  });

  it('shows a material lead only on the leading player’s clock', () => {
    const leader = renderToStaticMarkup(createElement(ClockPanel,
      { clock: running, side: 'black', isYou: false, materialAdvantage: 3 }));
    const other = renderToStaticMarkup(createElement(ClockPanel,
      { clock: running, side: 'white', isYou: true, materialAdvantage: null }));
    expect(leader).toContain('>+3</span>');
    expect(leader).toContain('black leads by 3 material points');
    expect(other).not.toContain('material-advantage');
  });

  it('shows only recorded post-move balances while navigating history', () => {
    const history = [
      { ply: 1, side: 'white', remainingMsAfterMove: 300_000 },
      { ply: 2, side: 'black', remainingMsAfterMove: 302_250 },
      { ply: 3, side: 'white', remainingMsAfterMove: null },
    ] as SavedMove[];
    expect(historicalClockMs(history, 0, 'white', 300_000, true)).toBe(300_000);
    expect(historicalClockMs(history, 1, 'black', 300_000, true)).toBe(300_000);
    expect(historicalClockMs(history, 2, 'black', 300_000, true)).toBe(302_250);
    expect(historicalClockMs(history, 3, 'white', 300_000, true)).toBeNull();
    expect(historicalClockMs(history, 2, 'white', 300_000, false)).toBeNull();
    const shown = renderToStaticMarkup(createElement(ClockPanel,
      { clock: running, side: 'black', isYou: false, historicalMs: 302_250 }));
    expect(shown).toContain('05:03');
    expect(shown).not.toContain('clock-hundredths');
    expect(shown).toContain('At selected move');
    expect(shown).not.toContain('clock-active');
    const unavailable = renderToStaticMarkup(createElement(ClockPanel,
      { clock: running, side: 'white', isYou: true, historicalMs: null }));
    expect(unavailable).toContain('Time unavailable');
    expect(unavailable).toContain('>—</strong>');
  });

  it('warns at thirty seconds in live and historical clocks with smaller hundredths', () => {
    const live = renderToStaticMarkup(createElement(ClockPanel, { clock: {
      ...running, remainingMs: { ...running.remainingMs, white: 30_000 },
    }, side: 'white', isYou: true }));
    const history = renderToStaticMarkup(createElement(ClockPanel, {
      clock: running, side: 'black', isYou: false, historicalMs: 29_450,
    }));
    expect(live).toContain('clock-active clock-warning');
    expect(live).toContain('clock-hundredths');
    expect(history).toContain('clock-warning');
    expect(history).toContain('<span>00:29</span><span class="clock-hundredths">.45</span>');
    const css = readFileSync(new URL('../src/style.css', import.meta.url), 'utf8');
    expect(css).toMatch(/\.clock-warning[^}]*background: #fff0e9/);
    expect(css).toMatch(/\.clock-hundredths[^}]*font-size: \.58em/);
  });
});
