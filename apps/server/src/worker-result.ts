import type { Worker } from 'node:worker_threads';
import type { MateSearchResult } from '@chess/domain';

export function waitForMateSearchResult(worker: Worker, timeoutMs = 30_000): Promise<MateSearchResult> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => finish(() => reject(new Error('Resignation witness search timed out.'))),
      timeoutMs);
    const finish = (outcome: () => void) => {
      clearTimeout(timer);
      worker.off('message', onMessage);
      worker.off('error', onError);
      worker.off('exit', onExit);
      outcome();
    };
    const onMessage = (result: unknown) => {
      // Node watch mode may send this control message before the worker's own result.
      if (typeof result === 'object' && result !== null && 'watch:import' in result) return;
      finish(() => {
        if (!isMateSearchResult(result)) {
          reject(new Error('Resignation worker returned an invalid search result.'));
        } else resolve(result);
      });
    };
    const onError = (error: Error) => finish(() => reject(error));
    const onExit = (code: number) => finish(() => reject(new Error(`Resignation worker exited (${code}).`)));
    worker.on('message', onMessage);
    worker.once('error', onError);
    worker.once('exit', onExit);
  });
}

function isMateSearchResult(value: unknown): value is MateSearchResult {
  if (typeof value !== 'object' || value === null) return false;
  const result = value as Record<string, unknown>;
  if (!Number.isSafeInteger(result.nodesVisited) || Number(result.nodesVisited) < 0) return false;
  if (result.status === 'unresolved') {
    return typeof result.reason === 'string'
      && ['not_pending', 'depth_exhausted', 'budget_exhausted'].includes(result.reason);
  }
  if (result.status !== 'found' || !Array.isArray(result.mateLine)) return false;
  return result.mateLine.every(move => typeof move === 'object' && move !== null
    && /^[a-h][1-8]$/.test(move.from) && /^[a-h][1-8]$/.test(move.to)
    && (move.promotion === undefined || ['q', 'r', 'b', 'n'].includes(move.promotion)));
}
