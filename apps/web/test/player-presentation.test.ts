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
    expect(white).toContain('class="clock imported-player"');
    expect(white).toMatch(/player-name">Ada<\/span>.*player-rating.*1820.*<b>White<\/b>/);
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
  });
});
