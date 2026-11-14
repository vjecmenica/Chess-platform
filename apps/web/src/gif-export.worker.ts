/// <reference lib="webworker" />
import { applyPalette, GIFEncoder, quantize } from 'gifenc';
import { paintBoardSurface, paintReplayFrame } from './board-image';
import { gifFrameDelay, gifMaxBytes, gifSize, type GifFrame } from './gif-frames';
import type { GifJob, GifUpdate } from './gif-export';

const scope = self as unknown as DedicatedWorkerGlobalScope;
const report = (data: GifUpdate) => scope.postMessage(data);

scope.onmessage = ({ data }: MessageEvent<GifJob>) => {
  const { frames, images, surfaces, appearance, orientation, delay } = data;
  try {
    const board = new OffscreenCanvas(gifSize, gifSize);
    const background = board.getContext('2d');
    const frame = new OffscreenCanvas(gifSize, gifSize);
    const context = frame.getContext('2d', { alpha: false, willReadFrequently: true });
    if (!background || !context) throw new Error('Background canvas is unavailable in this browser.');
    const ctx = context;
    paintBoardSurface(background, surfaces, images, appearance, gifSize);

    function pixels(position: GifFrame) {
      paintReplayFrame(ctx, board, position, orientation, images, appearance, gifSize);
      return ctx.getImageData(0, 0, gifSize, gifSize).data;
    }

    // The first two frames capture texture, pieces, and last-move highlights.
    // A shared palette avoids color flicker and repeated quantization.
    const first = pixels(frames[0]!);
    const second = pixels(frames[1]!);
    const samples = new Uint8ClampedArray(first.length + second.length);
    samples.set(first);
    samples.set(second, first.length);
    const palette = quantize(samples, 256);
    const gif = GIFEncoder();
    for (const [index, position] of frames.entries()) {
      const rgba = index === 0 ? first : index === 1 ? second : pixels(position);
      gif.writeFrame(applyPalette(rgba, palette), gifSize, gifSize, {
        ...(index === 0 ? { palette } : {}), delay: gifFrameDelay(delay, index === frames.length - 1),
      });
      if (gif.bytesView().length >= gifMaxBytes) throw new Error('The animation exceeds the 16 MB GIF limit.');
      if ((index + 1) % 4 === 0 || index === frames.length - 1) report({ done: index + 1 });
    }
    gif.finish();
    const bytes = gif.bytes().buffer;
    scope.postMessage({ bytes } satisfies GifUpdate, [bytes]);
  } catch (error) {
    report({ error: error instanceof Error ? error.message : 'GIF encoding failed.' });
  } finally { for (const image of images.values()) image.close(); }
};
