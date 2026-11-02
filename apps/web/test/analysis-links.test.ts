import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { afterEach, expect, it, vi } from 'vitest';
import { parsePgn, STANDARD_STARTING_FEN } from '@chess/domain';
import { analysisEntry, explorerAnalysisUrl, loadExplorerAnalysis, siteAnalysisUrl } from '../src/analysis-links';
import { importParsedPgn } from '../src/pgn-import';
import { createAnalysisTree, cursorFen, selectMain } from '../src/analysis-model';
import { FinishedResultArea } from '../src/FinishedResultArea';
import { EngineScoreBadge } from '../src/EnginePanel';
import { GameChat } from '../src/GameChat';

afterEach(() => vi.unstubAllGlobals());
it('opens site Analysis through one safe native link with a reloadable selected ply', () => {
  const id = '298953a3-d5e8-408d-a612-7a63af5f93d3';
  const href = siteAnalysisUrl(id, 2);
  expect(analysisEntry(new URL(href, 'http://localhost'))).toEqual({ kind: 'site', id, ply: 2 });
  const render = (analysisOpen: boolean) => renderToStaticMarkup(createElement(FinishedResultArea, {
    score: '1-0', explanation: 'White won.', analysisOpen, analysisHref: href, onToggleAnalysis: () => {},
  }));
  expect(render(false)).toContain('target="_blank" rel="noopener noreferrer"');
  expect(render(false)).toContain('new tab');
  expect(render(true)).toContain('Close analysis');
  expect(render(true)).not.toContain('target="_blank"');
  expect(analysisEntry(new URL('/challenge/' + id, 'http://localhost'))).toBeNull();
});

it('reconstructs explorer replay from URL and existing authorized API, including refresh and navigation', async () => {
  const parsed = parsePgn('[Result "1-0"]\n\n1.e4 e5 2.Nf3 Nc6 1-0');
  const fen = parsed.moves[1]!.afterFen;
  const entry = analysisEntry(new URL(explorerAnalysisUrl('12', fen, 2), 'http://localhost'))!;
  expect(entry).toMatchObject({ kind: 'explorer', id: '12', fen, ply: 2 });
  const fetch = vi.fn().mockResolvedValue(new Response(JSON.stringify({ game: parsed, ply: 2 })));
  vi.stubGlobal('fetch', fetch);
  const loaded = await loadExplorerAnalysis(entry.id, fen, new AbortController().signal);
  const game = importParsedPgn(loaded.game, 'explorer-12').game;
  const selected = selectMain(createAnalysisTree(game), game, entry.ply ?? loaded.ply);
  expect(cursorFen(selected, game)).toBe(fen);
  const url = new URL(fetch.mock.calls[0]![0], 'http://localhost');
  expect(url.pathname).toBe('/api/opening-explorer/games/12');
  expect(url.searchParams.get('fen')).toBe(fen);
  expect(fetch.mock.calls[0]![1]).toMatchObject({ credentials: 'same-origin', cache: 'no-store' });
  expect(analysisEntry(new URL(explorerAnalysisUrl('12', fen, 3), 'http://localhost'))?.ply).toBe(3);
  expect(cursorFen(selectMain(createAnalysisTree(game), game, 0), game)).toBe(STANDARD_STARTING_FEN);
});

it('reports explorer authorization or loading failures on the destination page', async () => {
  vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('', { status: 401 })));
  await expect(loadExplorerAnalysis('12', STANDARD_STARTING_FEN, new AbortController().signal)).rejects.toThrow('session expired');
});

it('puts conversation tabs and Hide in the analysis header without a duplicate heading', () => {
  const html = renderToStaticMarkup(createElement(GameChat, { gameId: 'demo', side: 'white',
    gameStatus: 'finished', csrfToken: 'token', revision: 0, analysisOpen: true }));
  expect(html).not.toContain('>Game chat</h2>');
  const header = html.slice(html.indexOf('class="game-chat-header"'), html.indexOf('class="game-chat-content"'));
  expect(header).toContain('>Chat</button>'); expect(header).toContain('>Notes</button>');
  expect(header).toContain('>Hide</button>');
});

it.each([['+0.20', 'white'], ['-0.03', 'black'], ['+0.00', 'white'], ['0.00', 'white'], ['Mate +3', 'white'], ['Mate -2', 'black'], ['Mate', 'white']])
  ('preserves the displayed score %s with the matching advantage fill', (score, side) => {
    const html = renderToStaticMarkup(createElement(EngineScoreBadge, { score }));
    expect(html).toContain(`data-side="${side}"`);
    expect(html).toContain(`>${score}</span>`);
  });
it('shows the opponent advantage for a checkmated side to move without changing the Mate label', () => {
  const html = renderToStaticMarkup(createElement(EngineScoreBadge, { score: 'Mate', whiteToMove: true }));
  expect(html).toContain('data-side="black">Mate</span>');
});
