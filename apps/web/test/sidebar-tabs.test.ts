import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { expect, it } from 'vitest';
import { AnalysisSidebarTabs } from '../src/AnalysisSidebarTabs';

it('keeps both sections mounted and uses native buttons without reserving arrow keys', () => {
  const html = renderToStaticMarkup(createElement(AnalysisSidebarTabs, { enabled: true,
    book: createElement('p', null, 'Existing explorer and examples'),
    children: createElement('p', null, 'Existing move tree and actions') }));
  expect(html).toContain('role="group" aria-label="Analysis sidebar"');
  expect(html).toMatch(/<button[^>]*aria-pressed="true"[^>]*>Moves/);
  expect(html).toMatch(/<button[^>]*aria-pressed="false"[^>]*>Opening Book/);
  expect(html).not.toContain('role="tab');
  expect(html).not.toContain('tabindex="-1"');
  expect(html).toContain('Existing move tree and actions');
  expect(html).toMatch(/class="sidebar-tab-content sidebar-book"[^>]*hidden=""[^>]*><p>Existing explorer and examples/);
  const controls = [...html.matchAll(/aria-controls="([^"]+)"/g)].map(match => match[1]);
  expect(controls).toHaveLength(2);
  for (const id of controls) expect(html).toContain(`id="${id}" aria-labelledby=`);
});

it('leaves ordinary game controls available without mounting an explorer outside analysis', () => {
  const html = renderToStaticMarkup(createElement(AnalysisSidebarTabs, { enabled: false,
    book: createElement('p', null, 'Explorer'), children: createElement('button', null, 'Resign') }));
  expect(html).toBe('<button>Resign</button>');
});

