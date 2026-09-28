import { expect, it, vi } from 'vitest';
import { buildApp } from '../src/app.js';

it('keeps liveness separate from database readiness', async () => {
  const database = vi.fn().mockResolvedValue(undefined);
  const app = buildApp(database);
  try {
    const live = await app.inject('/health');
    expect(live.statusCode).toBe(200);
    expect(live.json()).toEqual({ status: 'ok' });
    expect(database).not.toHaveBeenCalled();
    const ready = await app.inject('/health/ready');
    expect(ready.statusCode).toBe(200);
    expect(ready.json()).toEqual({ status: 'ok', database: 'connected' });
    expect(ready.headers['cache-control']).toBe('no-store');
  } finally { await app.close(); }
});

it('returns 503 without leaking database errors and recovers on the next check', async () => {
  const database = vi.fn()
    .mockRejectedValueOnce(new Error('postgresql://secret:password@private-host/database'))
    .mockResolvedValueOnce(undefined);
  const app = buildApp(database);
  try {
    const failed = await app.inject('/health/ready');
    expect(failed.statusCode).toBe(503);
    expect(failed.json()).toEqual({ status: 'error', database: 'unavailable' });
    expect(failed.body).not.toContain('password');
    expect((await app.inject('/health/ready')).statusCode).toBe(200);
  } finally { await app.close(); }
});
