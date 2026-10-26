import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { expect, it } from 'vitest';
import type { AccountGame, AccountGames } from '@chess/contracts';
import { appendGamePage, archiveResult, GameArchive, MyGames } from '../src/MyGames';

const game: AccountGame = { id: 'game-1', side: 'white', status: 'active', result: null,
  createdAt: '2026-10-26T10:00:00.000001Z', opponent: null, timeControl: '5+3' };
const page: AccountGames = { account: { id: 'account-1', username: 'player' }, games: [game], next: 'cursor',
  summary: { wins: 3, draws: 2, losses: 1 } };

it('maps saved results relative to the original seat, including aborts and unfinished games', () => {
  expect(archiveResult(game)).toBe('In progress');
  expect(archiveResult({ ...game, status: 'waiting' })).toBe('Waiting to start');
  expect(archiveResult({ ...game, status: 'pending_adjudication' })).toBe('Awaiting decision');
  expect(archiveResult({ ...game, status: 'aborted', result: { outcome: 'aborted', reason: 'first_move' } })).toBe('Aborted');
  for (const side of ['white', 'black'] as const) {
    expect(archiveResult({ ...game, side, status: 'finished', result: { outcome: 'win', winner: side, reason: 'checkmate' } })).toBe('Win');
    expect(archiveResult({ ...game, side, status: 'finished', result: { outcome: 'win', winner: side === 'white' ? 'black' : 'white', reason: 'timeout' } })).toBe('Loss');
    expect(archiveResult({ ...game, side, status: 'finished', result: { outcome: 'draw', reason: 'agreement' } })).toBe('Draw');
  }
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
  expect(html).toContain('Completed linked games');
  expect(html).toContain('not a rating or performance estimate');
  expect(html).toContain('href="/challenge/game-1"');
  expect(html).toContain('Guest</a>');
  expect(html).toContain('linked_player</a>');
  expect(html).toContain('Unavailable');
  expect(html).toContain('5+3');
  expect(html).toContain('scope="col"');
});

it('offers a clear empty archive and exposes loading without any private rows', () => {
  expect(renderToStaticMarkup(createElement(GameArchive, { page: { ...page, games: [] } }))).toContain('No linked games yet');
  const loading = renderToStaticMarkup(createElement(MyGames));
  expect(loading).toContain('role="status"');
  expect(loading).toContain('Loading your games');
  expect(loading).not.toContain('archive-table');
});
