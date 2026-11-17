import { readFileSync } from 'node:fs';
import { expect, it } from 'vitest';
import { avatarCropRect, boundAvatarCrop, initialAvatarCrop } from '../src/avatar-crop';
import { avatarSourceLimit, inspectAvatarSource } from '../src/avatar-source';

it.each([[1200, 1600, 0, 200], [1600, 1200, 200, 0], [1200, 1200, 0, 0]])(
  'centers a square over a %d × %d image', (width, height, x, y) => {
    const image = { width, height };
    expect(avatarCropRect(image, initialAvatarCrop(image))).toEqual({ x, y, size: 1200 });
  });

it('keeps the visible source square inside the image when panning and zooming', () => {
  const image = { width: 1200, height: 1600 };
  expect(avatarCropRect(image, boundAvatarCrop(image, { x: -100, y: 9999, zoom: 8 }))).toEqual({ x: 0, y: 1300, size: 300 });
  expect(avatarCropRect(image, boundAvatarCrop(image, { x: 1150, y: 200, zoom: .5 }))).toEqual({ x: 0, y: 0, size: 1200 });
  expect(avatarCropRect(image, boundAvatarCrop(image, { x: 600, y: 800, zoom: 2 }))).toEqual({ x: 300, y: 500, size: 600 });
});

function jpegHeader(marker: number, width: number, height: number): ArrayBuffer {
  const bytes = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0, 4, 1, 2, 0xff, marker, 0, 8,
    8, height >>> 8, height & 255, width >>> 8, width & 255, 3, 0xff, 0xd9]);
  return bytes.buffer;
}

it('reads baseline and progressive dimensions before decoding and rejects excessive dimensions', () => {
  for (const marker of [0xc0, 0xc2])
    expect(inspectAvatarSource(jpegHeader(marker, 1200, 1600))).toEqual({ width: 1200, height: 1600, mime: 'image/jpeg' });
  expect(() => inspectAvatarSource(jpegHeader(0xc2, 8000, 8000))).toThrow(avatarSourceLimit);
  expect(() => inspectAvatarSource(jpegHeader(0xc0, 100, 9000))).toThrow(avatarSourceLimit);
  expect(() => inspectAvatarSource(jpegHeader(0xc2, 1200, 1600).slice(0, 13))).toThrow('could not be opened');
  expect(() => inspectAvatarSource(new ArrayBuffer(10 * 1024 * 1024 + 1))).toThrow('10 MB');
  expect(() => inspectAvatarSource(new Uint8Array([0x47, 0x49, 0x46]).buffer)).toThrow('still JPEG');
});

it('reads PNG dimensions and rejects animated PNG before opening the decoder', () => {
  const bytes = new Uint8Array(45);
  bytes.set([137, 80, 78, 71, 13, 10, 26, 10]);
  const data = new DataView(bytes.buffer);
  data.setUint32(8, 13);
  bytes.set(new TextEncoder().encode('IHDR'), 12);
  data.setUint32(16, 640);
  data.setUint32(20, 480);
  bytes.set(new TextEncoder().encode('IDAT'), 37);
  expect(inspectAvatarSource(bytes.buffer)).toEqual({ width: 640, height: 480, mime: 'image/png' });
  bytes.set(new TextEncoder().encode('acTL'), 37);
  expect(() => inspectAvatarSource(bytes.buffer)).toThrow('still JPEG');
});

it('reads lossless WebP dimensions and rejects contradictory duplicate frame headers', () => {
  const bytes = new Uint8Array(26);
  bytes.set(new TextEncoder().encode('RIFF    WEBPVP8L'));
  const data = new DataView(bytes.buffer);
  data.setUint32(4, 18, true);
  data.setUint32(16, 5, true);
  bytes[20] = 0x2f;
  data.setUint32(21, 639 | (479 << 14), true);
  expect(inspectAvatarSource(bytes.buffer)).toEqual({ width: 640, height: 480, mime: 'image/webp' });
  const duplicate = new Uint8Array(40);
  duplicate.set(bytes);
  duplicate.set(bytes.subarray(12), 26);
  new DataView(duplicate.buffer).setUint32(4, duplicate.length - 8, true);
  expect(() => inspectAvatarSource(duplicate.buffer)).toThrow('could not be opened');
});

it('keeps the mounted settings during a background identity refresh', () => {
  const source = readFileSync(new URL('../src/MyGames.tsx', import.meta.url), 'utf8');
  const load = source.slice(source.indexOf('async function load('), source.indexOf('async function action('));
  expect(load.slice(0, load.indexOf('try {'))).not.toContain('setDetails(null)');
  expect(source).toContain('<AccountSettings key={details.account.id}');
  expect(source).toContain('if (!changingAvatar.current) void load(undefined, true)');
});
