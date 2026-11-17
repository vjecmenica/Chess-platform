import sharp from 'sharp';
import { afterEach, expect, it, vi } from 'vitest';
import { normalizeAvatar } from '../src/avatar-image.js';
import { avatarStorageFromEnvironment } from '../src/avatar-storage.js';

const source = (width = 420, height = 180) => sharp({ create: { width, height, channels: 3, background: '#735ca3' } });

it.each(['jpeg', 'png', 'webp'] as const)('decodes and normalizes a %s to square WebP without metadata', async format => {
  const input = await source().withMetadata({ orientation: 6 }).toFormat(format).toBuffer();
  const result = await normalizeAvatar(input);
  expect(result).not.toBeNull();
  const metadata = await sharp(result!).metadata();
  expect(metadata).toMatchObject({ width: 256, height: 256, format: 'webp' });
  expect(metadata.exif).toBeUndefined();
  expect(metadata.icc).toBeUndefined();
});

it('rejects signatures alone, corrupt encodings, unsupported formats and excessive dimensions', async () => {
  const jpeg = await source().jpeg().toBuffer();
  for (const invalid of [Buffer.from('<svg/>'), Buffer.from('RIFF\0\0\0\0WEBP'), jpeg.subarray(0, jpeg.length - 32),
    await source().gif().toBuffer(), await source(4097, 1).png().toBuffer()]) {
    expect(await normalizeAvatar(invalid)).toBeNull();
  }
});

afterEach(() => vi.unstubAllGlobals());

it('uses signed, bounded S3 requests against the configured private bucket', async () => {
  const calls: Request[] = [];
  vi.stubGlobal('fetch', async (request: Request) => {
    calls.push(request);
    return request.method === 'GET' ? new Response(new Uint8Array([1, 2])) : new Response(null, { status: 204 });
  });
  const store = avatarStorageFromEnvironment({ AVATAR_S3_ENDPOINT: 'https://storage.example.test', AVATAR_S3_BUCKET: 'test-avatars',
    AVATAR_S3_ACCESS_KEY_ID: 'fake-id', AVATAR_S3_SECRET_ACCESS_KEY: 'fake-secret' });
  await store.put('test-key', Buffer.from([1, 2]));
  expect(await store.read('test-key')).toEqual(Buffer.from([1, 2]));
  await store.remove('test-key');
  expect(calls.map(call => call.method)).toEqual(['PUT', 'GET', 'DELETE']);
  for (const call of calls) {
    expect(call.url).toBe('https://storage.example.test/test-avatars/avatars/test-key.webp');
    expect(call.headers.get('Authorization')).toMatch(/^AWS4-HMAC-SHA256 Credential=fake-id\/.+\/auto\/s3\/aws4_request,/);
    expect(call.redirect).toBe('error');
  }
  expect(await calls[0]!.arrayBuffer()).toEqual(new Uint8Array([1, 2]).buffer);
  expect(() => avatarStorageFromEnvironment({ AVATAR_S3_BUCKET: 'test-avatars' })).toThrow('four AVATAR_S3');
});
