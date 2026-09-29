import { Chess } from 'chess.js';
import type { ChessGame } from './game.js';
import type { MoveRequest, Promotion, Side } from './position.js';
import { STANDARD_STARTING_FEN } from './position.js';

export type MateLine = readonly Omit<MoveRequest, 'side'>[];
export interface MateSearchBudget {
  readonly maxDepth?: number;
  readonly maxNodes?: number;
}

export type MateSearchResult =
  | { readonly status: 'found'; readonly mateLine: MateLine; readonly nodesVisited: number }
  | { readonly status: 'unresolved'; readonly reason: 'not_pending' | 'depth_exhausted' | 'budget_exhausted';
      readonly nodesVisited: number };

const openingWitnesses: Readonly<Record<Side, readonly string[]>> = {
  black: ['f2f3', 'e7e5', 'g2g4', 'd8h4'],
  white: ['e2e4', 'e7e5', 'f1c4', 'b8c6', 'd1h5', 'g8f6', 'h5f7'],
};

function coordinates(uci: string): Omit<MoveRequest, 'side'> {
  return { from: uci.slice(0, 2), to: uci.slice(2, 4) };
}

function openingSuffix(fen: string, winner: Side): MateLine | null {
  const board = new Chess(STANDARD_STARTING_FEN);
  const line = openingWitnesses[winner];
  for (let index = 0; index < line.length; index++) {
    if (board.fen() === fen) return line.slice(index).map(coordinates);
    board.move(coordinates(line[index]!));
  }
  return null;
}

function moveScore(side: Side, winner: Side, move: { san: string; piece: string; from: string;
  captured?: string }): number {
  if (side === winner) return (move.san.includes('#') ? 100 : 0)
    + (move.san.includes('+') ? 40 : 0) + (move.captured ? 10 : 0);
  return move.piece === 'p' && 'fgh'.includes(move.from[0]!) ? 20 : 0;
}

/** Cooperative search: both sides may choose moves that help the nominated winner mate. */
function findMateWitness(game: ChessGame, kind: 'resignation' | 'timeout',
  budget: MateSearchBudget = {}): MateSearchResult {
  const maxDepth = budget.maxDepth ?? 7;
  const maxNodes = budget.maxNodes ?? 5000;
  if (!Number.isSafeInteger(maxDepth) || maxDepth < 0 || maxDepth > 8
    || !Number.isSafeInteger(maxNodes) || maxNodes < 0 || maxNodes > 20000) {
    throw new RangeError('Use maxDepth 0–8 and maxNodes 0–20000.');
  }
  const state = game.getState();
  if (state.status !== 'pending_adjudication' || state.pending.kind !== kind) {
    return { status: 'unresolved', reason: 'not_pending', nodesVisited: 0 };
  }
  const winner: Side = (state.pending.kind === 'resignation' ? state.pending.resigningSide
    : state.pending.flaggedSide) === 'white' ? 'black' : 'white';
  const verify = kind === 'resignation'
    ? (line: MateLine) => game.verifyResignationMateLine(line)
    : (line: MateLine) => game.verifyTimeoutMateLine(line);
  let nodesVisited = 0;

  const seed = openingSuffix(state.position.fen, winner);
  if (seed && seed.length <= maxDepth && seed.length <= maxNodes && verify(seed)) {
    return { status: 'found', mateLine: seed, nodesVisited: seed.length };
  }

  let budgetExhausted = false;
  function search(fen: string, depth: number, line: MateLine): MateLine | null {
    if (nodesVisited >= maxNodes) {
      budgetExhausted = true;
      return null;
    }
    nodesVisited++;
    const board = new Chess(fen);
    const side: Side = board.turn() === 'w' ? 'white' : 'black';
    const moves = board.moves({ verbose: true }).sort((a, b) => {
      const scoreDifference = moveScore(side, winner, b) - moveScore(side, winner, a);
      if (scoreDifference !== 0) return scoreDifference;
      const first = `${a.from}${a.to}${a.promotion ?? ''}`;
      const second = `${b.from}${b.to}${b.promotion ?? ''}`;
      return first < second ? -1 : first > second ? 1 : 0;
    });
    for (const move of moves) {
      const child = new Chess(move.after);
      const candidate = [...line, { from: move.from, to: move.to,
        ...(move.promotion === undefined ? {} : { promotion: move.promotion as Promotion }) }];
      if (child.isCheckmate()) {
        if (side === winner && verify(candidate)) return candidate;
      } else if (!child.isStalemate() && depth > 1) {
        const found = search(move.after, depth - 1, candidate);
        if (found) return found;
      }
      if (budgetExhausted) return null;
    }
    return null;
  }

  for (let depth = 1; depth <= maxDepth; depth++) {
    const found = search(state.position.fen, depth, []);
    if (found) return { status: 'found', mateLine: found, nodesVisited };
    if (budgetExhausted) break;
  }
  return { status: 'unresolved', reason: budgetExhausted ? 'budget_exhausted' : 'depth_exhausted',
    nodesVisited };
}

export function findResignationMateWitness(game: ChessGame, budget?: MateSearchBudget): MateSearchResult {
  return findMateWitness(game, 'resignation', budget);
}

export function findTimeoutMateWitness(game: ChessGame, budget?: MateSearchBudget): MateSearchResult {
  return findMateWitness(game, 'timeout', budget);
}
