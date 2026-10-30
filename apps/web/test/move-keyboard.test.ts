import { describe, expect, it } from 'vitest';
import { isEditableKeyTarget, isViewingLiveHistory, moveNavigationDirection,
  nextReplaySelection } from '../src/move-keyboard';

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
});
