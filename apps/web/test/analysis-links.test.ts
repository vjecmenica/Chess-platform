import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { afterEach, expect, it, vi } from 'vitest';
import { parsePgn, STANDARD_STARTING_FEN } from '@chess/domain';
import { analysisEntry, explorerAnalysisUrl, loadExplorerAnalysis, positionAnalysisUrl, shareableGameUrl,
  siteAnalysisUrl } from '../src/analysis-links';
import { importParsedPgn } from '../src/pgn-import';
import { createAnalysisTree, cursorFen, playAnalysisMove, selectMain } from '../src/analysis-model';
import { buildMoveTree } from '../src/move-tree-model';
import { FinishedResultArea } from '../src/FinishedResultArea';
import { EngineScoreBadge } from '../src/EnginePanel';
import { GameChat } from '../src/GameChat';

afterEach(() => vi.unstubAllGlobals());
it('opens site Analysis through one safe native link with a reloadable selected ply', () => {
  const id = '298953a3-d5e8-408d-a612-7a63af5f93d3';
  const href = siteAnalysisUrl(id, 2);
  expect(analysisEntry(new URL(href, 'http://localhost'))).toEqual({ kind: 'site', id, ply: 2 });
  const render = (analysisOpen: boolean) => renderToStaticMarkup(createElement(FinishedResultArea, {
    score: '1-0', explanation: 'White won.', analysisHref: analysisOpen ? undefined : href,
  }));
  expect(render(false)).toContain('target="_blank" rel="noopener noreferrer"');
  expect(render(false)).toContain('new tab');
  expect(render(true)).not.toContain('Close analysis');
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
  expect(analysisEntry(new URL(explorerAnalysisUrl('12', fen, 3), 'http://localhost'))).toMatchObject({ ply: 3 });
  expect(cursorFen(selectMain(createAnalysisTree(game), game, 0), game)).toBe(STANDARD_STARTING_FEN);
});

it('shares only the matching, already loaded Opening Explorer replay at a supported ply', () => {
  const origin = 'https://chess.example';
  const entry = analysisEntry(new URL(explorerAnalysisUrl('12', STANDARD_STARTING_FEN, 2)
    + '&token=private#local-state', origin));
  const link = shareableGameUrl(entry, 'explorer-12', 3);
  expect(link).toBe(explorerAnalysisUrl('12', STANDARD_STARTING_FEN, 3));
  expect(shareableGameUrl(entry, 'explorer-13', 3)).toBeNull();
  expect(shareableGameUrl(null, 'import-local', 3)).toBeNull();
  const id = '298953a3-d5e8-408d-a612-7a63af5f93d3';
  expect(shareableGameUrl(analysisEntry(new URL(siteAnalysisUrl(id, 1), origin)), id, 1)).toBeNull();
});

it('round-trips a variation FEN in a standalone link without sending it to the server', () => {
  const fen = parsePgn('1. e4 a6 2. e5 d5 *').finalFen;
  const url = new URL(positionAnalysisUrl(fen)!, 'https://chess.example');
  expect(url.pathname).toBe('/analysis/position');
  expect(url.search).toBe('');
  expect(analysisEntry(url)).toEqual({ kind: 'position', position: { fen, sideToMove: 'white' } });
});

it('continues with the correct move number and side when a shared position starts with Black', () => {
  const fen = parsePgn('1. e4 e5 2. Nf3 *').finalFen;
  const base = importParsedPgn(parsePgn('*'), 'blank-shared-position').game;
  const game = { ...base, position: { fen, sideToMove: 'black' as const } };
  const result = playAnalysisMove(createAnalysisTree(game), game, 'b8', 'c6');
  if (!result.accepted) throw new Error(result.result.message);
  expect(buildMoveTree(game, result.tree, result.tree.cursor).main.moves[0]?.notation).toBe('2... Nc6');
});

it.each([
  '8/8/8/8/8/8/8/8 w - - 0 1',
  '4k3/8/8/8/8/8/4R3/4K3 w - - 0 1',
  '4k3/8/8/8/8/8/8/4K3 w K - 0 1',
  '4k3/8/8/8/8/8/8/4K3 w - d6 0 1',
  '4k3/8/8/8/8/8/8/4K3 w - - 0 99999999999999999',
])('rejects invalid standalone FEN %s', fen => {
  expect(positionAnalysisUrl(fen)).toBeNull();
  const url = new URL('/analysis/position#' + new URLSearchParams({ fen }), 'https://chess.example');
  expect(analysisEntry(url)).toEqual({ kind: 'position', position: null });
});

it('reports explorer authorization or loading failures on the destination page', async () => {
  vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('', { status: 401 })));
  await expect(loadExplorerAnalysis('12', STANDARD_STARTING_FEN, new AbortController().signal)).rejects.toThrow('session expired');
});

it('puts conversation tabs and Hide in the analysis header without a duplicate heading', () => {
  const html = renderToStaticMarkup(createElement(GameChat, { gameId: 'demo', side: 'white',
    gameStatus: 'finished', csrfToken: 'token', revision: 0 }));
  expect(html).not.toContain('>Game chat</h2>');
  const header = html.slice(html.indexOf('class="game-chat-header"'), html.indexOf('class="game-chat-content"'));
  expect(header).toContain('>Chat</button>'); expect(header).toContain('>Notes</button>');
  expect(header).toContain('aria-label="Mute chat"');
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
