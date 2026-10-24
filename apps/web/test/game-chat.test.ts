import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { expect, it, vi } from 'vitest';
import type { GameChatMessage } from '@chess/contracts';
import { chatResponse, mergeChatMessages, nearChatBottom } from '../src/game-chat';
import { ChatMessage, GameChat } from '../src/GameChat';

function message(id: string): GameChatMessage {
  return { id, side: 'white', text: '<b>Plain text</b>', sentAt: '2026-10-24T10:00:00Z' };
}
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
it('escapes message markup, labels ownership without a side suffix, and includes a readable timestamp', () => {
  const html = renderToStaticMarkup(createElement(ChatMessage, { item: message('1'), side: 'black' }));
  expect(html).toContain('Opponent');
  expect(html).toContain('<p><strong>Opponent</strong>: <span>&lt;b&gt;Plain text&lt;/b&gt;</span></p>');
  expect(html).not.toMatch(/White|Black/);
  expect(renderToStaticMarkup(createElement(ChatMessage, { item: message('1'), side: 'white' })))
    .toContain('<strong>You</strong>');
  expect(html).toContain('&lt;b&gt;Plain text&lt;/b&gt;');
  expect(html).not.toContain('<b>Plain text</b>');
  expect(html).toContain('dateTime="2026-10-24T10:00:00Z"');
  expect(html).toMatch(/<time[^>]+>[^<]+<\/time>/);
});
it('keeps long message text together with its sender and the timestamp in a separate column', () => {
  const text = `A longer message\n${'UnbrokenText'.repeat(25)}`;
  const html = renderToStaticMarkup(createElement(ChatMessage, { item: { ...message('2'), text }, side: 'white' }));
  expect(html).toContain(`<p><strong>You</strong>: <span>${text}</span></p><time`);
  expect(html).toContain('class="game-chat-message"');
});
it('renders a labeled composer only while active, with a local hide control', () => {
  const props = { gameId: 'game', side: 'white' as const, active: true, csrfToken: 'token', revision: 0 };
  const html = renderToStaticMarkup(createElement(GameChat, props));
  expect(html).toContain('Message your opponent');
  expect(html).toContain('maxLength="500"');
  expect(html).toContain('<h2 id="chat-heading-game">Game chat</h2>');
  expect(html).toContain('aria-expanded="true" aria-controls="chat-content-game">Hide</button>');
  expect(html).not.toMatch(/<details|<summary|Hide chat|Show chat/);
  const finished = renderToStaticMarkup(createElement(GameChat, { ...props, active: false }));
  expect(finished).toContain('Chat is read-only');
  expect(finished).not.toContain('<form');
});
it('uses the existing game-and-seat hidden preference and keeps Show available without chat content', () => {
  const getItem = vi.fn((key: string) => key === 'game-chat-hidden:game:white' ? 'true' : null);
  vi.stubGlobal('localStorage', { getItem });
  try {
    const props = { gameId: 'game', side: 'white' as const, active: true, csrfToken: 'token', revision: 0 };
    const html = renderToStaticMarkup(createElement(GameChat, props));
    expect(getItem).toHaveBeenCalledWith('game-chat-hidden:game:white');
    expect(html).toContain('data-hidden="true"');
    expect(html).toContain('aria-expanded="false" aria-controls="chat-content-game">Show</button>');
    expect(html).toContain('id="chat-content-game" hidden=""');
    expect(html).not.toContain('<form');
    expect(html).not.toContain('role="log"');
    const opponent = renderToStaticMarkup(createElement(GameChat, { ...props, side: 'black' }));
    expect(opponent).toContain('data-hidden="false"');
    expect(opponent).toContain('<form');
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
