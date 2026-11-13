import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { BoardUtilities } from '../src/BoardUtilities';
import { ChatMessage, ChatUnreadBadge } from '../src/GameChat';
import { ClosedRematchStatus } from '../src/GameRematch';
import { importPgn } from '../src/pgn-import';
import { canExportGame } from '../src/pgn-export';

describe('workspace utility presentation', () => {
  it.each([1, 12, 100])('retains a readable numeric unread badge for %i entries', count => {
    const html = renderToStaticMarkup(createElement(ChatUnreadBadge, { count }));
    expect(html).toContain(`aria-label="${count} unread entries"`);
    expect(html).toContain(`>${count}</span>`);
    expect(renderToStaticMarkup(createElement(ChatUnreadBadge, { count: 0 }))).toBe('');
  });

  it.each(['offered a draw.', 'accepted the draw offer.', 'declined the rematch offer.',
    'rematch offer expired (no acceptance received).'])('omits only the final system period: %s', text => {
    const item = { id: '1', side: 'white' as const, kind: 'system' as const, text, sentAt: '2026-11-03T12:00:00Z' };
    const html = renderToStaticMarkup(createElement(ChatMessage, { item, side: 'black', playerNames: { white: 'Alice', black: 'Bob' } }));
    expect(html).toContain(`<em><span class="player-name">Alice</span> ${text.slice(0, -1)}</em>`);
    expect(item.text).toBe(text);
    const typed = renderToStaticMarkup(createElement(ChatMessage, {
      item: { id: item.id, side: item.side, text, sentAt: item.sentAt }, side: 'black',
    }));
    expect(typed).toContain(text);
  });

  it('keeps the accepted rematch destination a styled native keyboard-accessible link', () => {
    const html = renderToStaticMarkup(createElement(ClosedRematchStatus, { offer: {
      id: 'offer', side: 'white', status: 'accepted', newGameId: 'new-game', expiresAt: '2026-11-03T12:00:00Z',
    } }));
    expect(html).toContain('<span>Rematch accepted</span>');
    expect(html).toContain('class="secondary rematch-open" href="/challenge/new-game">Open game</a>');
    expect(html).not.toContain('accepted.Open');
    expect(html).not.toContain('>/challenge/');
  });

  it('offers icon buttons with accessible names while retaining source-game download restrictions', () => {
    for (const id of ['site-game', 'imported-game', 'explorer-5', 'blank-1']) {
      const game = importPgn('1. e4 e5 1-0', id).game;
      const html = renderToStaticMarkup(createElement(BoardUtilities, {
        downloadable: canExportGame(game), onDownload: () => {}, onFlip: () => {},
      }));
      expect(html).toContain('aria-label="Flip board" data-board-display-control="true"');
      expect(html).not.toContain('>Flip board<');
      expect(html).not.toContain('title=');
      expect(html.includes('aria-label="Download PGN"')).toBe(!id.startsWith('explorer-') && !id.startsWith('blank-'));
    }
  });
});
