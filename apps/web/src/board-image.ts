import type { BoardAppearance, GameSide } from '@chess/contracts';
import { boardRows } from './board-model';
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

export async function exportBoardImage(board: HTMLElement, fen: string, orientation: GameSide,
  appearance: BoardAppearance, coordinates: boolean): Promise<Blob> {
  // Snapshot the displayed surfaces before loading assets. Board overlays and UI never enter the image.
  const elements = new Map(Array.from(board.querySelectorAll<HTMLElement>('.square[data-square]'),
    element => [element.dataset.square, element]));
  const squares = boardRows(fen, orientation).flat().map(({ square, piece }, index) => {
    const element = elements.get(square);
    if (!element) throw new Error('The board is no longer available.');
    return {
      square, x: (index % 8) * squareSize, y: Math.floor(index / 8) * squareSize,
      piece: piece ? pieceImage(piece, appearance.pieceSet) : null,
      ...squareSurface(element),
    };
  });
  const paths = new Set(squares.flatMap(({ texture, piece }) => [texture?.image, piece].filter(
    (path): path is string => !!path)));
  const images = new Map(await Promise.all([...paths].map(async path => [path, await loadBoardAsset(path)] as const)));
  const canvas = document.createElement('canvas');
  canvas.width = imageSize;
  canvas.height = imageSize;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('Image export is unavailable in this browser.');
  const pieceSize = squareSize * .88;
  const scaledPieceSize = pieceSize * appearance.scale / 100;
  const inset = (squareSize - scaledPieceSize) / 2;
  const offset = pieceSize * appearance.offset / 100;

  for (const { x, y, color, texture } of squares) {
    ctx.fillStyle = color;
    ctx.fillRect(x, y, squareSize, squareSize);
    if (texture) {
      const image = images.get(texture.image)!;
      const [sx, sw] = textureCrop(image.naturalWidth, texture.width, texture.x);
      const [sy, sh] = textureCrop(image.naturalHeight, texture.height, texture.y);
      ctx.globalCompositeOperation = texture.blend;
      ctx.drawImage(image, sx, sy, sw, sh, x, y, squareSize, squareSize);
      ctx.globalCompositeOperation = 'source-over';
    }
    if (appearance.grid) {
      ctx.strokeStyle = '#5e4a3860';
      ctx.strokeRect(x + .5, y + .5, squareSize - 1, squareSize - 1);
    }
  }
  ctx.shadowColor = `rgba(0, 0, 0, ${appearance.shadow / 100})`;
  ctx.shadowBlur = 3;
  ctx.shadowOffsetY = 1;
  for (const { x, y, piece } of squares) {
    if (!piece) continue;
    ctx.drawImage(images.get(piece)!, x + inset, y + inset + offset, scaledPieceSize, scaledPieceSize);
  }
  ctx.shadowColor = 'transparent';
  if (appearance.frame && appearance.frameWidth > 0) {
    const edge = appearance.frameWidth;
    ctx.strokeStyle = appearance.frameColor;
    ctx.lineWidth = edge;
    ctx.strokeRect(edge / 2, edge / 2, imageSize - edge, imageSize - edge);
  }
  if (coordinates) {
    ctx.font = '600 21px system-ui, sans-serif';
    ctx.lineWidth = 3;
    ctx.strokeStyle = '#24201de0';
    ctx.fillStyle = '#fff9ef';
    ctx.lineJoin = 'round';
    for (const { x, y, square } of squares) {
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
