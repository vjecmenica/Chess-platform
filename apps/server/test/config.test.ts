import { describe, expect, it } from 'vitest';
import { databaseUrl, readConfig } from '../src/config.js';

const DATABASE_URL = 'postgresql://localhost:5432/chess_test';

describe('startup configuration', () => {
  it('requires a database URL and points to the root example file', () => {
    expect(() => readConfig({})).toThrow(/DATABASE_URL is required.*\.env.example/);
    expect(() => readConfig({ DATABASE_URL: '  ' })).toThrow(/required/);
  });

  it.each(['https://example.com/db', 'postgresql://localhost', 'not-a-url'])('rejects %s without echoing credentials', value => {
    expect(() => databaseUrl(value)).toThrow('DATABASE_URL must be a PostgreSQL URL');
  });

  it.each(['0', '65536', '1.5', '', '3001garbage'])('rejects invalid PORT %s', PORT => {
    expect(() => readConfig({ DATABASE_URL, PORT })).toThrow('PORT must be an integer');
  });

  it('binds to loopback by default and accepts an explicit port', () => {
    expect(readConfig({ DATABASE_URL })).toEqual({ connectionString: DATABASE_URL, host: '127.0.0.1', port: 3001 });
    expect(readConfig({ DATABASE_URL, PORT: '4001' }).port).toBe(4001);
  });
});
