import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { expect, it, vi } from 'vitest';
import type { GameChatMessage } from '@chess/contracts';
import { chatComposerState, chatEnterSubmits, chatResponse, mergeChatMessages, nearChatBottom } from '../src/game-chat';
import { ChatComposer, ChatMessage, GameChat, QuickChatPresets } from '../src/GameChat';
import { GameRematch } from '../src/GameRematch';
import { FinishedResultArea } from '../src/FinishedResultArea';
import type { GameReadResponse } from '@chess/contracts';

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
  expect(html).toContain('aria-label="Game chat and private notes"');
  expect(html).toMatch(/aria-pressed="true"[^>]*>Chat/);
  expect(html).toMatch(/aria-pressed="false"[^>]*>Notes/);
  expect(html).toContain('Private notes');
  expect(html).not.toContain('>Game chat</h2>');
  expect(html).toContain('aria-label="Mute chat"');
  expect(html).toContain('aria-controls="chat-conversation-game"');
  expect(html).not.toMatch(/<details|<summary|Hide chat|Show chat/);
  expect(html).not.toContain('Chat is read-only');
  expect(html).not.toContain('Players only');
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
it('scopes muting to this game and player while keeping Notes available', () => {
  const getItem = vi.fn((key: string) => key === 'game-chat-muted:game:white' ? 'true' : null);
  vi.stubGlobal('localStorage', { getItem });
  try {
    const props = { gameId: 'game', side: 'white' as const, gameStatus: 'active' as const, csrfToken: 'token', revision: 0 };
    const html = renderToStaticMarkup(createElement(GameChat, props));
    expect(getItem).toHaveBeenCalledWith('game-chat-muted:game:white');
    expect(html).toContain('data-muted="true"');
    expect(html).toContain('aria-label="Unmute chat"');
    expect(html).toContain('<em>You muted the chat</em>');
    expect(html).toContain('data-muted="true" inert="" aria-hidden="true"');
    expect(html).not.toContain('data-hidden=');
    expect(html).not.toContain('chat-unread');
    expect(html).not.toContain('<form');
    // Only the conversation is inert.
    expect(html).toContain('role="log"');
    const conversation = html.indexOf('class="game-chat-conversation"');
    expect(html.indexOf('class="game-notes-tab"')).toBeLessThan(conversation);
    expect(html.slice(0, conversation)).not.toContain('inert=');
    const opponent = renderToStaticMarkup(createElement(GameChat, { ...props, side: 'black' }));
    expect(opponent).toContain('data-muted="false"');
    expect(opponent).not.toContain('You muted the chat');
    expect(opponent).toContain('role="log"');
    const otherGame = renderToStaticMarkup(createElement(GameChat, { ...props, gameId: 'other' }));
    expect(otherGame).toContain('data-muted="false"');
  } finally { vi.unstubAllGlobals(); }
});
it('submits Enter only outside IME composition, repeated keydown and pending/permission states', () => {
  const event = { key: 'Enter', isComposing: false, keyCode: 13, repeat: false };
  expect(chatEnterSubmits(event, false, true)).toBe(true);
  for (const change of [{ isComposing: true }, { keyCode: 229 }, { repeat: true }, { key: 'a' }])
    expect(chatEnterSubmits({ ...event, ...change }, false, true)).toBe(false);
  expect(chatEnterSubmits(event, true, true)).toBe(false);
  expect(chatEnterSubmits(event, false, false)).toBe(false);
});
it('does not inherit the removed collapse preference and keeps game actions outside muted content', () => {
  vi.stubGlobal('localStorage', { getItem: (key: string) => key.startsWith('game-chat-hidden:') ? 'true' : null });
  const props = { gameId: 'game', side: 'white' as const, gameStatus: 'finished' as const, csrfToken: 'token', revision: 0 };
  try {
    expect(renderToStaticMarkup(createElement(GameChat, props))).toContain('data-muted="false"');
    vi.stubGlobal('localStorage', { getItem: (key: string) => key === 'game-chat-muted:game:white' ? 'true' : null });
    const game = { id: 'game', status: 'finished', yourSeat: 'white', timeControl: { initialMs: 300000, incrementMs: 3000 } } as GameReadResponse;
    const html = renderToStaticMarkup(createElement('section', null,
      createElement(GameChat, props),
      createElement(FinishedResultArea, { score: '1-0', explanation: 'White won.', analysisOpen: false,
        analysisHref: '/challenge/game?analysis=1', onToggleAnalysis: () => {},
        beforeAnalysis: createElement(GameRematch, { game, csrfToken: 'token', revision: 0 }) })));
    const actions = html.slice(html.indexOf('</aside>'));
    expect(html).toContain('Private notes');
    expect(actions).toContain('>Rematch</button>');
    expect(actions).toContain('Open game Analysis in a new tab');
    expect(actions).not.toContain('inert=');
  } finally { vi.unstubAllGlobals(); }
});
it('offers explicit preset buttons but no Send button, and makes uncertain delivery retryable from the input', () => {
  const props = { gameId: 'game', state: 'allowed' as const, text: 'GG', sending: false,
    retrying: false, onSend: () => {}, onText: () => {} };
  const render = (changes = {}) => renderToStaticMarkup(createElement(ChatComposer, { ...props, ...changes }));
  const ready = render();
  expect(ready).not.toMatch(/type="submit"|>Send<\/button>|placeholder=/);
  for (const [label, text] of [['GG', 'good game'], ['WP', 'well played'], ['TY', 'thank you'], ['GTG', 'got to go'], ['BYE', 'goodbye']]) {
    expect(ready).toContain(`aria-label="${label}: send ${text}"`);
    expect(ready).toContain(`>${label}</button>`);
  }
  const retry = render({ retrying: true });
  expect(retry).toContain('readOnly=""');
  expect(retry).toContain('Press Enter in the input to retry the same message.');
  expect(retry).toMatch(/<input[^>]*value="GG"/);
  expect(retry.match(/disabled=""/g)).toHaveLength(5);
  const pending = render({ sending: true });
  expect(pending).toContain('Sending…');
  expect(pending).toContain('readOnly=""');
  expect(pending.match(/disabled=""/g)).toHaveLength(5);
});
it('sends each full phrase from its abbreviated button, without sending on focus', () => {
  const send = vi.fn();
  const buttons = QuickChatPresets({ disabled: false, onSend: send }).props.children;
  expect(send).not.toHaveBeenCalled();
  const expected = [['GG', 'good game'], ['WP', 'well played'], ['TY', 'thank you'], ['GTG', 'got to go'], ['BYE', 'goodbye']];
  for (const [i, button] of buttons.entries()) {
    expect(button.props.children).toBe(expected[i]![0]);
    button.props.onClick();
    expect(send).toHaveBeenLastCalledWith(expected[i]![1]);
    expect(button.props.onFocus).toBeUndefined();
  }
});
it('distinguishes definite rejections from uncertain delivery so retries keep their identity', async () => {
  await expect(chatResponse(new Response(JSON.stringify({ error: 'chat_rate_limited' }), { status: 429 })))
    .rejects.toMatchObject({ definitive: true, message: 'Please wait 10 seconds before sending more messages.' });
  await expect(chatResponse(new Response('{}', { status: 503 }))).rejects.toMatchObject({ definitive: false });
  await expect(chatResponse(new Response('', { status: 502 }))).rejects.toMatchObject({
    definitive: false, message: 'Chat could not connect. Please retry.',
  });
});

it('disables only confirmed used phrases for this player, preserving other quick replies', () => {
  const send = vi.fn();
  const buttons = QuickChatPresets({ disabled:false,used:['good game','thank you'],onSend:send }).props.children;
  expect(buttons.map(button=>[button.props.children,button.props.disabled])).toEqual([
    ['GG',true],['WP',false],['TY',true],['GTG',false],['BYE',false]
  ]);
  const fresh=QuickChatPresets({disabled:false,onSend:send}).props.children;
  expect(fresh.every(button=>!button.props.disabled)).toBe(true);
});
it('renders mute and unmute system events as plain italic chronological entries without periods', () => {
  for(const text of ['has muted the chat','has unmuted the chat']) {
    const html=renderToStaticMarkup(createElement(ChatMessage,{item:{...message('10'),kind:'system',text},side:'black',playerNames:{white:'Alice',black:'Bob'}}));
    expect(html).toContain(`<em>Alice ${text}</em>`);
  }
});
