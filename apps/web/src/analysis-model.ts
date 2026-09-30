import { createPositionFromFen } from '@chess/domain';
import type { MoveRecord, MoveResult, Promotion, Side } from '@chess/domain';
import type { GameReadResponse } from '@chess/contracts';
import { replayFen, replayPly } from './board-model';

export interface AnalysisLine {
  readonly basePly: number;
  readonly baseFen: string;
  readonly moves: readonly MoveRecord[];
  readonly cursor: number;
}

export function startAnalysis(game: GameReadResponse, ply: number): AnalysisLine {
  if (game.status !== 'finished') throw new Error('Analysis starts from a finished game.');
  const basePly = replayPly(ply, game.history.length);
  return { basePly, baseFen: replayFen(game, basePly), moves: [], cursor: 0 };
}

export function analysisFen(line: AnalysisLine): string {
  return line.cursor === 0 ? line.baseFen : line.moves[line.cursor - 1]!.afterFen;
}

export function analysisSideToMove(line: AnalysisLine): Side {
  return createPositionFromFen(analysisFen(line)).getPosition().sideToMove;
}

export function navigateAnalysis(line: AnalysisLine, cursor: number): AnalysisLine {
  return { ...line, cursor: replayPly(cursor, line.moves.length) };
}

export function playAnalysisMove(line: AnalysisLine, from: string, to: string,
  promotion?: Promotion): { readonly accepted: true; readonly line: AnalysisLine;
    readonly move: MoveRecord } | { readonly accepted: false;
      readonly result: Extract<MoveResult, { accepted: false }> } {
  const position = createPositionFromFen(analysisFen(line));
  const result = position.submitMove({ side: position.getPosition().sideToMove, from, to,
    ...(promotion === undefined ? {} : { promotion }) });
  if (!result.accepted) return { accepted: false, result };
  const move = { ...result.move, ply: line.cursor + 1 };
  return { accepted: true, move,
    line: { ...line, moves: [...line.moves.slice(0, line.cursor), move], cursor: line.cursor + 1 } };
}
