import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { expect, it } from 'vitest';
import type { AccountGame, AccountGames } from '@chess/contracts';
import { appendGamePage, archiveResult, GameArchive, AccountPage, accountSection,
  AccountProfileHeader, AccountOverview, AccountStats } from '../src/MyGames';

const game: AccountGame = { id: 'game-1', side: 'white', status: 'active', result: null,
  createdAt: '2026-10-26T10:00:00.000001Z', opponent: null, timeControl: '5+3' };
const page: AccountGames = { account: { id: 'account-1', username: 'player' }, games: [game], next: 'cursor',
  summary: { wins: 3, draws: 2, losses: 1 } };

it('formats final results from White’s perspective and never assigns a score to unfinished or aborted games', () => {
  expect(archiveResult(game)).toBe('In progress');
  expect(archiveResult({ ...game, status: 'waiting' })).toBe('Waiting to start');
  expect(archiveResult({ ...game, status: 'pending_adjudication' })).toBe('Awaiting decision');
  expect(archiveResult({ ...game, status: 'aborted', result: { outcome: 'aborted', reason: 'first_move' } })).toBe('Aborted');
  for (const side of ['white', 'black'] as const) {
    expect(archiveResult({ ...game, side, status: 'finished', result: { outcome: 'win', winner: 'white', reason: 'checkmate' } })).toBe('1-0');
    expect(archiveResult({ ...game, side, status: 'finished', result: { outcome: 'win', winner: 'black', reason: 'timeout' } })).toBe('0-1');
    expect(archiveResult({ ...game, side, status: 'finished', result: { outcome: 'draw', reason: 'agreement' } })).toBe('½–½');
  }
  expect(archiveResult({ ...game, status: 'pending_adjudication', result: { outcome: 'win', winner: 'black', reason: 'timeout' } })).toBe('Awaiting decision');
});

it('appends pages without losing earlier games or duplicating retries and replaces data for another account', () => {
  const next = { ...page, games: [game, { ...game, id: 'game-2' }], next: null };
  const merged = appendGamePage(page, next);
  expect(merged.games.map(g => g.id)).toEqual(['game-1', 'game-2']);
  expect(appendGamePage(merged, next)).toEqual(merged);
  expect(merged.next).toBeNull();
  const other = { ...next, account: { id: 'account-2', username: 'other' }, games: [] };
  expect(appendGamePage(merged, other)).toEqual(other);
});

it('renders private results, linked names, guest and unknown-time fallbacks, and real game links', () => {
  const html = renderToStaticMarkup(createElement(GameArchive, { page: { ...page,
    games: [game, { ...game, id: 'game-2', side: 'black', opponent: 'linked_player', timeControl: null }] } }));
  expect(html).toContain('href="/challenge/game-1"');
  expect(html).toContain('<strong>Guest</strong>');
  expect(html).toContain('<strong>linked_player</strong>');
  expect(html).toContain('Unavailable');
  expect(html).toContain('5+3');
  expect(html).toContain('aria-label="Your linked games, newest first"');
});

it('puts White above Black and makes each entire row a native new-tab link with honest rating placeholders', () => {
  for (const side of ['white', 'black'] as const) {
    const html = renderToStaticMarkup(createElement(GameArchive, { page: { ...page,
      games: [{ ...game, side, opponent: 'opponent' }] } }));
    const white = side === 'white' ? 'player' : 'opponent';
    const black = side === 'black' ? 'player' : 'opponent';
    expect(html.indexOf(`<strong>${white}</strong>`)).toBeLessThan(html.indexOf(`<strong>${black}</strong>`));
    expect(html).toContain(`aria-label="White: ${white}. Black: ${black}. In progress. Opens in a new tab."`);
    expect(html).toContain('<li><a class="archive-game" href="/challenge/game-1" target="_blank" rel="noopener"');
    expect(html).toContain('</time></a></li>');
    expect(html.match(/aria-label="Site rating unavailable">—/g)).toHaveLength(2);
    expect(html).not.toMatch(/<tr|<button|onclick/i);
  }
});

it('uses refreshable section links with one accessible current section and an Edit profile destination', () => {
  for (const section of ['overview', 'games', 'stats', 'settings'] as const) {
    expect(accountSection(`#${section}`)).toBe(section);
    const html = renderToStaticMarkup(createElement(AccountProfileHeader, { section,
      state: { account: page.account, createdAt: '2026-10-28T10:00:00Z', guestLinked: false } }));
    expect(html).toContain(`<a href="#${section}" aria-current="location">`);
    expect(html.match(/aria-current=/g)).toHaveLength(1);
    expect(html).toContain('href="#settings">Edit profile');
    expect(html).toContain('<h1>player</h1>');
    expect(html).toContain('dateTime="2026-10-28T10:00:00Z"');
    expect(html).not.toContain('role="tab"');
  }
  expect(accountSection('')).toBe('overview');
  expect(accountSection('#someone-else')).toBe('overview');
});

it('previews only five recent games without changing archive order, totals, or pagination', () => {
  const many = { ...page, games: Array.from({ length: 8 }, (_, i) => ({ ...game, id: `game-${i}` })) };
  const html = renderToStaticMarkup(createElement(AccountOverview, { page: many }));
  expect(html.match(/href="\/challenge\//g)).toHaveLength(5);
  expect(html.indexOf('/challenge/game-0')).toBeLessThan(html.indexOf('/challenge/game-4'));
  expect(html).not.toContain('/challenge/game-5');
  expect(html).toContain('href="#games">View all games');
  expect(html).toContain('Ratings are not available yet');
  expect(html).toContain('<dt>Wins</dt><dd>3</dd>');
  expect(renderToStaticMarkup(createElement(GameArchive, { page: many })).match(/href="\/challenge\//g)).toHaveLength(8);
  expect(many.games).toHaveLength(8);
  expect(many.next).toBe('cursor');
});

it('derives Stats from all completed result counts rather than the loaded page and handles zero games', () => {
  const html = renderToStaticMarkup(createElement(AccountStats, { summary: page.summary }));
  expect(html).toContain('<strong>6</strong> completed linked games');
  expect(html).toContain('not a rating or performance estimate');
  expect(html).toContain('Aborted games are excluded');
  const empty = renderToStaticMarkup(createElement(AccountStats, { summary: { wins: 0, draws: 0, losses: 0 } }));
  expect(empty).toContain('<strong>0</strong>');
  expect(empty).toContain('after a linked game finishes');
  expect(empty).not.toMatch(/NaN|Infinity/);
});

it('offers a clear empty archive and exposes loading without any private rows', () => {
  expect(renderToStaticMarkup(createElement(GameArchive, { page: { ...page, games: [] } }))).toContain('No account games yet');
  const loading = renderToStaticMarkup(createElement(AccountPage));
  expect(loading).toContain('role="status"');
  expect(loading).toContain('Loading account and games');
  expect(loading).not.toContain('archive-game');
});
