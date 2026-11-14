import type { BoardAppearance, GameReadResponse, GameSide } from '@chess/contracts';
import { loadBoardImages, snapshotBoardSurfaces, type BoardSurfaces } from './board-image';
import type { Piece } from './board-model';
import { gifFrames, gifSize } from './gif-frames';

export interface GifJob {
  frames: ReturnType<typeof gifFrames>;
  surfaces: BoardSurfaces;
  images: Map<string, ImageBitmap>;
  appearance: BoardAppearance;
  orientation: GameSide;
  delay: number;
}
export type GifUpdate = { done: number } | { bytes: ArrayBuffer } | { error: string };

export async function exportGameGif(board: HTMLElement, game: GameReadResponse, orientation: GameSide,
  appearance: BoardAppearance, delay: number, signal: AbortSignal, onProgress: (done: number) => void): Promise<Blob> {
  signal.throwIfAborted();
  if (typeof Worker === 'undefined' || typeof OffscreenCanvas === 'undefined' || typeof createImageBitmap !== 'function')
    throw new Error('GIF export requires a browser with background canvas support.');
  const frames = gifFrames(game);
  const surfaces = snapshotBoardSurfaces(board, orientation, frames[0]!.fen);
  const scratch = document.createElement('canvas');
  scratch.width = scratch.height = gifSize / 8;
  const ctx = scratch.getContext('2d');
  if (!ctx) throw new Error('GIF export is unavailable in this browser.');
  const images = await loadBoardImages(surfaces, [...'pnbrqkPNBRQK'] as Piece[], appearance, image => {
    if (!image.src.endsWith('.svg')) return createImageBitmap(image);
    // Rasterize SVG pieces once at frame scale before transferring them to the worker.
    ctx.clearRect(0, 0, scratch.width, scratch.height);
    ctx.drawImage(image, 0, 0, scratch.width, scratch.height);
    return createImageBitmap(scratch);
  }, signal);

  try {
    signal.throwIfAborted();
    const worker = new Worker(new URL('./gif-export.worker.ts', import.meta.url), { type: 'module' });
    return await new Promise<Blob>((resolve, reject) => {
      function finish(result: Blob | Error) {
        worker.terminate();
        signal.removeEventListener('abort', cancel);
        if (result instanceof Error) reject(result); else resolve(result);
      }
      const cancel = () => finish(new DOMException('GIF export canceled.', 'AbortError'));
      signal.addEventListener('abort', cancel, { once: true });
      worker.onerror = worker.onmessageerror = () => finish(new Error('The GIF worker could not finish. Try again.'));
      worker.onmessage = ({ data }: MessageEvent<GifUpdate>) => {
        if ('done' in data) onProgress(data.done);
        else if ('error' in data) finish(new Error(data.error));
        else finish(new Blob([data.bytes], { type: 'image/gif' }));
      };
      const job: GifJob = { frames, surfaces, images, orientation, appearance, delay };
      try { worker.postMessage(job, [...images.values()]); }
      catch { finish(new Error('The board images could not be sent to the GIF worker.')); }
    });
  } finally { for (const image of images.values()) image.close(); }
}
