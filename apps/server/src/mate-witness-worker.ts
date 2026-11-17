import { parentPort, workerData } from 'node:worker_threads';
import { createGameFromPosition, findResignationMateWitness, findTimeoutMateWitness } from '@chess/domain';
import type { AdjudicationPosition } from './rated-adjudication-store.js';

const { startingFen, moves, pending } = workerData as AdjudicationPosition;
const game = createGameFromPosition(startingFen, 'fide_proof_required', 'fide_proof_required');
for (const move of moves) {
  if (!game.submitMove(move).accepted) throw new Error('Saved moves cannot be replayed for adjudication.');
}
const event = pending.kind === 'resignation'
  ? game.resign({ side: pending.resigningSide }) : game.flagTimeout(pending);
if (!event.accepted || event.game.status !== 'pending_adjudication') {
  throw new Error('Saved event no longer reconstructs a pending decision.');
}

const start = performance.now();
const result = pending.kind === 'resignation' ? findResignationMateWitness(game) : findTimeoutMateWitness(game);
parentPort!.postMessage({ result, searchMs: Math.ceil(performance.now() - start) });
