import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { expect, it } from 'vitest';
import { AnalysisNavigation } from '../src/AnalysisNavigation';
import { FutureChat } from '../src/FutureChat';

it('keeps real home links and explicitly unavailable navigation/search placeholders', () => {
  const html = renderToStaticMarkup(createElement(AnalysisNavigation, { imported: true }));
  expect(html).toContain('aria-current="page">Analysis');
  expect(html).toContain('aria-disabled="true" title="Puzzles is not available yet"');
  expect(html).toContain('disabled="" aria-label="Search (not available yet)"');
  expect(html).toContain('href="/">Open another game');
  expect(html).not.toContain('href="/puzzles');
  expect(html).toContain('class="analysis-navigation-inner"');
});

it('reserves a non-interactive chat rail only for a platform game', () => {
  expect(renderToStaticMarkup(createElement(FutureChat, { siteGame: false }))).toBe('');
  const siteGame = renderToStaticMarkup(createElement(FutureChat, { siteGame: true }));
  expect(siteGame).toContain('aria-label="Chat — coming later"');
  expect(siteGame).toContain('<h2>Chat — coming later</h2>');
  expect(siteGame).not.toMatch(/<(input|textarea|button|a)\b/);
});
