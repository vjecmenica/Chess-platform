import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { expect, it } from 'vitest';
import { AnalysisNavigation } from '../src/AnalysisNavigation';

it('keeps real home links and explicitly unavailable navigation/search placeholders', () => {
  const html = renderToStaticMarkup(createElement(AnalysisNavigation, { imported: true }));
  expect(html).toContain('aria-current="page">Analysis');
  expect(html).toContain('aria-disabled="true" title="Puzzles is not available yet"');
  expect(html).toContain('disabled="" aria-label="Search (not available yet)"');
  expect(html).toContain('href="/">Open another game');
  expect(html).not.toContain('href="/puzzles');
  expect(html).toContain('class="analysis-navigation-inner"');
});
it('marks Play in live games and Analysis in analysis, keeping one current section and working destinations', () => {
  const live = renderToStaticMarkup(createElement(AnalysisNavigation, { imported: false, section: 'play',
    accountControl: createElement('a', { href: '/account' }, 'My account') }));
  expect(live).toContain('href="/" aria-current="page">Play</a>');
  expect(live).toContain('href="/#pgn-import-title">Analysis</a>');
  expect(live).toContain('href="/account">My account</a>');
  expect(live.match(/aria-current="page"/g)).toHaveLength(1);
  const analysis = renderToStaticMarkup(createElement(AnalysisNavigation, { imported: false, section: 'analysis' }));
  expect(analysis).toContain('<span aria-current="page">Analysis</span>');
  expect(analysis).toContain('<a href="/">Play</a>');
  expect(analysis.match(/aria-current="page"/g)).toHaveLength(1);
});
