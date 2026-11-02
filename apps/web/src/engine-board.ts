import { createPositionFromFen } from '@chess/domain';
import type { Square } from './board-model';
import type { EngineState } from './engine-analysis';

export interface EngineBestMove { gameId: string; fen: string; from: Square; to: Square }

/** Interactive output only; never read the full-game report or annotation storage. */
export function engineBestMove(state: EngineState, fen: string, gameId: string, enabled: boolean): EngineBestMove | null {
  if (!enabled || state.kind !== 'done' && state.kind !== 'searching'
    || state.kind === 'searching' && state.fen !== fen) return null;
  const evaluation = state.evaluation?.fen === fen ? state.evaluation : null;
  const lines = state.kind === 'searching' ? state.lines ?? evaluation?.lines : evaluation?.lines;
  const first = lines?.find(line => line.rank === 1);
  const uci = lines ? first?.variation[0] ?? (state.kind === 'done' && first ? evaluation?.bestMove : null)
    : evaluation?.variation[0] ?? evaluation?.bestMove;
  if (!uci || !/^[a-h][1-8][a-h][1-8][qrbn]?$/.test(uci)) return null;
  try {
    const position = createPositionFromFen(fen);
    const moved = position.submitMove({ side: position.getPosition().sideToMove, from: uci.slice(0, 2), to: uci.slice(2, 4),
      ...(uci[4] ? { promotion: uci[4] as 'q' | 'r' | 'b' | 'n' } : {}) });
    return moved.accepted ? { gameId, fen, from: moved.move.from as Square, to: moved.move.to as Square } : null;
  } catch { return null; }
}
