import { mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { AwsClient } from 'aws4fetch';

export interface AvatarStorage {
  put(key: string, image: Buffer): Promise<void>;
  read(key: string): Promise<Buffer | null>;
  remove(key: string): Promise<void>;
}

export function localAvatarStorage(directory: string): AvatarStorage {
  const filename = (key: string) => join(directory, `${key}.webp`);
  return {
    async put(key, image) {
      await mkdir(directory, { recursive: true });
      await writeFile(filename(key), image, { flag: 'wx' });
    },
    async read(key) {
      try { return await readFile(filename(key)); }
      catch (error) {
        if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null;
        throw error;
      }
    },
    async remove(key) { await rm(filename(key), { force: true }); },
  };
}

export function avatarStorageFromEnvironment(env = process.env): AvatarStorage {
  const endpoint = env.AVATAR_S3_ENDPOINT;
  const bucket = env.AVATAR_S3_BUCKET;
  const accessKeyId = env.AVATAR_S3_ACCESS_KEY_ID;
  const secretAccessKey = env.AVATAR_S3_SECRET_ACCESS_KEY;
  const region = env.AVATAR_S3_REGION || 'auto';
  if (![endpoint, bucket, accessKeyId, secretAccessKey].some(Boolean)) {
    return localAvatarStorage(env.AVATAR_DIRECTORY || fileURLToPath(new URL('../../../.local/avatars', import.meta.url)));
  }
  if (!endpoint || !bucket || !accessKeyId || !secretAccessKey || !/^[a-z0-9][a-z0-9.-]{1,61}[a-z0-9]$/.test(bucket))
    throw new Error('Configure all four AVATAR_S3 settings with a valid bucket name.');
  let origin: string;
  try {
    const url = new URL(endpoint);
    if (url.protocol !== 'https:' || url.pathname !== '/' || url.username || url.password || url.search || url.hash) throw new Error();
    origin = url.origin;
  } catch { throw new Error('AVATAR_S3_ENDPOINT must be an HTTPS origin.'); }

  const client = new AwsClient({ service: 's3', region, accessKeyId, secretAccessKey, retries: 0 });
  async function request(method: 'PUT' | 'GET' | 'DELETE', key: string, image?: Buffer) {
    const response = await client.fetch(`${origin}/${bucket}/avatars/${key}.webp`, {
      method, signal: AbortSignal.timeout(8000), redirect: 'error',
      ...(image ? { body: new Uint8Array(image), headers: { 'Content-Type': 'image/webp' } } : {}),
    });
    if (method === 'GET' && response.ok) return Buffer.from(await response.arrayBuffer());
    await response.body?.cancel();
    if (!response.ok && !(response.status === 404 && method !== 'PUT'))
      throw new Error(`Avatar object storage returned HTTP ${response.status}.`);
    return null;
  }
  return {
    async put(key, image) { await request('PUT', key, image); },
    read: key => request('GET', key),
    async remove(key) { await request('DELETE', key); },
  };
}
