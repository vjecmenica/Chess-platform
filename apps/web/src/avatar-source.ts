export const avatarSourceMaxBytes = 10 * 1024 * 1024;
const maxEdge = 8192;
const maxPixels = 24_000_000;
export const avatarSourceLimit = 'Choose an image up to 8192 pixels per side and 24 megapixels.';
export const avatarSourceFormats = 'Choose a still JPEG, PNG or WebP image.';
const unreadable = 'This image could not be opened. Try a different file.';

export interface ImageSize { width: number; height: number }

export function checkAvatarDimensions({ width, height }: ImageSize): void {
  if (width <= 0 || height <= 0) throw new Error(unreadable);
  if (width > maxEdge || height > maxEdge || width * height > maxPixels) throw new Error(avatarSourceLimit);
}

function markerAt(bytes: Uint8Array, offset: number, marker: string): boolean {
  for (let index = 0; index < marker.length; index++) if (bytes[offset + index] !== marker.charCodeAt(index)) return false;
  return true;
}

function jpegSize(bytes: Uint8Array, view: DataView): ImageSize | undefined {
  // Both baseline and progressive JPEG put their dimensions in Start of Frame.
  let offset = 2;
  while (offset + 4 <= bytes.length && bytes[offset] === 0xff) {
    while (bytes[offset] === 0xff) offset++;
    const marker = bytes[offset++];
    if (marker === 0x01) continue;
    if (marker === undefined || marker === 0xda || marker === 0xd9 || offset + 2 > bytes.length) break;
    const length = view.getUint16(offset);
    if (length < 2 || offset + length > bytes.length) break;
    if (marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc) {
      if (length >= 8) return { width: view.getUint16(offset + 5), height: view.getUint16(offset + 3) };
      break;
    }
    offset += length;
  }
}

function pngSize(bytes: Uint8Array, view: DataView): ImageSize | undefined {
  if (bytes.length < 33 || view.getUint32(8) !== 13 || !markerAt(bytes, 12, 'IHDR')) return;
  for (let offset = 33; offset + 12 <= bytes.length;) {
    const length = view.getUint32(offset);
    if (offset + 12 + length > bytes.length) return;
    if (markerAt(bytes, offset + 4, 'acTL')) throw new Error(avatarSourceFormats);
    if (markerAt(bytes, offset + 4, 'IDAT')) return { width: view.getUint32(16), height: view.getUint32(20) };
    offset += 12 + length;
  }
}

function webpSize(bytes: Uint8Array, view: DataView): ImageSize | undefined {
  const end = view.getUint32(4, true) + 8;
  if (end > bytes.length) return;
  let canvas: ImageSize | undefined;
  let frame: ImageSize | undefined;
  for (let offset = 12; offset + 8 <= end;) {
    const length = view.getUint32(offset + 4, true);
    const data = offset + 8;
    if (data + length > end) return;
    if (markerAt(bytes, offset, 'VP8X') && length === 10) {
      if (canvas) return;
      if (bytes[data]! & 2) throw new Error(avatarSourceFormats);
      canvas = { width: (view.getUint32(data + 4, true) & 0xffffff) + 1,
        height: view.getUint16(data + 7, true) + bytes[data + 9]! * 65536 + 1 };
    } else if (markerAt(bytes, offset, 'VP8 ') && length >= 10 && markerAt(bytes, data + 3, '\x9d\x01\x2a')) {
      if (frame) return;
      frame = { width: view.getUint16(data + 6, true) & 0x3fff, height: view.getUint16(data + 8, true) & 0x3fff };
    } else if (markerAt(bytes, offset, 'VP8L') && length >= 5 && bytes[data] === 0x2f) {
      if (frame) return;
      const dimensions = view.getUint32(data + 1, true);
      frame = { width: (dimensions & 0x3fff) + 1, height: ((dimensions >>> 14) & 0x3fff) + 1 };
    } else if (markerAt(bytes, offset, 'ANIM') || markerAt(bytes, offset, 'ANMF')) throw new Error(avatarSourceFormats);
    offset = data + length + (length % 2);
  }
  if (canvas && frame && (canvas.width !== frame.width || canvas.height !== frame.height)) return;
  return frame;
}

// Read dimensions from the container before admitting a file to the browser image decoder.
export function inspectAvatarSource(buffer: ArrayBuffer): ImageSize & { mime: string } {
  if (buffer.byteLength > avatarSourceMaxBytes) throw new Error('Choose an original image no larger than 10 MB.');
  if (buffer.byteLength === 0) throw new Error(unreadable);
  const view = new DataView(buffer);
  const bytes = new Uint8Array(buffer);
  const format = markerAt(bytes, 0, '\xff\xd8\xff') ? 'jpeg'
    : markerAt(bytes, 0, '\x89PNG\r\n\x1a\n') ? 'png'
    : markerAt(bytes, 0, 'RIFF') && markerAt(bytes, 8, 'WEBP') ? 'webp' : null;
  if (!format) throw new Error(avatarSourceFormats);
  const size = format === 'jpeg' ? jpegSize(bytes, view) : format === 'png' ? pngSize(bytes, view) : webpSize(bytes, view);
  if (!size) throw new Error(unreadable);
  checkAvatarDimensions(size);
  return { ...size, mime: `image/${format}` };
}
