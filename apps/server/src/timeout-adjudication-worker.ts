import { parentPort, workerData } from 'node:worker_threads';
import { createGame, findTimeoutMateWitness } from '@chess/domain';
import type { MoveRequest, Side } from '@chess/domain';

interface Work {
  history: readonly Omit<MoveRequest, 'side'>[];
  flaggedSide: Side;
  deadlineMs: number;
  maxDepth: number;
  maxNodes: number;
}

const work = workerData as Work;
const game = createGame('casual_concession');
for (const move of work.history) {
  const side = game.getState().position.sideToMove;
  const played = game.submitMove({ side, ...move });
  if (!played.accepted) throw new Error('A saved move could not be replayed in the timeout worker.');
}
const flagged = game.flagTimeout({ flaggedSide: work.flaggedSide, deadlineMs: work.deadlineMs });
if (!flagged.accepted || flagged.game.status !== 'pending_adjudication') {
  throw new Error('The timeout worker did not reconstruct a pending flag.');
}
const result = findTimeoutMateWitness(game, { maxDepth: work.maxDepth, maxNodes: work.maxNodes });
parentPort?.postMessage(result);
