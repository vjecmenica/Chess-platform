import { describe, expect, it } from 'vitest';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import type { ClockState } from '@chess/contracts';
import { ClockPanel, displayedMs, formatClock } from '../src/ClockPanel';

const running: ClockState = {
  startMode: 'readiness', phase: 'running', ready: { white: true, black: true },
  remainingMs: { white: 300_000, black: 303_000 }, activeSide: 'white',
  deadlineMs: 1_000_300_000, flaggedSide: null, flaggedAtMs: null,
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
    } }));
    expect(html.match(/05:00/g)).toHaveLength(2);
    expect(html.match(/Clock paused/g)).toHaveLength(2);
    expect(html).not.toContain('Not ready');
  });
});
