import { readFileSync } from 'node:fs';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { PlayerMaterialPanel } from '../src/CapturedMaterial';
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
    expect(css).toMatch(/\.player-material-row \{ position: absolute/);
    expect(css).toMatch(/\.player-material-top > \.player-material-row \{ bottom: 100%/);
    expect(css).toMatch(/\.player-material-bottom > \.player-material-row \{ top: 100%/);
    expect(css).toMatch(/\.game-sidebar \{[^}]*margin-top: var\(--board-top-offset\)/);
    expect(css).toMatch(/@media \(max-width: 900px\)[\s\S]*?\.game-sidebar \{[^}]*margin-top: 33px/);
    expect(css).toMatch(/\.clock-no-status \{[^}]*display: flex; align-items: center;[^}]*min-height: 72px/);
    expect(css).toMatch(/@media \(max-width: 540px\)[\s\S]*?\.clock-no-status \{ min-height: 62px; \}/);
    expect(css).toMatch(/\.player-rating \{[^}]*font-size: 14px; font-weight: 600/);
    expect(css).toMatch(/\.clock-no-status \.player-label \{ font-size: 16px/);
    expect(css).toMatch(/\.clock-no-status \.player-rating \{ font-size: 15px/);
  });

  it('attaches material to each player in orientation order without duplicating it below the board', () => {
    const imported = importPgn('[White "Ada"]\n[Black "Ben"]\n\n1. e4 e5 1-0', 'imported');
    for (const side of ['white', 'black'] as const) {
      for (const placement of ['top', 'bottom'] as const) {
        const html = renderToStaticMarkup(createElement(PlayerMaterialPanel, {
          side, placement, pieces: ['r'], advantage: { side: 'white', points: 2 },
          children: createElement(ImportedPlayerRow, { imported, side }),
        }));
        const material = html.indexOf('player-material-row');
        const player = html.indexOf('player-label');
        expect(placement === 'top' ? material < player : material > player).toBe(true);
        expect(html).toContain(side === 'white' ? 'Captured black rook' : 'Captured white rook');
        if (placement === 'bottom') {
          expect(html).toContain(side === 'white' ? 'White material balance +2' : 'Black material balance -2');
          expect(html.match(/material-total/g)).toHaveLength(1);
        } else {
          expect(html).not.toContain('material-total');
        }
      }
    }
    const app = readFileSync(new URL('../src/App.tsx', import.meta.url), 'utf8');
    expect(app.match(/<PlayerMaterialPanel/g)).toHaveLength(2);
    expect(app).not.toContain('material-below');
    expect(app).not.toContain('<MaterialTotal');
    expect(app.indexOf('className="analysis-footer-row"')).toBeGreaterThan(app.indexOf('className="board-stage"'));
  });

  it('renders below-board guidance and the clock notice only outside Analysis', () => {
    const app = readFileSync(new URL('../src/App.tsx', import.meta.url), 'utf8');
    expect(app).toContain("!analysisOpen && (canMove || liveBrowsingHistory || game.status === 'finished')");
    expect(app).toContain('!analysisOpen && imported === null && challenge !== null');
    expect(app).toContain("showStatus={!analysisOpen && game.status !== 'finished'}");
    expect(app).not.toContain('Analysis: ${');
  });

  it('keeps on-site clock content intact inside both material panels', () => {
    for (const placement of ['top', 'bottom'] as const) {
      const player = createElement(ClockPanel, { clock: null, side: 'black', isYou: true });
      const clockHtml = renderToStaticMarkup(player);
      const html = renderToStaticMarkup(createElement(PlayerMaterialPanel, {
        side: 'black', placement, pieces: ['n', 'n'], advantage: { side: 'black', points: 6 },
        children: player,
      }));
      expect(html).toContain(clockHtml);
      expect(html.match(/Captured white knight/g)).toHaveLength(2);
      if (placement === 'bottom') expect(html).toContain('Black material balance +6');
      else expect(html).not.toContain('material-total');
      const row = html.indexOf('player-material-row');
      const clock = html.indexOf(clockHtml);
      expect(placement === 'top' ? row < clock : row > clock).toBe(true);
    }
  });
});
