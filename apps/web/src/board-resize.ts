import { resizedBoardSize } from './analysis-workspace';

/** Preview geometry once per frame; publish React state only at the end of a gesture. */
export function createResizePreview(preview: (size: number) => void, commit: (size: number) => void,
  limit: number, request = requestAnimationFrame, cancel = cancelAnimationFrame) {
  let frame: number | null = null;
  let size: number | null = null;
  const flush = () => { frame = null; if (size !== null) preview(size); };
  return {
    update(start: number, x: number, y: number) {
      size = resizedBoardSize(start, x, y, limit);
      if (frame === null) frame = request(flush);
    },
    finish() {
      if (frame !== null) cancel(frame);
      flush();
      if (size !== null) commit(size);
    },
    cancel() { if (frame !== null) cancel(frame); frame = null; size = null; },
  };
}
