import type { GameReadResponse } from '@chess/contracts';
import { replayFen } from './board-model';
import { canExportGame } from './pgn-export';

export const gifMaxPlies = 400;
export const gifSize = 256;
export const gifMaxBytes = 16 * 1024 * 1024;
export const gifSpeeds = { Slow: 750, Normal: 450, Fast: 250 } as const;

export function gifFrames(game: GameReadResponse) {
  if (!canExportGame(game)) throw new Error('GIF export is unavailable for this game.');
  if (game.history.length > gifMaxPlies) throw new Error(`GIF export supports up to ${gifMaxPlies} half-moves.`);
  return [{ fen: replayFen(game, 0), from: null, to: null },
    ...game.history.map(({ afterFen: fen, from, to }) => ({ fen, from, to }))];
}
