import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { expect, it } from 'vitest';
import { AnalysisSidebarTabs, nextSidebarTab } from '../src/AnalysisSidebarTabs';

it('defaults to Moves, keeps both panes mounted, and connects tabs to labelled panels', () => {
  const html = renderToStaticMarkup(createElement(AnalysisSidebarTabs, { enabled: true,
    book: createElement('p', null, 'Existing explorer and examples'),
    children: createElement('p', null, 'Existing move tree and actions') }));
  expect(html).toContain('role="tablist" aria-label="Analysis sidebar"');
  expect(html).toMatch(/role="tab"[^>]*aria-selected="true" tabindex="0"[^>]*>Moves/);
  expect(html).toMatch(/role="tab"[^>]*aria-selected="false" tabindex="-1"[^>]*>Opening Book/);
  expect(html).toContain('Existing move tree and actions');
  expect(html).toMatch(/class="sidebar-tab-content sidebar-book"[^>]*hidden=""[^>]*><p>Existing explorer and examples/);
  const controls = [...html.matchAll(/aria-controls="([^"]+)"/g)].map(match => match[1]);
  expect(controls).toHaveLength(2);
  for (const id of controls) expect(html).toContain(`id="${id}" aria-labelledby=`);
});

it('uses roving keyboard navigation with wrapping and Home/End', () => {
  expect(nextSidebarTab('moves', 'ArrowRight')).toBe('book');
  expect(nextSidebarTab('book', 'ArrowRight')).toBe('moves');
  expect(nextSidebarTab('moves', 'ArrowLeft')).toBe('book');
  expect(nextSidebarTab('book', 'Home')).toBe('moves');
  expect(nextSidebarTab('moves', 'End')).toBe('book');
  expect(nextSidebarTab('book', 'ArrowDown')).toBeNull();
});

it('leaves ordinary game controls available without mounting an explorer outside analysis', () => {
  const html = renderToStaticMarkup(createElement(AnalysisSidebarTabs, { enabled: false,
    book: createElement('p', null, 'Explorer'), children: createElement('button', null, 'Resign') }));
  expect(html).toBe('<button>Resign</button>');
});

