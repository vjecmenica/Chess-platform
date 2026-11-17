import sharp from 'sharp';
import { avatarUploadMaxBytes } from '@chess/contracts';

const pngSignature = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
const maxDimension = 4096;

export async function normalizeAvatar(input: Buffer): Promise<
  { image: Buffer } | { error: 'invalid_avatar' | 'unsupported_avatar' | 'avatar_too_large' | 'avatar_dimensions' }
> {
  if (input.length > avatarUploadMaxBytes) return { error: 'avatar_too_large' };
  const format = input[0] === 0xff && input[1] === 0xd8 && input[2] === 0xff ? 'jpeg'
    : input.subarray(0, 8).equals(pngSignature) ? 'png'
    : input.toString('ascii', 0, 4) === 'RIFF' && input.toString('ascii', 8, 12) === 'WEBP' ? 'webp' : null;
  if (!format) return { error: 'unsupported_avatar' };
  try {
    const image = sharp(input, { failOn: 'warning', limitInputPixels: maxDimension ** 2 });
    const metadata = await image.metadata();
    if (metadata.format !== format || !metadata.width || !metadata.height) return { error: 'invalid_avatar' };
    if (metadata.width > maxDimension || metadata.height > maxDimension) return { error: 'avatar_dimensions' };
    if ((metadata.pages ?? 1) !== 1) return { error: 'unsupported_avatar' };
    return { image: await image.autoOrient().resize(256, 256, { fit: 'cover' }).webp({ quality: 82 })
      .timeout({ seconds: 5 }).toBuffer() };
  } catch (error) {
    if (error instanceof Error && error.message.includes('Input image exceeds pixel limit')) return { error: 'avatar_dimensions' };
    return { error: 'invalid_avatar' };
  }
}
