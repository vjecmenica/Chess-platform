import { readFileSync } from 'node:fs';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { FinishedResultArea } from '../src/FinishedResultArea';
import { isCompactResultHeight, resizedResultHeight } from '../src/result-area';

describe('finished-game result area', () => {
  it('starts at its natural maximum, shrinks, and cannot grow beyond that maximum', () => {
    expect(isCompactResultHeight(null, null)).toBe(false);
    expect(resizedResultHeight(84, 84, -20)).toBe(64);
    expect(isCompactResultHeight(64, 84)).toBe(true);
    expect(resizedResultHeight(64, 84, 50)).toBe(84);
    expect(isCompactResultHeight(84, 84)).toBe(false);
    expect(resizedResultHeight(84, 84, -100)).toBe(52);
  });

  it('keeps the resize handle and Analysis button in the finished result area', () => {
    const app = readFileSync(new URL('../src/App.tsx', import.meta.url), 'utf8');
    const html = renderToStaticMarkup(createElement(FinishedResultArea, {
      score: '0-1', explanation: 'Black won by timeout.', analysisOpen: false,
      onToggleAnalysis: () => {},
    }));
    const gameView = app.slice(app.indexOf('<aside className="game-sidebar"'));
    expect(html).toContain('class="finished-result-area"');
    expect(html).toContain('0-1');
    expect(html).toContain('Black won by timeout.');
    expect(html).toContain('aria-pressed="false"');
    expect(html).toContain('aria-label="Resize result area"');
    expect(gameView).toContain('<FinishedResultArea');
    expect(gameView).not.toContain('Refresh position</button>');
    expect(gameView).not.toContain('<summary>Challenge link</summary>');
    expect(app).toContain('<label htmlFor="challenge-link">Shareable link</label>');
    expect(app).toContain('void refreshGame();');
  });
});
