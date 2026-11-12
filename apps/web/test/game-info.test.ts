import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { expect, it } from 'vitest';
import type { GameReadResponse, SiteGameInfo } from '@chess/contracts';
import { GameInfo, gameInfoTimestamp, liveGameStatus } from '../src/GameInfo';
import { importPgn } from '../src/pgn-import';

const at = '2026-11-02T13:18:36.000Z';
const siteInfo: SiteGameInfo = { variant: 'standard', startedAt: at, acceptedAt: at };
const game: GameReadResponse = { ...importPgn('[Result "*"]\n\n*', 'site-game').game,
  status: 'active', result: null, playerNames: { white: 'walnut', black: null }, siteInfo,
  clockStatus: 'authoritative', timeControl: { initialMs: 180000, incrementMs: 2000 } };
const render = (value: GameReadResponse) => renderToStaticMarkup(createElement(GameInfo, { game: value }));

it('shows actual seat names, honest rating placeholders, time control and supported variant', () => {
  const html = render(game);
  expect(html).toContain('<dt>White</dt><dd><strong>walnut</strong>');
  expect(html).toContain('<dt>Black</dt><dd><strong>Guest</strong>');
  expect(html.match(/Rating unavailable/g)).toHaveLength(2);
  expect(html.match(/>Unrated</g)).toHaveLength(1);
  expect(html).toContain('<dt>Rated status</dt><dd>Unrated</dd>');
  expect(html).toContain('<dt>Variant</dt><dd>Standard</dd>');
  expect(html).toContain('<dt>Time control</dt>');
  expect(html).toContain('>3+2</span>'); expect(html).toContain('>Blitz</small>');
  expect(html).toContain(`<time dateTime="${at}">`);
  expect(html).not.toMatch(/Chess960|rating change|\+8/);
  expect(render({ ...game, clockStatus: 'not_integrated' })).toContain('>Untimed</span>');
});
it('labels the real start or acceptance explicitly and formats date/time with the viewer timezone and UTC offset', () => {
  expect(gameInfoTimestamp(siteInfo, 'UTC')).toMatchObject({ at, label: 'Started (local time)' });
  expect(gameInfoTimestamp(siteInfo, 'UTC')?.text).toMatch(/^Nov 2, 2026, 1:18:36 PM GMT(?:\+0)?$/);
  expect(gameInfoTimestamp(siteInfo, 'Europe/Belgrade')?.text).toBe('Nov 2, 2026, 2:18:36 PM GMT+1');
  const old = { ...siteInfo, startedAt: null };
  expect(gameInfoTimestamp(old, 'UTC')?.label).toBe('Challenge accepted (local time)');
  const legacy = render({ ...game, siteInfo: old });
  expect(legacy).toContain('Challenge accepted (local time)'); expect(legacy).not.toContain('Started (local time)');
  expect(gameInfoTimestamp(undefined)).toBeNull();
  expect(gameInfoTimestamp({ ...siteInfo, startedAt: 'invalid' })).toBeNull();
  expect(render({ ...game, siteInfo: { ...siteInfo, startedAt: null, acceptedAt: null } }))
    .toContain('<dt>Start time</dt><dd>Unavailable</dd>');
});
it('handles live, waiting, pending, finished and aborted games without implying a premature final result', () => {
  for (const [status, label] of [['active', 'In progress'], ['waiting', 'Waiting for players to be ready'],
    ['pending_adjudication', 'Result is being adjudicated'], ['aborted', 'No win or loss recorded']] as const) {
    const html = render({ ...game, status }); expect(html).toContain(label); expect(html).not.toMatch(/>(?:1-0|0-1|½–½) ·/);
  }
  for (const winner of ['white', 'black'] as const) {
    const html = render({ ...game, status: 'finished', result: { outcome: 'win', winner, reason: 'resignation' } });
    expect(html).toContain(`<strong>${winner === 'white' ? '1-0' : '0-1'}</strong> · ${winner === 'white' ? 'White' : 'Black'} won by resignation.`);
  }
  expect(render({ ...game, status: 'finished', result: { outcome: 'draw', reason: 'agreement' } })).toContain('<strong>½–½</strong> · Draw by agreement.');
  expect(render({ ...game, status: 'aborted', result: { outcome: 'aborted', reason: 'first_move_deadline', missedSide: 'black' } }))
    .toContain('Black did not make a first move in time. No win or loss was recorded.');
});
it('shows game details alongside the rest of the compact summary', () => {
  const html = render(game);
  expect(html).toMatch(/<dl>[\s\S]*walnut[\s\S]*In progress[\s\S]*3\+2[\s\S]*Started \(local time\)[\s\S]*Unrated[\s\S]*Standard[\s\S]*<\/dl>/);
  expect(html).not.toContain('More game details');
});
it('removes passive turn copy while preserving actionable adjudication, readiness and history guidance', () => {
  expect(liveGameStatus(game, false)).toBeNull();
  expect(liveGameStatus({ ...game, position: { ...game.position, sideToMove: 'black' } }, false)).toBeNull();
  expect(liveGameStatus(game, true)).toContain('Return to the latest move to play');
  expect(liveGameStatus({ ...game, status: 'waiting' }, false)).toContain('ready');
  expect(liveGameStatus({ ...game, status: 'pending_adjudication', pending: { kind: 'timeout', flaggedSide: 'black', deadlineMs: 100 } }, false))
    .toBe('A clock flagged. Checking the result.');
});
