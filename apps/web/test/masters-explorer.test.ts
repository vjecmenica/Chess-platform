import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import { createPosition } from '@chess/domain';
import type { GameReadResponse } from '@chess/contracts';
import { createAnalysisTree, playAnalysisMove, selectMain } from '../src/analysis-model';
import { MoveTree } from '../src/MoveTree';
import { ExplorerContent } from '../src/MastersPanel';
import { playedPercentage, isBookMove, mastersPath, MastersClient, mastersUrl, parseMastersResponse,
  previousMastersPath } from '../src/masters-explorer';

function game(): GameReadResponse {
  const position = createPosition();
  position.submitMove({ side: 'white', from: 'e2', to: 'e4' });
  position.submitMove({ side: 'black', from: 'e7', to: 'e5' });
  return { id: 'masters-test', version: 2, status: 'finished', yourSeat: 'white',
    position: position.getPosition(), history: position.getHistory(),
    result: { outcome: 'draw', reason: 'agreement' }, clocks: null,
    clockStatus: 'not_integrated', timeControl: { initialMs: 300_000, incrementMs: 3_000 },
    rated: false };
}

const response = { opening: { eco: 'C20', name: 'King’s Pawn Game' },
  moves: [{ uci: 'g1f3', san: 'Nf3', white: 13, draws: 5, black: 2 },
    { uci: 'a1a8', san: 'Ra8', white: 1, draws: 0, black: 0 }] };

describe('Masters opening explorer', () => {
  it('renders local statistics, loading, empty, and retry states without external connections or downloads', () => {
    const render = (result: Parameters<typeof ExplorerContent>[0]['result']) => renderToStaticMarkup(
      createElement(ExplorerContent, { result, onExplore: () => {}, onRetry: () => {} }));
    expect(render(null)).toContain('Loading opening statistics');
    expect(render({ kind: 'ok', data: { opening: null, moves: [] } })).toContain('No indexed games');
    expect(render({ kind: 'error', message: 'Opening explorer timed out.' })).toContain('Retry');
    const html = render({ kind: 'ok', data: parseMastersResponse(response, game().position.fen) });
    expect(html).toContain('20 games');
    expect(html).toContain('class="book-white" style="width:65%"');
    expect(html).toContain('class="book-draw" style="width:25%"');
    expect(html).toContain('class="book-black" style="width:10%"');
    expect(html).not.toContain(' title=');
    expect(html).toContain('class="book-outcome-values" aria-hidden="true"><span>65%</span><span>25%</span><span>10%</span>');
    expect(html).toContain('Played %');
    expect(html).toContain('White 65.0%'); expect(html).toContain('Draw 25.0%'); expect(html).toContain('Black 10.0%');
    expect(html).toContain('Explore Nf3 as a local analysis variation');
    expect(html).toContain('licensed TWIC');
    expect(html).not.toMatch(/Lichess|OAuth|download/i);
  });
  it('makes the entire candidate row one native button containing its statistics and outcome bar', () => {
    const result = { kind: 'ok' as const, data: parseMastersResponse(response, game().position.fen) };
    const html = renderToStaticMarkup(createElement(ExplorerContent, { result, onExplore: () => {}, onRetry: () => {} }));
    const buttons = [...html.matchAll(/<button\b[^>]*>[\s\S]*?<\/button>/g)];
    expect(buttons).toHaveLength(1);
    const row = buttons[0]![0];
    expect(row).toContain('class="masters-move"');
    expect(row).toContain('>Nf3</span>');
    expect(row).toContain('100.0%');
    expect(row).toContain('20 games');
    expect(row).toContain('book-outcome-bar');
    expect(row.slice(1)).not.toContain('<button');
    expect(html).not.toContain('onClick=');
  });

  it('keeps minority and zero outcomes readable outside the proportional result bar', () => {
    const result = { kind: 'ok' as const, data: { opening: null, moves: [
      { uci: 'e2e4', san: 'e4', games: 100, white: 99, draws: 1, black: 0 },
    ] } };
    const html = renderToStaticMarkup(createElement(ExplorerContent, { result, onExplore: () => {}, onRetry: () => {} }));
    expect(html).toContain('White 99.0%, Draw 1.0%, Black 0.0%');
    expect(html).toContain('class="book-outcome-values" aria-hidden="true"><span>99%</span><span>1%</span><span>0%</span>');
    expect(html).toContain('class="book-draw" style="width:1%"');
  });
  it('builds the saved and local variation paths from the initial FEN', () => {
    const saved = game();
    let tree = createAnalysisTree(saved);
    expect(mastersPath(saved, tree).play).toEqual(['e2e4', 'e7e5']);
    expect(previousMastersPath(saved, tree)?.uci).toBe('e7e5');
    tree = selectMain(tree, saved, 0);
    const branch = playAnalysisMove(tree, saved, 'd2', 'd4');
    expect(branch.accepted).toBe(true);
    if (!branch.accepted) return;
    expect(mastersPath(saved, branch.tree).play).toEqual(['d2d4']);
    expect(mastersUrl(mastersPath(saved, branch.tree))).toMatch(/^\/api\/opening-explorer\?fen=/);
  });

  it('accepts only legal reported candidates and confirms Book separately', () => {
    const saved = game();
    const data = parseMastersResponse(response, saved.position.fen);
    expect(data.opening).toEqual(response.opening);
    expect(data.moves).toEqual([{ uci: 'g1f3', san: 'Nf3', games: 20,
      white: 13, draws: 5, black: 2 }]);
    expect(isBookMove(data, 'g1f3')).toBe(true);
    expect(isBookMove(data, 'a1a8')).toBe(false);
    const html = renderToStaticMarkup(createElement(MoveTree, { game: saved,
      tree: createAnalysisTree(saved), selected: { kind: 'main', ply: 2 }, interactive: true,
      bookMoves: new Set(['masters-test:m2']), onSelect: () => {}, onDelete: () => {} }));
    expect(html).toContain('Book move, confirmed by the opening explorer');
    expect(html).toContain('>Book</span>');
  });

  it('explores a candidate locally without changing the saved position or history', () => {
    const saved = game();
    const before = saved.position.fen;
    const history = saved.history.map(move => move.uci);
    const candidate = parseMastersResponse(response, before).moves[0]!;
    const explored = playAnalysisMove(createAnalysisTree(saved), saved,
      candidate.uci.slice(0, 2), candidate.uci.slice(2, 4));
    expect(explored.accepted).toBe(true);
    if (!explored.accepted) return;
    expect(explored.tree.cursor.kind).toBe('branch');
    expect(saved.position.fen).toBe(before);
    expect(saved.history.map(move => move.uci)).toEqual(history);
  });

  it('uses bounded memory caching and respects a 429 cooldown', async () => {
    const saved = game();
    const path = mastersPath(saved, createAnalysisTree(saved));
    const fetcher = vi.fn<typeof fetch>().mockResolvedValueOnce(new Response(JSON.stringify(response),
      { status: 200 })).mockResolvedValueOnce(new Response('', { status: 429 }));
    let now = 0;
    const client = new MastersClient(fetcher, () => now);
    expect((await client.lookup(path)).kind).toBe('ok');
    expect((await client.lookup(path)).kind).toBe('ok');
    expect(fetcher).toHaveBeenCalledTimes(1);
    expect(fetcher.mock.calls[0]?.[1]).toMatchObject({ credentials: 'same-origin', headers: { Accept: 'application/json' } });
    now = 300_001;
    expect((await client.lookup(path)).kind).toBe('error');
    expect((await client.lookup(path)).kind).toBe('error');
    expect(fetcher).toHaveBeenCalledTimes(2);
  });

  it('calls the browser fetch function without binding it to the client instance', async () => {
    const fetcher = vi.spyOn(globalThis, 'fetch').mockImplementation(function (this: unknown) {
      if (this !== undefined && this !== globalThis) throw new TypeError('Illegal invocation');
      return Promise.resolve(new Response(JSON.stringify(response), { status: 200 }));
    });
    try {
      const client = new MastersClient();
      expect((await client.lookup(mastersPath(game(), createAnalysisTree(game())))).kind).toBe('ok');
      expect(fetcher).toHaveBeenCalledTimes(1);
    } finally { fetcher.mockRestore(); }
  });

  it('cancels a queued lookup before sending it', async () => {
    const saved = game();
    const path = mastersPath(saved, createAnalysisTree(saved));
    let release!: (value: Response) => void;
    const fetcher = vi.fn<typeof fetch>().mockImplementation(() => new Promise(resolve => { release = resolve; }));
    const client = new MastersClient(fetcher);
    const first = client.lookup(path);
    await vi.waitFor(() => expect(fetcher).toHaveBeenCalledTimes(1));
    const abort = new AbortController();
    const second = client.lookup(path, abort.signal);
    abort.abort();
    release(new Response(JSON.stringify(response), { status: 200 }));
    expect((await first).kind).toBe('ok');
    expect((await second).kind).toBe('cancelled');
    expect(fetcher).toHaveBeenCalledTimes(1);
  });

  it('distinguishes expired sessions, access errors, and successful local lookups', async () => {
    const path = mastersPath(game(), createAnalysisTree(game()));
    const fetcher = vi.fn<typeof fetch>().mockResolvedValueOnce(new Response('', { status: 401 }))
      .mockResolvedValueOnce(new Response('', { status: 403 }))
      .mockResolvedValueOnce(new Response(JSON.stringify(response), { status: 200 }));
    const client = new MastersClient(fetcher);
    expect(await client.lookup(path)).toMatchObject({ kind: 'error', message: expect.stringContaining('session expired') });
    expect((await client.lookup(path)).kind).toBe('error');
    expect((await client.lookup(path)).kind).toBe('ok');
  });
});

it('uses every candidate support count for played percentage, including off-screen candidates', () => {
 const moves = [1, 3, 6].map(games => ({ uci: 'e2e4', san: 'e4', games, white: games, draws: 0, black: 0 }));
 expect(playedPercentage(moves, 3)).toBe(30);
 expect(playedPercentage([], 0)).toBe(0);
});
