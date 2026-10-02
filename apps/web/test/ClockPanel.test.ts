import { describe, expect, it } from 'vitest';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import type { ClockState } from '@chess/contracts';
import { ClockPanel, displayedMs, firstMoveRemainingMs, formatClock } from '../src/ClockPanel';

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
    expect(formatClock(1)).toBe('00:01');
    expect(formatClock(0)).toBe('00:00');
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
    expect(html).toContain('First move <b aria-live="off">00:30</b>');
    expect(html).toContain('White first-move deadline, 00:30 remaining');
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
});
