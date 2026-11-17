import { Worker } from 'node:worker_threads';
import type pg from 'pg';
import type { MateSearchResult } from '@chess/domain';
import type { GameService } from './game-service.js';
import { claimAdjudication, deferAdjudication, type AdjudicationPosition } from './rated-adjudication-store.js';

interface SearchOutcome { readonly result: MateSearchResult; readonly searchMs: number }
type Search = (position: AdjudicationPosition) => Promise<SearchOutcome>;

const searchTimeoutMs = 8_000;
class SearchDeadlineExceeded extends Error {}

export async function searchInWorker(position: AdjudicationPosition): Promise<SearchOutcome> {
  const source = import.meta.url.endsWith('.ts');
  const worker = new Worker(new URL(source ? './mate-witness-worker.ts' : './mate-witness-worker.js', import.meta.url), {
    workerData: position,
    execArgv: source ? ['--experimental-strip-types'] : [],
    resourceLimits: { maxOldGenerationSizeMb: 96, maxYoungGenerationSizeMb: 16 },
  });
  try {
    return await new Promise<SearchOutcome>((resolve, reject) => {
      const timeout = setTimeout(() => reject(new SearchDeadlineExceeded('Mate witness worker timed out.')), searchTimeoutMs);
      worker.once('message', (message: SearchOutcome) => { clearTimeout(timeout); resolve(message); });
      worker.once('error', error => { clearTimeout(timeout); reject(error); });
      worker.once('exit', () => { clearTimeout(timeout); reject(new Error('Mate witness worker exited.')); });
    });
  } finally {
    await worker.terminate();
  }
}

export function createRatedAdjudicationProcessor(pool: pg.Pool, service: GameService, search: Search = searchInWorker) {
  let running: Promise<void> | null = null;
  let stopped = false;

  async function processNext(): Promise<void> {
    const claim = await claimAdjudication(pool);
    if (!claim) return;
    try {
      const position = await service.adjudicationPosition(claim.game_id, claim.token);
      if (!position) return;
      // The position snapshot transaction has released its locks and connection before any search.
      const { result, searchMs } = await search(position);
      const metrics = { nodesVisited: result.nodesVisited, searchMs };
      if (result.status === 'found') {
        await service.finalizeAdjudication(claim.game_id, result.mateLine, { leaseToken: claim.token, metrics });
      } else if (result.reason === 'not_pending') {
        throw new Error('Adjudication worker did not reconstruct a pending decision.');
      } else {
        await deferAdjudication(pool, claim, result.reason, metrics);
      }
    } catch (error) {
      if (error instanceof SearchDeadlineExceeded) {
        await deferAdjudication(pool, claim, 'wall_time_exhausted', { nodesVisited: null, searchMs: searchTimeoutMs });
        return;
      }
      await deferAdjudication(pool, claim, 'processing_failed');
      throw new Error(`Rated adjudication failed for game ${claim.game_id}.`, { cause: error });
    }
  }

  return {
    poll(): Promise<void> {
      if (stopped || running) return Promise.resolve();
      return running = processNext().finally(() => { running = null; });
    },
    async stop(): Promise<void> {
      stopped = true;
      await running?.catch(() => undefined);
    },
  };
}
