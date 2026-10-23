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
});
