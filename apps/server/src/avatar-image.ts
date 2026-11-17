import sharp from 'sharp';
import { avatarUploadMaxBytes } from '@chess/contracts';

const pngSignature = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
const maxDimension = 4096;

export async function normalizeAvatar(input: Buffer): Promise<Buffer | null> {
  if (input.length > avatarUploadMaxBytes) return null;
  const format = input[0] === 0xff && input[1] === 0xd8 && input[2] === 0xff ? 'jpeg'
    : input.subarray(0, 8).equals(pngSignature) ? 'png'
    : input.toString('ascii', 0, 4) === 'RIFF' && input.toString('ascii', 8, 12) === 'WEBP' ? 'webp' : null;
  if (!format) return null;
  try {
    const image = sharp(input, { failOn: 'warning', limitInputPixels: maxDimension ** 2 });
    const metadata = await image.metadata();
    if (metadata.format !== format || !metadata.width || !metadata.height
      || metadata.width > maxDimension || metadata.height > maxDimension || (metadata.pages ?? 1) !== 1) return null;
    return await image.autoOrient().resize(256, 256, { fit: 'cover' }).webp({ quality: 82 })
      .timeout({ seconds: 5 }).toBuffer();
  } catch { return null; }
}
