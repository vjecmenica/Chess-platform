import { expect, it } from 'vitest';
import { legalMoveNotations } from '../src/index.js';

it('maps only legal UCI moves to SAN, including castling, promotion and en passant', () => {
  const castle = legalMoveNotations('r3k2r/8/8/8/8/8/8/R3K2R w KQkq - 0 1');
  expect(castle.get('e1g1')).toBe('O-O');
  expect(castle.get('e1c1')).toBe('O-O-O');
  expect(castle.has('e1h1')).toBe(false);
  const promotion = legalMoveNotations('k7/4P3/8/8/8/8/8/7K w - - 0 1');
  expect(promotion.get('e7e8q')).toBe('e8=Q+');
  expect(promotion.get('e7e8n')).toBe('e8=N');
  expect(promotion.has('e7e8')).toBe(false);
  const ep = legalMoveNotations('4k3/8/8/3pP3/8/8/8/4K3 w - d6 0 1');
  expect(ep.get('e5d6')).toBe('exd6');
});
