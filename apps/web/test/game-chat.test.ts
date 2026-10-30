import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { expect, it, vi } from 'vitest';
import type { GameChatMessage } from '@chess/contracts';
import { chatComposerState, chatResponse, mergeChatMessages, nearChatBottom } from '../src/game-chat';
import { ChatComposer, ChatMessage, GameChat } from '../src/GameChat';

function message(id: string): GameChatMessage {
  return { id, side: 'white', text: '<b>Plain text</b>', sentAt: '2026-10-24T10:00:00Z' };
}
it('labels existing chat messages from their linked seat rather than the viewer account', () => {
  const playerNames = { white: 'walnut_white', black: 'cream_black' };
  const render = (sender: 'white' | 'black', names = playerNames) => renderToStaticMarkup(
    createElement(ChatMessage, { item: { ...message('1'), side: sender }, side: 'black', playerNames: names }));
  expect(render('white')).toContain('<strong aria-label="walnut_white, opponent">walnut_white</strong>');
  expect(render('black')).toContain('<strong aria-label="cream_black, you">cream_black</strong>');
  const guest = renderToStaticMarkup(createElement(ChatMessage, { item: message('1'), side: 'black',
    playerNames: { white: null, black: 'cream_black' } }));
  expect(guest).toContain('Guest (White)');
  expect(guest).not.toContain('walnut_white');
  expect(guest).not.toContain('cream_black');
});
it('merges reconnect history and send receipts without duplicates, preserves bigint order, and caps the list', () => {
  expect(mergeChatMessages([message('9007199254740993')], [message('9007199254740992'), message('9007199254740993')])
    .map(item => item.id)).toEqual(['9007199254740992', '9007199254740993']);
  expect(mergeChatMessages([], Array.from({ length: 120 }, (_, i) => message(String(i + 1)))))
    .toHaveLength(100);
});
it('only follows new messages when the reader is near the bottom', () => {
  expect(nearChatBottom({ scrollHeight: 600, scrollTop: 100, clientHeight: 200 })).toBe(false);
  expect(nearChatBottom({ scrollHeight: 600, scrollTop: 370, clientHeight: 200 })).toBe(true);
});
it('escapes message markup, disambiguates guest senders, and includes a readable timestamp', () => {
  const html = renderToStaticMarkup(createElement(ChatMessage, { item: message('1'), side: 'black' }));
  expect(html).toContain('<p><strong aria-label="Guest (White), opponent">Guest (White)</strong>: <span>&lt;b&gt;Plain text&lt;/b&gt;</span></p>');
  expect(renderToStaticMarkup(createElement(ChatMessage, { item: message('1'), side: 'white' })))
    .toContain('<strong aria-label="Guest (White), you">Guest (White)</strong>');
  expect(html).toContain('&lt;b&gt;Plain text&lt;/b&gt;');
  expect(html).not.toContain('<b>Plain text</b>');
  expect(html).toContain('dateTime="2026-10-24T10:00:00Z"');
  expect(html).toMatch(/<time[^>]+>[^<]+<\/time>/);
});
it('keeps long message text together with its sender and the timestamp in a separate column', () => {
  const text = `A longer message\n${'UnbrokenText'.repeat(25)}`;
  const html = renderToStaticMarkup(createElement(ChatMessage, { item: { ...message('2'), text }, side: 'white' }));
  expect(html).toContain(`<p><strong aria-label="Guest (White), you">Guest (White)</strong>: <span>${text}</span></p><time`);
  expect(html).toContain('class="game-chat-message"');
});
it('waits for server permission without flashing a read-only notice, including finished games', () => {
  const props = { gameId: 'game', side: 'white' as const, gameStatus: 'active' as const, csrfToken: 'token', revision: 0 };
  const html = renderToStaticMarkup(createElement(GameChat, props));
  expect(html).toContain('Loading chat');
  expect(html).toContain('<h2 id="chat-heading-game">Game chat</h2>');
  expect(html).toContain('aria-expanded="true" aria-controls="chat-content-game">Hide</button>');
  expect(html).not.toMatch(/<details|<summary|Hide chat|Show chat/);
  expect(html).not.toContain('Chat is read-only');
  const finished = renderToStaticMarkup(createElement(GameChat, { ...props, gameStatus: 'finished' }));
  expect(finished).not.toContain('Chat is read-only');
  expect(finished).not.toContain('<form');
});
it('follows server permission across finalization and renders an enabled post-game composer', () => {
  const props = { gameId: 'game', text: 'Well played', sending: false, retrying: false,
    onSend: () => {}, onText: () => {} };
  const active = { status: 'active' as const, canSend: true };
  const refreshing = chatComposerState(active, 'finished');
  const pending = renderToStaticMarkup(createElement(ChatComposer, { ...props, state: refreshing }));
  expect(pending).toContain('<form aria-busy="true"');
  expect(pending).toContain('disabled=""');
  expect(pending).not.toContain('read-only');
  const state = chatComposerState({ status: 'finished', canSend: true }, 'finished');
  const finished = renderToStaticMarkup(createElement(ChatComposer, { ...props, state }));
  expect(finished).toContain('class="visually-hidden" for="chat-game">Chat message</label>');
  expect(finished).not.toContain('placeholder=');
  expect(finished).toContain('maxLength="500"');
  expect(finished).not.toContain('disabled=""');
  expect(finished).not.toContain('read-only');
  for (const status of ['waiting', 'pending_adjudication', 'aborted'] as const) {
    const state = chatComposerState({ status, canSend: false }, status);
    const html = renderToStaticMarkup(createElement(ChatComposer, { ...props, state }));
    expect(html).toContain('Chat is read-only');
    expect(html).not.toContain('<form');
    expect(chatComposerState({ status, canSend: false }, 'finished')).toBe('loading');
  }
  expect(chatComposerState(null, 'finished')).toBe('loading');
  expect(chatComposerState({ status: 'finished', canSend: false }, 'finished')).toBe('read_only');
});
it('uses the existing game-and-seat hidden preference and keeps Show available without chat content', () => {
  const getItem = vi.fn((key: string) => key === 'game-chat-hidden:game:white' ? 'true' : null);
  vi.stubGlobal('localStorage', { getItem });
  try {
    const props = { gameId: 'game', side: 'white' as const, gameStatus: 'active' as const, csrfToken: 'token', revision: 0 };
    const html = renderToStaticMarkup(createElement(GameChat, props));
    expect(getItem).toHaveBeenCalledWith('game-chat-hidden:game:white');
    expect(html).toContain('data-hidden="true"');
    expect(html).toMatch(/game-chat-header"><h2[^>]*>Game chat<\/h2><span>Players only<\/span>[\s\S]*?>Show<\/button>/);
    expect(html).toContain('aria-expanded="false" aria-controls="chat-content-game">Show</button>');
    expect(html).toContain('id="chat-content-game" hidden=""');
    expect(html).not.toContain('<form');
    expect(html).not.toContain('role="log"');
    const opponent = renderToStaticMarkup(createElement(GameChat, { ...props, side: 'black' }));
    expect(opponent).toContain('data-hidden="false"');
    expect(opponent).toContain('role="log"');
  } finally { vi.unstubAllGlobals(); }
});
it('distinguishes definite rejections from uncertain delivery so retries keep their identity', async () => {
  await expect(chatResponse(new Response(JSON.stringify({ error: 'chat_rate_limited' }), { status: 429 })))
    .rejects.toMatchObject({ definitive: true, message: 'Please wait 10 seconds before sending more messages.' });
  await expect(chatResponse(new Response('{}', { status: 503 }))).rejects.toMatchObject({ definitive: false });
  await expect(chatResponse(new Response('', { status: 502 }))).rejects.toMatchObject({
    definitive: false, message: 'Chat could not connect. Please retry.',
  });
});
