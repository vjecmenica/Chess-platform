import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { parsePgn, STANDARD_STARTING_FEN } from '@chess/domain';
import type { ExplorerListedGame } from '@chess/contracts';
import { ExplorerGameList } from '../src/ExplorerGames';
import { importParsedPgn } from '../src/pgn-import';
import { createAnalysisTree, cursorFen, selectMain } from '../src/analysis-model';

describe('Explorer game replay presentation', () => {
  it('renders two metadata lines with fallbacks, a quiet result, and no ratings or replay details', () => {
    const game: ExplorerListedGame = { id: '5', white_name: 'Alpha', black_name: null,
      white_rating: 2400, black_rating: null, white_fide_id: null, black_fide_id: null,
      result: '1-0', game_date: null, event: 'Synthetic event', site: null, round: '3',
      eco: 'A04', opening: 'Reti', time_control: null, ply: 0, uci: 'g1f3' };
    const html = renderToStaticMarkup(createElement(ExplorerGameList, { data: { games: [game], page: 0, hasMore: false, totalPages: 1 },
      page: 0, loadingId: null, onSelect: () => {}, onPage: () => {} }));
    expect(html).toContain('Alpha'); expect(html).not.toContain('2400'); expect(html).toContain('Unknown Black');
    expect(html).toContain('Date unavailable'); expect(html).toContain('Synthetic event');
    expect(html).toMatch(/Alpha.*Unknown Black.*explorer-game-result.*1-0.*Date unavailable<\/span>/);
    expect(html).toContain('<small>Synthetic event · Round 3 · A04</small>');
    expect(html).not.toMatch(/Played|Replay from ply|Reti/);
    expect(html).toMatch(/disabled=""[^>]*>›/);
    expect(html).toContain('aria-label="Previous games"');
    expect(html).toContain('aria-label="Next games"');
    expect(html).toContain('Page 1/1');
    expect(html).toContain('Up to 50 example games');
    expect(html).not.toMatch(/download|export|\.pgn/i);
    const selected: string[] = [];
    const list = ExplorerGameList({ data: { games: [game], page: 0, hasMore: false, totalPages: 1 },
      page: 0, loadingId: null, onSelect: id => selected.push(id), onPage: () => {} });
    const card = list.props.children[0].props.children[0];
    expect(card.type).toBe('button');
    card.props.onClick();
    expect(selected).toEqual(['5']);
    const loading = renderToStaticMarkup(createElement(ExplorerGameList, {
      data: { games: [game], page: 0, hasMore: false, totalPages: 1 }, page: 0,
      loadingId: '5', onSelect: () => {}, onPage: () => {} }));
    expect(loading).toContain('aria-busy="true"');
    expect(loading).toContain('role="status">Opening game…');
  });
  it('reuses the imported-game adapter for complete session-local replay and analysis navigation', () => {
    const parsed = parsePgn('[White "Alpha"]\n[WhiteElo "2410"]\n[TimeControl "40/7200:3600"]\n[Result "1-0"]\n\n1. e4 e5 2. Nf3 Nc6 1-0');
    const imported = importParsedPgn(parsed, 'explorer-5');
    expect(imported.headers.WhiteElo).toBe('2410');
    expect(imported.game.timeControl).toEqual({ source: 'pgn', raw: '40/7200:3600' });
    const tree = createAnalysisTree(imported.game);
    expect(cursorFen(selectMain(tree, imported.game, 0), imported.game)).toBe(STANDARD_STARTING_FEN);
    expect(cursorFen(selectMain(tree, imported.game, 2), imported.game)).toBe(parsed.moves[1]!.afterFen);
    expect(cursorFen(selectMain(tree, imported.game, 4), imported.game)).toBe(parsed.finalFen);
    expect(imported.game.history).toHaveLength(4);
    expect(imported.game.clocks).toBeNull();
  });
});
