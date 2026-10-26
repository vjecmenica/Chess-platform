import { expect, it } from 'vitest';
import { parseGameCursor } from '../src/account-games.js';

it('preserves microsecond cursor precision and rejects malformed or normalized dates', () => {
  const cursor = { createdAt: '2026-10-26T10:00:00.000999Z', id: '12345678-1234-1234-1234-123456789abc' };
  const encode = (value: unknown) => Buffer.from(JSON.stringify(value)).toString('base64url');
  expect(parseGameCursor(undefined)).toBeNull();
  expect(parseGameCursor(encode(cursor))).toEqual(cursor);
  for (const value of [null, {}, { ...cursor, id: 'invalid' }, { ...cursor, createdAt: '2026-02-30T10:00:00.000999Z' },
    { ...cursor, createdAt: '0000-01-01T00:00:00.000000Z' }, { ...cursor, createdAt: '2026-10-26T10:00:00.000Z' }])
    expect(() => parseGameCursor(encode(value))).toThrow('invalid_game_cursor');
});
