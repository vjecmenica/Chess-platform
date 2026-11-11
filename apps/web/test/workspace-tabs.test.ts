import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { expect, it } from 'vitest';
import { AnalysisWorkspaceTabs } from '../src/AnalysisWorkspaceTabs';
import { GameChat } from '../src/GameChat';
import { initialWorkspaceView, workspaceView } from '../src/workspace-view';

it.each([false, true])('mounts one Game Room with the proper primary tabs (analysis=%s)', enabled => {
  const html = renderToStaticMarkup(createElement(AnalysisWorkspaceTabs, { enabled, reviewHost: () => {},
    children: createElement('div', null, 'Existing moves and engine'), gameRoom: presentation => createElement(GameChat, {
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
it('docks the same chat on selecting Game Room and reveals actions without an obstructing overlay', () => {
  const floating = workspaceView(initialWorkspaceView, { type: 'float' });
  const room = workspaceView(floating, { type: 'select', tab: 'room' });
  expect(room).toEqual({ active: 'room', floating: false });
  expect(workspaceView(room, { type: 'float' })).toEqual({ active: 'main', floating: true });
  expect(workspaceView(room, { type: 'actions' })).toEqual(initialWorkspaceView);
  expect(workspaceView(floating, { type: 'actions' })).toEqual(initialWorkspaceView);
});
it('keeps actionable notices outside the hidden panes', () => {
  const html = renderToStaticMarkup(createElement(AnalysisWorkspaceTabs, { enabled: false, reviewHost: () => {},
    children: 'Existing game actions', notice: 'Draw offer awaiting a response.' }));
  expect(html).toContain('class="workspace-action-notice" role="status"');
  expect(html).toContain('Draw offer awaiting a response.');
  expect(html).toContain('>View game actions</button>');
});
it('floating presentation retains one conversation and Notes, with accessible close and mute controls', () => {
  const html = renderToStaticMarkup(createElement(GameChat, { gameId: 'game', side: 'black', gameStatus: 'finished',
    csrfToken: 'test', revision: 0, floating: true }));
  expect(html).toContain('data-floating="true"');
  expect(html.match(/id="chat-conversation-game"/g)).toHaveLength(1);
  expect(html).toContain('aria-label="Close floating chat"');
  expect(html).toContain('aria-label="Mute chat"');
  expect(html).toContain('id="notes-game"');
  expect(html).toMatch(/hidden="" class="analysis-view-tabs"/);
});
