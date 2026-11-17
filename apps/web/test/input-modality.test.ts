import { afterEach, expect, it, vi } from 'vitest';
import { initializeInputModality } from '../src/input-modality';

afterEach(() => vi.unstubAllGlobals());

it('keeps pointer focus quiet during position shortcuts and restores keyboard focus for Tab and control navigation', () => {
  const dataset: Record<string, string> = {};
  const events = new Map<string, (event?: unknown) => void>();
  class Control {
    constructor(private selector: string) {}
    closest(selector: string) { return selector.includes(this.selector) ? this : null; }
  }
  vi.stubGlobal('Element', Control);
  vi.stubGlobal('document', {
    documentElement: { dataset },
    addEventListener: (type: string, handler: (event?: unknown) => void) => events.set(type, handler),
  });
  initializeInputModality();
  const pointer = () => events.get('pointerdown')!();
  const key = (key: string, selector: string) => events.get('keydown')!({ key, target: new Control(selector) });

  pointer();
  key('ArrowLeft', '.favorite-button');
  expect(dataset.pointerInput).toBe('');
  key('Tab', '.favorite-button');
  expect(dataset.pointerInput).toBeUndefined();
  for (const selector of ['.move-link', '.board-resize-grip', '[role="tablist"]']) {
    pointer();
    key('ArrowRight', selector);
    expect(dataset.pointerInput).toBeUndefined();
  }
});
