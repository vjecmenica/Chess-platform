import { EventEmitter } from 'node:events';
import type { Worker } from 'node:worker_threads';
import { describe, expect, it } from 'vitest';
import { waitForMateSearchResult } from '../src/worker-result.js';

describe('resignation worker messages', () => {
  it('waits past a Node watch control message for the verified search result', async () => {
    const messages = new EventEmitter();
    const result = waitForMateSearchResult(messages as Worker, 100);
    messages.emit('message', { 'watch:import': ['file:///tsx/loader.mjs'] });
    const witness = { status: 'found', mateLine: [{ from: 'f2', to: 'f3' }], nodesVisited: 1 };
    messages.emit('message', witness);
    expect(await result).toEqual(witness);
    expect(messages.listenerCount('message')).toBe(0);
  });

  it('rejects an unknown worker message instead of marking the game unresolved', async () => {
    const messages = new EventEmitter();
    const result = waitForMateSearchResult(messages as Worker, 100);
    messages.emit('message', { unexpected: true });
    await expect(result).rejects.toThrow('invalid search result');
  });
});
