import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { expect, it } from 'vitest';
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
it('escapes message markup, identifies the actual side, and includes a readable timestamp', () => {
  const html = renderToStaticMarkup(createElement(ChatMessage, { item: message('1'), side: 'black' }));
  expect(html).toContain('Opponent');
  expect(html).toContain('White');
  expect(html).toContain('&lt;b&gt;Plain text&lt;/b&gt;');
  expect(html).not.toContain('<b>Plain text</b>');
  expect(html).toContain('dateTime="2026-10-24T10:00:00Z"');
  expect(html).toMatch(/<time[^>]+>[^<]+<\/time>/);
});
it('renders a labeled composer only while active, with a local hide control', () => {
  const props = { gameId: 'game', side: 'white' as const, active: true, csrfToken: 'token', revision: 0 };
  const html = renderToStaticMarkup(createElement(GameChat, props));
  expect(html).toContain('Message your opponent');
  expect(html).toContain('maxLength="500"');
  expect(html).toContain('Hide chat');
  const finished = renderToStaticMarkup(createElement(GameChat, { ...props, active: false }));
  expect(finished).toContain('Chat is read-only');
  expect(finished).not.toContain('<form');
});
it('distinguishes definite rejections from uncertain delivery so retries keep their identity', async () => {
  await expect(chatResponse(new Response(JSON.stringify({ error: 'chat_rate_limited' }), { status: 429 })))
    .rejects.toMatchObject({ definitive: true, message: 'Please wait 10 seconds before sending more messages.' });
  await expect(chatResponse(new Response('{}', { status: 503 }))).rejects.toMatchObject({ definitive: false });
  await expect(chatResponse(new Response('', { status: 502 }))).rejects.toMatchObject({
    definitive: false, message: 'Chat could not connect. Please retry.',
  });
});
