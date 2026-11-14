import { describe, expect, it } from 'vitest';
import { isEditableKeyTarget, isViewingLiveHistory, moveNavigationDirection,
  nextReplaySelection } from '../src/move-keyboard';
import { createAnalysisTree, cursorFen, nextPosition, playAnalysisMove, previousPosition,
  promoteVariation, selectMain } from '../src/analysis-model';
import { importPgn } from '../src/pgn-import';

describe('keyboard move navigation', () => {
  const event = (target: EventTarget | null, key = 'ArrowLeft') => ({ target, key,
    defaultPrevented: false, altKey: false, ctrlKey: false, metaKey: false, shiftKey: false });

  it('navigates from ordinary section buttons without requiring board focus', () => {
    // A section button in a labelled group has no native horizontal-arrow interaction.
    const button = { closest: () => null } as unknown as EventTarget;
    expect(moveNavigationDirection(event(button))).toBe(-1);
    expect(moveNavigationDirection(event(button, 'ArrowRight'))).toBe(1);
    expect(moveNavigationDirection(event(button, 'Enter'))).toBeNull();
    expect(moveNavigationDirection({ ...event(button), defaultPrevented: true })).toBeNull();
    for (const modifier of ['altKey', 'ctrlKey', 'metaKey', 'shiftKey'] as const) {
      expect(moveNavigationDirection({ ...event(button), [modifier]: true })).toBeNull();
    }
  });

  it.each(['input', 'textarea', 'select', '[role="slider"]', '[role="spinbutton"]',
    '[role="combobox"]', '[role="listbox"]', '[role="menu"]', '[role="tree"]',
    '[role="grid"]', '[role="tablist"]', '[role="radiogroup"]'])
    ('leaves horizontal arrows to an editable or arrow-driven widget: %s', selector => {
      const target = { closest: (query: string) => query.split(', ').includes(selector) ? {} : null
      } as unknown as EventTarget;
      expect(moveNavigationDirection(event(target))).toBeNull();
      expect(moveNavigationDirection(event(target, 'ArrowRight'))).toBeNull();
    });

  it('steps through confirmed plies and resumes following the live game at the end', () => {
    expect(nextReplaySelection(null, 2, -1, true)).toBe(1);
    expect(nextReplaySelection(1, 2, -1, true)).toBe(0);
    expect(nextReplaySelection(0, 2, -1, true)).toBe(0);
    expect(nextReplaySelection(0, 2, 1, true)).toBe(1);
    expect(nextReplaySelection(1, 2, 1, true)).toBeNull();
    expect(nextReplaySelection(null, 2, 1, true)).toBeNull();
    expect(nextReplaySelection(null, 2, -1, false)).toBe(1);
    expect(nextReplaySelection(1, 2, 1, false)).toBe(2);
    expect(isViewingLiveHistory('active', 1, 2)).toBe(true);
    expect(isViewingLiveHistory('active', null, 2)).toBe(false);
    expect(isViewingLiveHistory('active', 2, 2)).toBe(false);
    expect(isViewingLiveHistory('finished', 1, 2)).toBe(false);
  });

  it('ignores editable targets, including descendants of an editable container', () => {
    let selector = '';
    const editable = { closest: (query: string) => { selector = query; return {}; } } as unknown as EventTarget;
    const ordinary = { closest: () => null } as unknown as EventTarget;
    expect(isEditableKeyTarget(editable)).toBe(true);
    expect(selector).toContain('input');
    expect(selector).toContain('textarea');
    expect(selector).toContain('[contenteditable]');
    expect(isEditableKeyTarget(ordinary)).toBe(false);
    expect(isEditableKeyTarget(null)).toBe(false);
  });

  it('accumulates repeated inputs over a long main line and a preferred variation', () => {
    const game = importPgn(Array.from({ length: 150 }, (_, i) =>
      `${i * 2 + 1}. Nf3 Nf6 ${i * 2 + 2}. Ng1 Ng8`).join(' ') + ' *', 'keyboard-long').game;
    const start = selectMain(createAnalysisTree(game), game, 0);
    const repeat = (key: string, count: number) => Array.from({ length: count }, () => event(null, key));
    const step = (tree: typeof start, key: ReturnType<typeof event>) => {
      const direction = moveNavigationDirection(key);
      return direction === -1 ? previousPosition(tree) : direction === 1 ? nextPosition(tree, game) : tree;
    };
    const burst = [...repeat('ArrowRight', 600), ...repeat('ArrowLeft', 381), ...repeat('ArrowRight', 43)];
    const reached = burst.reduce(step, start);
    expect(reached.cursor).toEqual({ kind: 'main', ply: 262 });
    expect(cursorFen(reached, game)).toBe(game.history[261]?.afterFen);
    expect(repeat('ArrowLeft', 300).reduce(step, reached).cursor).toEqual(start.cursor);

    const first = playAnalysisMove(start, game, 'e2', 'e4');
    if (!first.accepted) throw new Error('Invalid test variation');
    const reply = playAnalysisMove(first.tree, game, 'e7', 'e5');
    if (!reply.accepted || reply.tree.cursor.kind !== 'branch') throw new Error('Invalid test reply');
    const preferred = selectMain(promoteVariation(reply.tree, reply.tree.cursor.id), game, 0);
    const branch = repeat('ArrowRight', 3).reduce(step, preferred);
    expect(branch.cursor).toEqual(reply.tree.cursor);
    expect(cursorFen(branch, game)).toBe(cursorFen(reply.tree, game));
    expect(repeat('ArrowLeft', 2).reduce(step, branch).cursor).toEqual(start.cursor);
  });
});
