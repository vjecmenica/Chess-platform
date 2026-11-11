import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { expect, it } from 'vitest';
import { AnalysisWorkspaceTabs } from '../src/AnalysisWorkspaceTabs';
import { CompanionPanel } from '../src/CompanionPanel';

it('starts in Analysis and mounts the hidden review host alongside the engine', () => {
  const html = renderToStaticMarkup(createElement(AnalysisWorkspaceTabs, { enabled: true, reviewHost: () => {},
    children: createElement('div', null, 'Engine and moves') }));
  expect(html).toContain('aria-pressed="true">Analysis');
  expect(html).toContain('aria-pressed="false">Game Review');
  expect(html).toContain('Engine and moves');
  expect(html).toMatch(/class="workspace-review-pane"[^>]*hidden=""/);
  expect(html).toContain('class="review-host"');
  expect(html).not.toContain('role="tablist"'); // Left/Right remain board-navigation keys.
});
it('does not add analysis panes to live play', () => {
  const html = renderToStaticMarkup(createElement(AnalysisWorkspaceTabs, { enabled: false, reviewHost: () => {}, children: 'Moves' }));
  expect(html).toBe('Moves');
});
it.each([false, true])('keeps companion content mounted and utilities accessible (analysis=%s)', analysis => {
  const html = renderToStaticMarkup(createElement(CompanionPanel, { analysis,
    utilities: createElement('button', null, 'Flip board'), children: visible => createElement('textarea', {
      'aria-label': 'Private notes', 'data-viewed': visible, defaultValue: 'Unsaved draft',
    }) }));
  expect(html).toContain(`data-collapsed="${analysis}"`);
  expect(html).toContain(`aria-expanded="${!analysis}"`);
  expect(html).toContain(`data-viewed="${!analysis}"`);
  expect(html).toContain('Unsaved draft');
  expect(html).toMatch(/<\/div><button>Flip board<\/button><\/div>$/);
});
