import { readFileSync } from 'node:fs';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { ClockPanel } from '../src/ClockPanel';
import { FinishedResultArea } from '../src/FinishedResultArea';
import { ImportedPlayerRow, importedPlayer } from '../src/PlayerIdentity';
import { importPgn, importedResultDisplay } from '../src/pgn-import';

describe('shared game presentation', () => {
  it('puts imported names and available numeric ratings at the left of player rows', () => {
    const imported = importPgn('[White "Ada"]\n[Black "Ben"]\n[WhiteElo "1820"]\n[BlackElo "?"]\n\n1. e4 e5 1-0', 'imported');
    expect(importedPlayer(imported, 'white')).toEqual({ name: 'Ada', rating: '1820' });
    expect(importedPlayer(imported, 'black')).toEqual({ name: 'Ben', rating: null });
    const white = renderToStaticMarkup(createElement(ImportedPlayerRow, { imported, side: 'white' }));
    const black = renderToStaticMarkup(createElement(ImportedPlayerRow, { imported, side: 'black' }));
    expect(white).toContain('class="clock clock-no-status imported-player"');
    expect(white).toMatch(/player-name">Ada<\/span>.*player-rating.*1820.*<b>White<\/b>/);
    expect(white).not.toContain('(1820)');
    expect(white).not.toContain('At selected move');
    expect(white).not.toContain('Stopped');
    expect(black).toContain('Ben');
    expect(black).not.toContain('player-rating');
    const guest = renderToStaticMarkup(createElement(ClockPanel, {
      clock: null, side: 'white', isYou: true,
    }));
    expect(guest).toMatch(/player-name">You<\/span>.*<b>White<\/b>/);
    expect(guest).not.toContain('player-rating');
  });

  it('uses the same finished-result component for imported and on-site scores', () => {
    const imported = importPgn('1. e4 1-0', 'imported');
    const result = importedResultDisplay(imported);
    const html = renderToStaticMarkup(createElement(FinishedResultArea, {
      ...result, analysisOpen: true, sessionOnly: true, onToggleAnalysis: () => {},
    }));
    expect(html).toContain('class="finished-result-area"');
    expect(html).toContain('class="final-result"');
    expect(html).toContain('1-0');
    expect(html).toContain('White won.');
    expect(html).toContain('Close analysis');
    const app = readFileSync(new URL('../src/App.tsx', import.meta.url), 'utf8');
    expect(app).toContain('imported !== null ? importedResultDisplay(imported)');
    expect(app).toContain('<FinishedResultArea key={game.id} score={result.score}');
    expect(app).not.toContain('className="imported-result"');
  });

  it('aligns the board and sidebar on desktop and removes the offset when stacked', () => {
    const css = readFileSync(new URL('../src/style.css', import.meta.url), 'utf8');
    expect(css).toMatch(/--board-top-offset: 36px/);
    expect(css).toMatch(/\.captured-row \{[^}]*height: 33px/);
    expect(css).toMatch(/\.captured-top \{ margin-bottom: 3px/);
    expect(css).toMatch(/\.game-sidebar \{[^}]*margin-top: var\(--board-top-offset\)/);
    expect(css).toMatch(/@media \(max-width: 900px\)[\s\S]*?\.game-sidebar \{[^}]*margin-top: 0/);
    expect(css).toMatch(/\.clock-no-status \{[^}]*display: flex; align-items: center;[^}]*min-height: 72px/);
    expect(css).toMatch(/@media \(max-width: 540px\)[\s\S]*?\.clock-no-status \{ min-height: 62px; \}/);
    expect(css).toMatch(/\.player-rating \{[^}]*font-size: 14px; font-weight: 600/);
    expect(css).toMatch(/\.clock-no-status \.player-label \{ font-size: 16px/);
    expect(css).toMatch(/\.clock-no-status \.player-rating \{ font-size: 15px/);
  });

  it('keeps material and analysis controls below the board without shifting desktop alignment', () => {
    const app = readFileSync(new URL('../src/App.tsx', import.meta.url), 'utf8');
    const board = app.indexOf('className="board-stage"');
    const material = app.indexOf('analysis-material-below');
    const footer = app.indexOf('className="analysis-footer-row"');
    const toolbar = app.indexOf('className="analysis-board-controls"');
    const count = app.indexOf('<MaterialTotal advantage={material}', toolbar);
    expect(board).toBeGreaterThan(0);
    expect(material).toBeGreaterThan(board);
    expect(footer).toBeGreaterThan(material);
    expect(toolbar).toBeGreaterThan(footer);
    expect(count).toBeGreaterThan(toolbar);
    expect(app).not.toContain('board-topline-analysis');
    const css = readFileSync(new URL('../src/style.css', import.meta.url), 'utf8');
    expect(css).toMatch(/\.material-below \{[^}]*height: 34px; margin-top: 1px/);
    expect(css).toMatch(/\.analysis-material-below \{ margin-top: -8px/);
    expect(css).toMatch(/\.analysis-footer-row \{ display: flex; align-items: center/);
    expect(css).toMatch(/\.analysis-footer-row \.analysis-board-controls \{[^}]*margin-top: 0/);
    expect(css).toMatch(/\.analysis-board-controls \{[^}]*flex-wrap: wrap/);
  });

  it('renders below-board guidance and the clock notice only outside Analysis', () => {
    const app = readFileSync(new URL('../src/App.tsx', import.meta.url), 'utf8');
    expect(app).toContain("!analysisOpen && (canMove || liveBrowsingHistory || game.status === 'finished')");
    expect(app).toContain('!analysisOpen && imported === null && challenge !== null');
    expect(app).toContain("showStatus={!analysisOpen && game.status !== 'finished'}");
    expect(app).not.toContain('Analysis: ${');
  });
});
