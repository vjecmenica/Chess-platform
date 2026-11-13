import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { expect, it } from 'vitest';
import { AnalysisWorkspaceTabs } from '../src/AnalysisWorkspaceTabs';
import { GameChat } from '../src/GameChat';
import { initialWorkspaceView, workspaceView } from '../src/workspace-view';

it.each([false, true])('mounts one Game Room with the proper primary tabs (analysis=%s)', enabled => {
  const html = renderToStaticMarkup(createElement(AnalysisWorkspaceTabs, { enabled, reviewHost: () => {},
    children: createElement('div', null, 'Existing moves and engine'),
    gameInfo: createElement('p', null, 'Game facts'),
    gameRoom: presentation => createElement(GameChat, {
      ...presentation, gameId: 'test-game', side: 'white', gameStatus: 'active', csrfToken: 'test', revision: 0,
    }) }));
  expect(html).toContain(`aria-pressed="true">${enabled ? 'Analysis' : 'Moves'}`);
  expect(html).toContain('aria-pressed="false">Game Room');
  expect(html.includes('>Game Review</button>')).toBe(enabled);
  expect(html.includes('class="review-host"')).toBe(enabled);
  expect(html).toContain('Existing moves and engine');
  expect(html).toMatch(/class="workspace-room-pane"[^>]*hidden=""/);
  expect(html.match(/class="game-chat"/g)).toHaveLength(1);
  expect(html.match(/id="notes-test-game"/g)).toHaveLength(1);
  expect(html.match(/Game facts/g)).toHaveLength(1);
  if (enabled) {
    expect(html).toContain('</aside><div class="workspace-room-info"><p>Game facts</p></div>');
    expect(html).not.toContain('>Info</button>');
  } else {
    expect(html).toMatch(/>Info<\/button>[\s\S]*>Chat<\/button>[\s\S]*>Notes<\/button>/);
    expect(html).toMatch(/class="game-chat-info"[^>]*hidden=""><p>Game facts<\/p>/);
    expect(html).not.toContain('class="workspace-room-info"');
  }
  expect(html).toContain('Open floating chat');
  expect(html).not.toContain('role="tablist"'); // Left/Right remain board-navigation keys.
});
it('omits unsupported online room/launcher for imported and blank analysis', () => {
  const html = renderToStaticMarkup(createElement(AnalysisWorkspaceTabs, { enabled: true, reviewHost: () => {}, children: 'Engine' }));
  expect(html).not.toContain('Game Room');
  expect(html).not.toContain('Open floating chat');
  expect(html).toMatch(/class="workspace-review-pane"[^>]*hidden=""/);
});
it('keeps the primary view when floating chat opens and closes', () => {
  const review = workspaceView(initialWorkspaceView, { type: 'select', tab: 'review' });
  const floating = workspaceView(review, { type: 'float' });
  expect(floating).toEqual({ active: 'review', floating: true });
  expect(workspaceView(floating, { type: 'close-chat' })).toEqual(review);
  expect(workspaceView(floating, { type: 'select', tab: 'main' })).toEqual({ active: 'main', floating: true });
});
it('allows Game Room selection independently of the floating chat', () => {
  const floating = workspaceView(initialWorkspaceView, { type: 'float' });
  const room = workspaceView(floating, { type: 'select', tab: 'room' });
  expect(room).toEqual({ active: 'room', floating: true });
  expect(workspaceView(room, { type: 'close-chat' })).toEqual({ active: 'room', floating: false });
});
it.each([
  { enabled: false, tab: 'main', label: 'Moves' },
  { enabled: false, tab: 'room', label: 'Game Room' },
  { enabled: true, tab: 'main', label: 'Analysis' },
  { enabled: true, tab: 'review', label: 'Game Review' },
  { enabled: true, tab: 'room', label: 'Game Room' },
] as const)('keeps $label selected while chat floats (analysis=$enabled)', ({ enabled, tab, label }) => {
  const original = { ...initialWorkspaceView };
  const selected = workspaceView(original, { type: 'select', tab });
  const floating = workspaceView(selected, { type: 'float' });
  const render = (view: typeof original) => {
    // Seed the reducer to exercise the real pane and pressed-button rendering.
    Object.assign(initialWorkspaceView, view);
    try {
      return renderToStaticMarkup(createElement(AnalysisWorkspaceTabs, {
        enabled, children: 'Moves', reviewHost: () => {}, gameInfo: createElement('p', null, 'Game facts'),
        gameRoom: presentation => createElement(GameChat, {
          ...presentation, gameId: 'test-game', side: 'white', gameStatus: 'active', csrfToken: 'test', revision: 0,
        }),
      }));
    } finally {
      Object.assign(initialWorkspaceView, original);
    }
  };
  const overlay = render(floating);
  const closed = render(workspaceView(floating, { type: 'close-chat' }));
  expect(overlay).toContain(`aria-pressed="true">${label}`);
  expect(overlay.match(/id="chat-conversation-test-game"/g)).toHaveLength(1);
  expect(overlay.match(/id="chat-conversation-test-game-floating"/g)).toHaveLength(1);
  expect(overlay.match(/id="notes-test-game"/g)).toHaveLength(1);
  expect(overlay.match(/role="log"/g)).toHaveLength(1);
  expect(overlay).not.toContain('Return chat to Game Room');
  expect(overlay).toContain(`data-overlay-only="${tab !== 'room'}"`);
  if (tab === 'room') {
    expect(overlay).toMatch(/class="workspace-(analysis|play)-pane"[^>]*hidden=""/);
    const docked = (html: string) => html.match(/<aside[^>]*data-floating="false"[\s\S]*?<\/aside>/)?.[0]
      ?.replace(' role="log" aria-live="polite" aria-relevant="additions"', '');
    expect(docked(overlay)).toBe(docked(closed));
    if (enabled) expect(overlay).toContain('<div class="workspace-room-info"><p>Game facts</p></div>');
  }
  expect(closed).toContain(`aria-pressed="true">${label}`);
  expect(closed).not.toContain('Close floating chat');
});
it.each([false, true])('renders game actions once in a footer outside the switchable panes (analysis=%s)', enabled => {
  const html = renderToStaticMarkup(createElement(AnalysisWorkspaceTabs, { enabled, reviewHost: () => {},
    children: 'Game moves', gameRoom: () => 'Game chat',
    footer: createElement('button', null, 'Accept draw') }));
  expect(html).toContain('</button><footer class="workspace-footer" aria-label="Game status and actions"><button>Accept draw</button></footer>');
  expect(html.match(/Accept draw/g)).toHaveLength(1);
  expect(html).not.toContain('View game actions');
});
it('gives each chat presentation a separate accessible mute target and renders one Notes editor', () => {
  const html = renderToStaticMarkup(createElement(GameChat, { gameId: 'game', side: 'black', gameStatus: 'finished',
    csrfToken: 'test', revision: 0, floating: true }));
  expect(html).toContain('data-floating="true"');
  expect(html.match(/id="chat-conversation-game"/g)).toHaveLength(1);
  expect(html).toContain('aria-label="Close floating chat"');
  expect(html).toContain('aria-label="Mute chat"');
  expect(html).toContain('aria-controls="chat-conversation-game-floating"');
  expect(html.match(/id="notes-game"/g)).toHaveLength(1);
  expect(html).toContain('aria-pressed="true" aria-label="Chat">Chat');
});
