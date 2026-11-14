import { describe, expect, it } from 'vitest';
import { moveListScrollTop } from '../src/move-list-scroll';

describe('move list scroll margin', () => {
  const target = (moveTop: number) => moveListScrollTop(320, 450, 1600, moveTop, 32, 32);

  it('keeps comfortable selections still and scrolls before a move leaves either edge', () => {
    expect(target(180)).toBe(320);
    expect(target(320)).toBe(334);
    expect(target(96)).toBe(304);
    expect(target(510)).toBe(524);
    expect(target(-48)).toBe(160);
  });

  it('reduces the margin in short panels and keeps tall comments anchored at their SAN', () => {
    expect(moveListScrollTop(200, 100, 1500, 34, 32, 32)).toBe(200);
    expect(moveListScrollTop(200, 100, 1500, 48, 32, 32)).toBe(214);
    expect(moveListScrollTop(200, 100, 1500, -20, 180, 32)).toBe(180);
  });

  it('clamps scrolling to the available content at the start and end', () => {
    expect(moveListScrollTop(30, 450, 1600, 2, 32, 32)).toBe(0);
    expect(moveListScrollTop(1120, 450, 1600, 412, 32, 32)).toBe(1150);
    expect(moveListScrollTop(0, 450, 200, 0, 32, 32)).toBe(0);
  });
});
