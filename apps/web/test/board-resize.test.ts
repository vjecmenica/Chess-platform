import { expect, it, vi } from 'vitest';
import { createResizePreview } from '../src/board-resize';

it('coalesces pointer events into a frame and commits only the final size', () => {
  let frame: FrameRequestCallback = () => {};
  const request = vi.fn((callback: FrameRequestCallback) => { frame = callback; return 1; });
  const preview = vi.fn(), commit = vi.fn(), cancel = vi.fn();
  const resize = createResizePreview(preview, commit, 700, request, cancel);
  resize.update(400, 20, 20); resize.update(400, 60, 40);
  expect(request).toHaveBeenCalledTimes(1); expect(commit).not.toHaveBeenCalled();
  frame(0); expect(preview).toHaveBeenLastCalledWith(450);
  resize.update(400, 1000, 1000); resize.finish();
  expect(preview).toHaveBeenLastCalledWith(700);
  expect(commit).toHaveBeenCalledExactlyOnceWith(700); expect(cancel).toHaveBeenCalledWith(1);
});

it('cancels queued geometry on teardown and does not commit an untouched grip', () => {
  let frame: FrameRequestCallback = () => {};
  const preview = vi.fn(), commit = vi.fn(), cancel = vi.fn();
  const resize = createResizePreview(preview, commit, 600, callback => { frame = callback; return 2; }, cancel);
  resize.finish(); expect(commit).not.toHaveBeenCalled();
  resize.update(400, 30, 30); resize.cancel(); frame(0);
  expect(cancel).toHaveBeenCalledWith(2); expect(preview).not.toHaveBeenCalled(); expect(commit).not.toHaveBeenCalled();
});
