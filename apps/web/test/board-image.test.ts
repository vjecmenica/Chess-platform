import { expect, it } from 'vitest';
import { textureCrop } from '../src/board-image';

it('crops the same texture tiles as CSS at either end of the atlas and between them', () => {
  expect(textureCrop(2048, 8, 0)).toEqual([0, 256]);
  expect(textureCrop(2048, 8, 1)).toEqual([1792, 256]);
  expect(textureCrop(2048, 8, 3 / 7)).toEqual([768, 256]);
  expect(textureCrop(1200, 4, 2 / 3)).toEqual([600, 300]);
});
