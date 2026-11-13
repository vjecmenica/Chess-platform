import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { expect, it } from 'vitest';
import { AnalysisNavigation } from '../src/AnalysisNavigation';
import { AccountPage } from '../src/MyGames';

it('keeps real destinations and labels unavailable sections without a fake search', () => {
  const html = renderToStaticMarkup(createElement(AnalysisNavigation));
  expect(html).toContain('aria-label="Analysis" aria-current="page"');
  expect(html).toContain('aria-disabled="true" aria-label="Puzzles (not available yet)"');
  expect(html).not.toContain('<input');
  expect(html).not.toContain('Open another game');
  expect(html).not.toContain('Create another challenge');
  expect(html).not.toContain('href="/puzzles');
  expect(html).toContain('aria-controls="site-navigation-items"');
});

it('renders the shared rail on Account and marks only the account control as current', () => {
  const html = renderToStaticMarkup(createElement(AccountPage));
  expect(html).toContain('aria-controls="site-navigation-items"');
  expect(html).toContain('class="account-trigger secondary" aria-current="page"');
  expect(html.match(/aria-current="page"/g)).toHaveLength(1);
});
it('marks Play or Analysis and preserves the account destination', () => {
  for (const section of ['play', 'analysis'] as const) {
    const html = renderToStaticMarkup(createElement(AnalysisNavigation, { section,
      accountControl: createElement('a', { href: '/account' }, 'My account') }));
    expect(html).toContain(`aria-label="${section === 'play' ? 'Play' : 'Analysis'}" aria-current="page"`);
    expect(html).toContain('href="/account">My account</a>');
    expect(html.match(/aria-current="page"/g)).toHaveLength(1);
  }
});
