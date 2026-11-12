import { readFileSync } from 'node:fs';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { FinishedResultArea } from '../src/FinishedResultArea';
import { isCompactResultHeight, resizedResultHeight } from '../src/result-area';

describe('finished-game result area', () => {
  it('keeps Analysis expanded without a resize control and retains its actions', () => {
    const html = renderToStaticMarkup(createElement(FinishedResultArea, {
      score: '1-0', explanation: 'White won by resignation.', analysisOpen: true,
      beforeAnalysis: createElement('a', { href: '/challenge/rematch' }, 'Open game'),
      onToggleAnalysis: () => {},
    }));
    expect(html).toContain('finished-result-area analysis-result-area');
    expect(html).not.toContain('Resize result area');
    expect(html).not.toContain('style="height:');
    expect(html).not.toContain(' compact');
    expect(html).toContain('Close analysis');
    expect(html).toContain('href="/challenge/rematch"');
    expect(html).toContain('White won by resignation.');
  });
  it('starts at its natural maximum, shrinks, and cannot grow beyond that maximum', () => {
    expect(isCompactResultHeight(null, null)).toBe(false);
    expect(resizedResultHeight(84, 84, -20)).toBe(64);
    expect(isCompactResultHeight(64, 84)).toBe(true);
    expect(resizedResultHeight(64, 84, 50)).toBe(84);
    expect(isCompactResultHeight(84, 84)).toBe(false);
    expect(resizedResultHeight(84, 84, -100)).toBe(52);
  });

  it('keeps play results expanded without a handle and retains Analysis', () => {
    const app = readFileSync(new URL('../src/App.tsx', import.meta.url), 'utf8');
    const html = renderToStaticMarkup(createElement(FinishedResultArea, {
      score: '0-1', explanation: 'Black won by timeout.', analysisOpen: false,
      onToggleAnalysis: () => {},
    }));
    const gameView = app.slice(app.indexOf('<AnalysisWorkspaceTabs key='));
    expect(html).toContain('class="finished-result-area"');
    expect(html).toContain('0-1');
    expect(html).toContain('Black won by timeout.');
    expect(html).toContain('aria-pressed="false"');
    expect(html).not.toContain('Resize result area');
    expect(html).not.toContain('style="height:');
    expect(gameView).toContain('<FinishedResultArea');
    expect(gameView).not.toContain('Refresh position</button>');
    expect(gameView).not.toContain('<summary>Challenge link</summary>');
    expect(app).toContain('<label htmlFor="challenge-link">Shareable link</label>');
    expect(app).toContain('void refreshGame();');
  });
});
