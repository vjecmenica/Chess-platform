import type { BoardAppearance, GameSide } from '@chess/contracts';
import { boardRows, type Piece } from './board-model';
import { pieceImage } from './board-interaction';

const squareSize = 128;
const imageSize = squareSize * 8;

// CSS positions percentages in the space left over after sizing the background.
export function textureCrop(size: number, scale: number, position: number): [start: number, length: number] {
  const length = size / scale;
  return [(size - length) * position, length];
}

function percentage(value: string): number {
  if (!/^-?\d+(?:\.\d+)?%$/.test(value)) throw new Error('Unsupported board texture geometry.');
  return parseFloat(value) / 100;
}

function squareSurface(square: HTMLElement) {
  const style = getComputedStyle(square);
  const color = style.backgroundColor;
  if (style.backgroundImage === 'none') return { color, texture: null };
  const image = /^url\("([^"]+)"\)$/.exec(style.backgroundImage)?.[1];
  const [width, height = width] = style.backgroundSize.split(' ');
  if (!image || !width || !height) throw new Error('Unsupported board texture.');
  return { color, texture: {
    image, width: percentage(width), height: percentage(height),
    x: percentage(style.backgroundPositionX), y: percentage(style.backgroundPositionY),
    blend: style.backgroundBlendMode === 'soft-light' ? 'soft-light' as const : 'source-over' as const,
  } };
}

function loadBoardAsset(path: string): Promise<HTMLImageElement> {
  const url = new URL(path, window.location.origin);
  if (url.origin !== window.location.origin || !/^\/(boards|pieces)\//.test(url.pathname))
    return Promise.reject(new Error('Board assets must be served by this site.'));
  const image = new Image();
  image.src = url.href;
  return image.decode().then(() => image);
}

type DrawingContext = CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D;

// Snapshot the displayed surfaces before loading assets. Board overlays and UI never enter the image.
export function snapshotBoardSurfaces(board: HTMLElement, orientation: GameSide, fen: string) {
  const elements = new Map(Array.from(board.querySelectorAll<HTMLElement>('.square[data-square]'),
    element => [element.dataset.square, element]));
  return boardRows(fen, orientation).flat().map(({ square }) => {
    const element = elements.get(square);
    if (!element) throw new Error('The board is no longer available.');
    return { square, ...squareSurface(element) };
  });
}

export type BoardSurfaces = ReturnType<typeof snapshotBoardSurfaces>;

export async function loadBoardImages<T extends CanvasImageSource>(surfaces: BoardSurfaces,
  pieces: readonly (Piece | null)[], appearance: BoardAppearance, prepare: (image: HTMLImageElement) => Promise<T>,
  signal?: AbortSignal): Promise<Map<string, T>> {
  const paths = new Set(surfaces.flatMap(({ texture }) => texture ? [texture.image] : []));
  for (const piece of pieces) if (piece) paths.add(pieceImage(piece, appearance.pieceSet));
  const decoded = await Promise.allSettled([...paths].map(async path => {
    const image = await loadBoardAsset(path);
    signal?.throwIfAborted();
    return [path, await prepare(image)] as const;
  }));
  const images = new Map(decoded.flatMap(result => result.status === 'fulfilled' ? [result.value] : []));
  if (images.size !== paths.size || signal?.aborted) {
    for (const image of images.values()) if ('close' in image) image.close();
    throw new Error('Board images could not be loaded.');
  }
  return images;
}

export function paintBoardSurface(ctx: DrawingContext, squares: BoardSurfaces,
  images: ReadonlyMap<string, HTMLImageElement | ImageBitmap>, appearance: BoardAppearance, size: number): void {
  const squareSize = size / 8;
  for (const [index, { color, texture }] of squares.entries()) {
    const x = (index % 8) * squareSize, y = Math.floor(index / 8) * squareSize;
    ctx.fillStyle = color;
    ctx.fillRect(x, y, squareSize, squareSize);
    if (texture) {
      const image = images.get(texture.image)!;
      const [sx, sw] = textureCrop('naturalWidth' in image ? image.naturalWidth : image.width, texture.width, texture.x);
      const [sy, sh] = textureCrop('naturalHeight' in image ? image.naturalHeight : image.height, texture.height, texture.y);
      ctx.globalCompositeOperation = texture.blend;
      ctx.drawImage(image, sx, sy, sw, sh, x, y, squareSize, squareSize);
      ctx.globalCompositeOperation = 'source-over';
    }
    if (appearance.grid) {
      ctx.strokeStyle = '#5e4a3860';
      ctx.strokeRect(x + .5, y + .5, squareSize - 1, squareSize - 1);
    }
  }
}

export function paintBoardPieces(ctx: DrawingContext, pieces: readonly (Piece | null)[],
  images: ReadonlyMap<string, CanvasImageSource>, appearance: BoardAppearance, size: number): void {
  const squareSize = size / 8;
  const pieceSize = squareSize * .88;
  const scaledPieceSize = pieceSize * appearance.scale / 100;
  const inset = (squareSize - scaledPieceSize) / 2;
  const offset = pieceSize * appearance.offset / 100;
  ctx.shadowColor = `rgba(0, 0, 0, ${appearance.shadow / 100})`;
  ctx.shadowBlur = 3;
  ctx.shadowOffsetY = 1;
  for (const [index, piece] of pieces.entries()) {
    if (!piece) continue;
    const x = (index % 8) * squareSize, y = Math.floor(index / 8) * squareSize;
    ctx.drawImage(images.get(pieceImage(piece, appearance.pieceSet))!, x + inset, y + inset + offset,
      scaledPieceSize, scaledPieceSize);
  }
  ctx.shadowColor = 'transparent';
  if (appearance.frame && appearance.frameWidth > 0) {
    const edge = appearance.frameWidth;
    ctx.strokeStyle = appearance.frameColor;
    ctx.lineWidth = edge;
    ctx.strokeRect(edge / 2, edge / 2, size - edge, size - edge);
  }
}

export async function exportBoardImage(board: HTMLElement, fen: string, orientation: GameSide,
  appearance: BoardAppearance, coordinates: boolean): Promise<Blob> {
  const squares = snapshotBoardSurfaces(board, orientation, fen);
  const pieces = boardRows(fen, orientation).flat().map(({ piece }) => piece);
  const images = await loadBoardImages(squares, pieces, appearance, async image => image);
  const canvas = document.createElement('canvas');
  canvas.width = imageSize;
  canvas.height = imageSize;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('Image export is unavailable in this browser.');
  paintBoardSurface(ctx, squares, images, appearance, imageSize);
  paintBoardPieces(ctx, pieces, images, appearance, imageSize);
  if (coordinates) {
    ctx.font = '600 21px system-ui, sans-serif';
    ctx.lineWidth = 3;
    ctx.strokeStyle = '#24201de0';
    ctx.fillStyle = '#fff9ef';
    ctx.lineJoin = 'round';
    for (const [index, { square }] of squares.entries()) {
      const x = (index % 8) * squareSize, y = Math.floor(index / 8) * squareSize;
      const file = square.charAt(0);
      const rank = square.charAt(1);
      if (x === 0) {
        ctx.strokeText(rank, 8, y + 24);
        ctx.fillText(rank, 8, y + 24);
      }
      if (y === imageSize - squareSize) {
        ctx.strokeText(file, x + squareSize - 22, imageSize - 8);
        ctx.fillText(file, x + squareSize - 22, imageSize - 8);
      }
    }
  }
  return new Promise((resolve, reject) => canvas.toBlob(blob => {
    if (blob) resolve(blob);
    else reject(new Error('The board image could not be encoded.'));
  }, 'image/png'));
}
