import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import type { ClockState, GameReadResponse, SavedMove } from '@chess/contracts';
import { ClockPanel, displayedMs, firstMoveRemainingMs, formatClock,
  historicalClockMs, siteReplayClockMs } from '../src/ClockPanel';

const running: ClockState = {
  startMode: 'readiness', phase: 'running', ready: { white: true, black: true },
  remainingMs: { white: 300_000, black: 303_000 }, activeSide: 'white',
  deadlineMs: 1_000_300_000, flaggedSide: null, flaggedAtMs: null,
  firstMoveDeadlineMs: { white: null, black: null },
  serverNowMs: 1_000_000_000, outagePolicy: 'continues_through_server_outage',
};

describe('display clocks', () => {
  it.each(['timeout', 'resignation', 'agreement', 'checkmate', 'stalemate', 'disconnect_forfeit'])(
    'uses saved final clocks for %s and move snapshots on earlier positions', reason => {
      const flags = reason === 'timeout';
      const history = [60_000, 56_000, 55_000, 53_000, 52_000].map((remainingMsAfterMove, index) => ({
        ply: index + 1, side: index % 2 === 0 ? 'white' : 'black', remainingMsAfterMove,
      })) as SavedMove[];
      const clocks = { ...running, phase: flags ? 'flagged' : 'stopped', activeSide: null,
        flaggedSide: flags ? 'black' : null, remainingMs: { white: 52_000, black: flags ? 0 : 17_450 } } as const;
      const game = { status: 'finished', history, clocks, result: { reason },
        timeControl: { initialMs: 60_000, incrementMs: 0 } } as GameReadResponse;
      const black = siteReplayClockMs(game, 5, 'black', false);
      expect(black).toBe(flags ? 0 : 17_450);
      expect(siteReplayClockMs(game, 5, 'white', false)).toBe(52_000);
      expect(siteReplayClockMs(game, 4, 'black', false)).toBe(53_000);
      expect(siteReplayClockMs(game, 0, 'white', false)).toBe(60_000);
      expect(siteReplayClockMs(game, 5, 'black', true)).toBeNull();
      expect(siteReplayClockMs({ ...game, status: 'pending_adjudication' }, 5, 'black', false)).toBeUndefined();
      expect(siteReplayClockMs({ ...game, status: 'active' }, 5, 'black', false)).toBeUndefined();
      const html = renderToStaticMarkup(createElement(ClockPanel, {
        clock: clocks, side: 'black', isYou: false, historicalMs: black,
      }));
      expect(html).toContain(flags ? '<span>00:00</span><span class="clock-hundredths">.00</span>' : '00:17');
      expect(html).toContain('data-low-time="true"');
      expect(html).not.toContain('clock-active');
    });
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
    expect(html).not.toContain('Clock paused');
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

  it('keeps the clock panels free of material counts', () => {
    const html = renderToStaticMarkup(createElement(ClockPanel,
      { clock: running, side: 'black', isYou: false }));
    expect(html).not.toContain('material-total');
    expect(html).not.toContain('material points');
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
    expect(historicalClockMs(history, 0, 'white', null, true)).toBeNull();
    expect(historicalClockMs(history, 2, 'black', null, true)).toBe(302_250);
    const shown = renderToStaticMarkup(createElement(ClockPanel,
      { clock: running, side: 'black', isYou: false, historicalMs: 302_250 }));
    expect(shown).toContain('05:03');
    expect(shown).not.toContain('clock-hundredths');
    expect(shown).not.toContain('data-low-time');
    expect(shown).not.toContain('At selected move');
    expect(shown).not.toContain('Stopped');
    expect(shown).not.toContain('clock-active');
    const unavailable = renderToStaticMarkup(createElement(ClockPanel,
      { clock: running, side: 'white', isYou: true, historicalMs: null }));
    expect(unavailable).not.toContain('Time unavailable');
    expect(unavailable).toContain('>—</strong>');
  });

  it('shows the player rating and clock without status labels in each clock mode', () => {
    const clocks: (ClockState | null)[] = [null, running,
      { ...running, startMode: 'first_move' },
      { ...running, startMode: 'first_move', phase: 'stopped', activeSide: null },
      { ...running, phase: 'waiting', ready: { white: false, black: false }, activeSide: null }];
    for (const clock of clocks) {
      const html = renderToStaticMarkup(createElement(ClockPanel, {
        clock, side: 'white', isYou: true,
        rating: { rating: 1654, provisional: false }, playerNames: { white: 'Ada', black: 'Ben' },
      }));
      expect(html).toContain('Your white clock');
      expect(html).toContain('>Ada</span>');
      expect(html).toContain('1654');
      expect(html).toContain(clock ? '05:00' : 'Untimed');
      expect(html).not.toMatch(/Running|Stopped|Clock paused|Ready|Not ready|Earlier untimed game/);
    }
  });

  it('warns at thirty seconds in live and historical clocks with smaller hundredths', () => {
    const live = renderToStaticMarkup(createElement(ClockPanel, { clock: {
      ...running, remainingMs: { ...running.remainingMs, white: 30_000 },
    }, side: 'white', isYou: true }));
    const history = renderToStaticMarkup(createElement(ClockPanel, {
      clock: running, side: 'black', isYou: false, historicalMs: 29_450,
    }));
    expect(live).toContain('clock-active');
    expect(live).toContain('Low time');
    expect(live).toContain('clock-hundredths');
    expect(history).not.toContain('clock-active');
    expect(history).toContain('<span>00:29</span><span class="clock-hundredths">.45</span>');
    for (const html of [live, history]) {
      expect(html).toContain('data-low-time="true"');
      expect(html).toContain('<span class="visually-hidden">Low time </span>');
      expect(html).not.toContain('>!</span>');
    }
    const css = readFileSync(new URL('../src/style.css', import.meta.url), 'utf8');
    expect(live).toContain('class="player-clock-value" data-side="white"');
    expect(history).toContain('class="player-clock-value" data-side="black"');
    for (const side of ['white', 'black']) {
      expect(css).toContain(`.player-clock-value[data-side="${side}"] { background: var(--evaluation-${side}); color: var(--evaluation-${side}-text); }`);
    }
    expect(css).toContain('.player-clock-value[data-low-time] { background: var(--color-danger); color: var(--evaluation-white); opacity: 1; }');
    expect(css).toMatch(/\.clock-hundredths[^}]*font-size: \.58em/);
  });

  it('only emphasizes a running clock', () => {
    for (const phase of ['handoff', 'stopped', 'flagged', 'awaiting_first_move'] as const) {
      const html = renderToStaticMarkup(createElement(ClockPanel, {
        clock: { ...running, phase }, side: 'white', isYou: true,
      }));
      expect(html).not.toContain('clock-active');
    }
  });

  it('emphasizes the replay turn and displays the supplied balance without reporting a live clock', () => {
    const html = renderToStaticMarkup(createElement(ClockPanel, {
      clock: { ...running, firstMoveDeadlineMs: { white: 1_000_030_000, black: null } },
      side: 'white', isYou: true, historicalMs: 291_000, isReplayTurn: true,
    }));
    expect(html).toContain('clock-replay-turn');
    expect(html).toContain('04:51');
    expect(html).not.toContain('clock-active');
    expect(html).not.toContain('05:00');
    expect(html).not.toContain('first-move-countdown');
  });
});
