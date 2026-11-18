import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { expect, it } from 'vitest';
import type { GameReadResponse } from '@chess/contracts';
import { formatRating, formatRatingChange, gamePlayerRating } from '../src/rating-display';
import { importPgn } from '../src/pgn-import';
import { ImportedPlayerRow, PlayerIdentity } from '../src/PlayerIdentity';
import { GameInfo } from '../src/GameInfo';

const before = { rating: 1500.51, provisional: true };
const after = { rating: 1511.49, provisional: false };
const won = { before, after, change: after.rating - before.rating };
const lost = { before: after, after: before, change: -won.change };

it('formats rating changes as the difference between the displayed whole ratings', () => {
  expect(formatRating(null)).toBe('—');
  expect(formatRating(before)).toBe('1501?');
  expect(formatRatingChange(won)).toBe('+10');
  expect(formatRatingChange(lost)).toBe('−10');
  expect(formatRatingChange({ ...won, after: { ...after, rating: 1501.1 } })).toBe('+0');
});

it('uses historical ratings for a finished Rated game and withholds deltas during adjudication and aborts', () => {
  const game: GameReadResponse = { ...importPgn('[Result "*"]\n\n*', 'test-game').game, rated: true, status: 'finished',
    result: { outcome: 'win', winner: 'white', reason: 'checkmate' },
    playerRatings: { source: 'settlement', pool: 'blitz', players: { white: won, black: lost } },
  };
  const html = renderToStaticMarkup(createElement(GameInfo, { game }));
  expect(html).toContain('Provisional rating 1501 before settlement');
  expect(html).toMatch(/data-direction="positive"[^>]*>\+10</);
  expect(html).toMatch(/data-direction="negative"[^>]*>−10</);
  expect(gamePlayerRating({ ...game, rated: false }, 'white')).toBeNull();
  for (const status of ['pending_adjudication', 'aborted'] as const) {
    expect(gamePlayerRating({ ...game, status }, 'white')).toBeNull();
  }
  const identity = renderToStaticMarkup(createElement(PlayerIdentity, { side: 'white', name: 'Player', rating: won }));
  expect(identity).toContain('1501?');
  expect(identity).toContain('+10');
});

it('passes through valid PGN ratings without applying the site display rules', () => {
  const imported = importPgn('[White "Source White"]\n[WhiteElo "2012"]\n[Result "*"]\n\n*', 'pgn');
  expect(renderToStaticMarkup(createElement(ImportedPlayerRow, { imported, side: 'white' }))).toContain('>2012</span>');
  expect(renderToStaticMarkup(createElement(ImportedPlayerRow, { imported, side: 'black' }))).not.toContain('site-rating');
});
