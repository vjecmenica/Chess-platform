import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { expect, it } from 'vitest';
import { AnalysisNavigation } from '../src/AnalysisNavigation';

it('keeps real destinations and labels unavailable sections without a fake search', () => {
  const html = renderToStaticMarkup(createElement(AnalysisNavigation, { imported: true }));
  expect(html).toContain('aria-label="Analysis" aria-current="page"');
  expect(html).toContain('aria-disabled="true" aria-label="Puzzles (not available yet)"');
  expect(html).not.toContain('<input');
  expect(html).toContain('href="/" aria-label="Open another game"');
  expect(html).not.toContain('href="/puzzles');
  expect(html).toContain('aria-controls="site-navigation-items"');
});
it('marks Play or Analysis and preserves account and challenge destinations', () => {
  for (const section of ['play', 'analysis'] as const) {
    const html = renderToStaticMarkup(createElement(AnalysisNavigation, { imported: false, section,
      accountControl: createElement('a', { href: '/account' }, 'My account') }));
    expect(html).toContain(`aria-label="${section === 'play' ? 'Play' : 'Analysis'}" aria-current="page"`);
    expect(html).toContain('href="/account">My account</a>');
    expect(html).toContain('aria-label="Create another challenge"');
    expect(html.match(/aria-current="page"/g)).toHaveLength(1);
  }
});
