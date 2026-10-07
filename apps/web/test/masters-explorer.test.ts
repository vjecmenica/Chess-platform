import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import { createPosition } from '@chess/domain';
import type { GameReadResponse } from '@chess/contracts';
import { createAnalysisTree, playAnalysisMove, selectMain } from '../src/analysis-model';
import { MoveTree } from '../src/MoveTree';
import { isBookMove, mastersPath, MastersClient, mastersUrl, parseMastersResponse,
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
    expect(new URL(mastersUrl(mastersPath(saved, branch.tree))).hostname)
      .toBe('explorer.lichess.org');
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
    expect(html).toContain('Book move, confirmed by Lichess Masters Explorer');
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
    now = 300_001;
    expect((await client.lookup(path)).kind).toBe('error');
    expect((await client.lookup(path)).kind).toBe('error');
    expect(fetcher).toHaveBeenCalledTimes(2);
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
});
