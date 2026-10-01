import { parentPort, workerData } from 'node:worker_threads';
import { createGame, findResignationMateWitness } from '@chess/domain';

const game = createGame();
for (const move of workerData.history) {
  const played = game.submitMove({ side: move.side, from: move.from, to: move.to,
    ...(move.promotion === undefined ? {} : { promotion: move.promotion }) });
  if (!played.accepted) throw new Error('The saved game history cannot be replayed for adjudication.');
}
if (game.getState().position.fen !== workerData.fen) {
  throw new Error('The saved game position differs from its history.');
}
const resignation = game.resign({ side: workerData.resigningSide });
if (!resignation.accepted || game.getState().status !== 'pending_adjudication') {
  throw new Error('The resignation position is not awaiting a mating witness.');
}
parentPort.postMessage(findResignationMateWitness(game, workerData.budget));
