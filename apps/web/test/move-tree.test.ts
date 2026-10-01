import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { createPosition } from '@chess/domain';
import type { GameReadResponse } from '@chess/contracts';
import { createAnalysisTree, deleteVariation, playAnalysisMove, selectBranch,
  selectMain } from '../src/analysis-model';
import { MoveTree } from '../src/MoveTree';
import { buildMoveTree, moveNotation } from '../src/move-tree-model';

function savedGame(): GameReadResponse {
  const position = createPosition();
  position.submitMove({ side: 'white', from: 'e2', to: 'e4' });
  position.submitMove({ side: 'black', from: 'e7', to: 'e5' });
  return { id: 'finished', version: 2, status: 'finished', yourSeat: 'white',
    position: position.getPosition(), history: position.getHistory(),
    result: { outcome: 'draw', reason: 'agreement' }, clocks: null,
    clockStatus: 'not_integrated', timeControl: { initialMs: 300_000, incrementMs: 3_000 },
    rated: false };
}

function play(game: GameReadResponse, tree: ReturnType<typeof createAnalysisTree>,
  from: string, to: string) {
  const result = playAnalysisMove(tree, game, from, to);
  if (!result.accepted) throw new Error(`Expected ${from}${to} to be legal.`);
  return result.tree;
}

describe('nested move tree', () => {
  it('uses standard move numbers for saved and alternative moves', () => {
    expect(moveNotation(1, 'e4')).toBe('1. e4');
    expect(moveNotation(2, 'e5')).toBe('1... e5');
    expect(moveNotation(3, 'Nf3')).toBe('2. Nf3');
  });

  it('places sibling and nested branches under their actual parent move', () => {
    const game = savedGame();
    const initial = selectMain(createAnalysisTree(game), game, 0);
    const d4 = play(game, initial, 'd2', 'd4');
    const d5 = play(game, d4, 'd7', 'd5');
    const c4 = play(game, selectMain(d5, game, 0), 'c2', 'c4');
    const afterE4 = play(game, selectMain(c4, game, 1), 'c7', 'c5');
    const view = buildMoveTree(game, afterE4, afterE4.cursor);
    expect(view.rootBranches.map(item => item.notation)).toEqual(['1. d4', '1. c4']);
    expect(view.rootBranches[0]?.children.map(item => item.notation)).toEqual(['1... d5']);
    expect(view.rootBranches[1]?.children).toEqual([]);
    expect(view.savedMoves.map(item => item.notation)).toEqual(['1. e4', '1... e5']);
    expect(view.savedMoves[0]?.branches.map(item => item.notation)).toEqual(['1... c5']);
    expect(view.savedMoves[1]?.branches).toEqual([]);
    expect(view.savedMoves[0]?.onPath).toBe(true);
    expect(view.savedMoves[0]?.branches[0]?.selected).toBe(true);
    expect(view.rootBranches[0]?.onPath).toBe(false);
  });

  it('keeps a variation in one line until a real fork and highlights the selected path', () => {
    const game = savedGame();
    const d4 = play(game, selectMain(createAnalysisTree(game), game, 0), 'd2', 'd4');
    const d5 = play(game, d4, 'd7', 'd5');
    const nc3 = play(game, d5, 'b1', 'c3');
    const render = (tree: typeof nc3) => renderToStaticMarkup(createElement(MoveTree,
      { game, tree, selected: tree.cursor, interactive: true, onSelect: () => {}, onDelete: () => {} }));
    const html = render(nc3);
    expect(html).toContain('1. d4');
    expect(html).toContain('>d5</button>');
    expect(html).toContain('2. Nc3');
    expect(html).not.toContain('from branch');
    expect(html).not.toContain('#1');
    expect((html.match(/class="variation-list"/g) ?? [])).toHaveLength(1);
    expect(html).toMatch(/1\. d4[\s\S]*>d5<\/button>[\s\S]*aria-current="step"[^>]*>2\. Nc3/);
    expect(html).toContain('Delete variation from 1... d5');
    const nf6 = play(game, nc3, 'g8', 'f6');
    const forked = play(game, selectBranch(nf6, 3), 'c7', 'c6');
    const forkHtml = render(forked);
    expect((forkHtml.match(/class="variation-list"/g) ?? [])).toHaveLength(2);
    expect(forkHtml).toContain('2... Nf6');
    expect(forkHtml).toContain('2... c6');
    expect(forkHtml).toContain('2. Nc3');
    expect(html).toContain('1. e4');
    expect(html).toContain('1... e5');
  });

  it('keeps siblings and saved moves after deletion', () => {
    const game = savedGame();
    const first = play(game, selectMain(createAnalysisTree(game), game, 0), 'd2', 'd4');
    const nested = play(game, first, 'd7', 'd5');
    const siblings = play(game, selectMain(nested, game, 0), 'c2', 'c4');
    const remaining = deleteVariation(siblings, 1);
    const view = buildMoveTree(game, remaining, remaining.cursor);
    expect(view.rootBranches.map(item => item.notation)).toEqual(['1. c4']);
    expect(view.savedMoves.map(item => item.notation)).toEqual(['1. e4', '1... e5']);
    expect(game.history).toHaveLength(2);
  });

  it('keeps the live-game move list noninteractive', () => {
    const game = { ...savedGame(), status: 'active' as const, result: null };
    const html = renderToStaticMarkup(createElement(MoveTree, { game, tree: null,
      selected: { kind: 'main', ply: 2 }, interactive: false,
      onSelect: () => {}, onDelete: () => {} }));
    expect(html).toContain('1. e4');
    expect(html).toContain('1... e5');
    expect(html).not.toContain('<button');
  });
});
