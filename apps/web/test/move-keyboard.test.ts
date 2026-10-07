import { describe, expect, it } from 'vitest';
import { isEditableKeyTarget, isViewingLiveHistory,
  nextReplaySelection } from '../src/move-keyboard';

describe('keyboard move navigation', () => {
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
