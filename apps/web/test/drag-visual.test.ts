import { describe, expect, it } from 'vitest';
import { advanceDragVisual } from '../src/drag-visual';

describe('floating piece tracking', () => {
  it('starts one rendered drag after the threshold and moves the overlay without further renders', () => {
    const pointer = { x: 100, y: 100, moved: false };
    const overlay = { style: { left: '', top: '' } };
    expect(advanceDragVisual(pointer, 104, 103, overlay)).toBe('idle');
    expect(pointer.moved).toBe(false);
    expect(advanceDragVisual(pointer, 110, 100, null)).toBe('started');
    expect(pointer.moved).toBe(true);
    expect(advanceDragVisual(pointer, 120, 130, overlay)).toBe('moved');
    expect(advanceDragVisual(pointer, 150, 160, overlay)).toBe('moved');
    expect(overlay.style).toEqual({ left: '150px', top: '160px' });
  });
});
