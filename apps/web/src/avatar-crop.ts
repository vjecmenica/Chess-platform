import type { ImageSize } from './avatar-source';

export interface AvatarCrop { x: number; y: number; zoom: number }
export const maxAvatarZoom = 4;

export function initialAvatarCrop({ width, height }: ImageSize): AvatarCrop {
  return { x: width / 2, y: height / 2, zoom: 1 };
}

export function avatarCropRect(image: ImageSize, crop: AvatarCrop) {
  const size = Math.min(image.width, image.height) / crop.zoom;
  return { x: crop.x - size / 2, y: crop.y - size / 2, size };
}

export function boundAvatarCrop(image: ImageSize, crop: AvatarCrop): AvatarCrop {
  const zoom = Math.max(1, Math.min(maxAvatarZoom, crop.zoom));
  const half = Math.min(image.width, image.height) / zoom / 2;
  return { zoom, x: Math.max(half, Math.min(image.width - half, crop.x)),
    y: Math.max(half, Math.min(image.height - half, crop.y)) };
}

export async function renderAvatarCrop(image: HTMLImageElement, crop: AvatarCrop, background: string): Promise<Blob> {
  const canvas = document.createElement('canvas');
  const output = 256;
  canvas.width = canvas.height = output;
  try {
    const context = canvas.getContext('2d');
    if (!context) throw new Error('Could not prepare the crop. Try a different browser.');
    const { x, y, size } = avatarCropRect({ width: image.naturalWidth, height: image.naturalHeight }, crop);
    context.fillStyle = background;
    context.fillRect(0, 0, output, output);
    context.imageSmoothingQuality = 'high';
    context.drawImage(image, x, y, size, size, 0, 0, output, output);
    return await new Promise<Blob>((resolve, reject) => canvas.toBlob(blob => {
      if (blob) resolve(blob);
      else reject(new Error('Could not prepare the crop. Try a different image.'));
    }, 'image/webp', 0.94));
  } finally { canvas.width = canvas.height = 0; }
}
