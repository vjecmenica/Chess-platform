import { Chess, type Square } from 'chess.js';
import { matingPossibility } from './mating.js';
import type { MatingPossibility } from './mating.js';

export type Side = 'white' | 'black';
export type Promotion = 'q' | 'r' | 'b' | 'n';

export interface MoveRequest {
  readonly side: Side;
  readonly from: string;
  readonly to: string;
  readonly promotion?: Promotion;
}

export interface PositionSnapshot {
  readonly fen: string;
  readonly sideToMove: Side;
}

export interface MoveRecord extends MoveRequest {
  readonly ply: number;
  readonly san: string;
  readonly uci: string;
  readonly beforeFen: string;
  readonly afterFen: string;
}

export type MoveRejection = 'invalid_input' | 'wrong_turn' | 'promotion_required' | 'illegal_move';

export type MoveResult =
  | { readonly accepted: true; readonly move: MoveRecord; readonly position: PositionSnapshot }
  | { readonly accepted: false; readonly reason: MoveRejection; readonly message: string };

export interface LegalDestination {
  readonly to: string;
  readonly capture: boolean;
}

export interface ChessPosition {
  getPosition(): PositionSnapshot;
  getHistory(): readonly MoveRecord[];
  getLegalDestinations(from: string): readonly LegalDestination[];
  submitMove(request: MoveRequest): MoveResult;
}

export const STANDARD_STARTING_FEN = 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1';

const messages: Record<MoveRejection, string> = {
  invalid_input: 'Use a valid side, squares a1–h8, and promotion q, r, b, or n when supplied.',
  wrong_turn: 'It is not this side’s turn.',
  promotion_required: 'Choose a queen, rook, bishop, or knight to complete this promotion.',
  illegal_move: 'This move is not legal in the current position.',
};

function reject(reason: MoveRejection): MoveResult {
  return { accepted: false, reason, message: messages[reason] };
}

export function createPosition(): ChessPosition {
  return createPositionAdapter().position;
}

export function createPositionFromFen(fen: string): ChessPosition {
  return createPositionAdapter(fen).position;
}

/** Accept a standalone position for analysis without creating or loading a game. */
export function parseAnalysisPosition(fen: string): PositionSnapshot | null {
  if (fen.length > 120 || fen.trim() !== fen
    || !/^[prnbqkPRNBQK1-8/]+ [wb] (?:-|K?Q?k?q?) (?:-|[a-h][36]) \d{1,7} [1-9]\d{0,6}$/.test(fen))
    return null;
  try {
    const chess = new Chess(fen);
    const [, , castling = '', enPassant = '-', halfmove] = fen.split(' ');
    const previousSide = chess.turn() === 'w' ? 'b' : 'w';
    const previousKing = chess.findPiece({ type: 'k', color: previousSide })[0]!;
    if (chess.isAttacked(previousKing, chess.turn())) return null;
    const pieces = chess.board().flat();
    for (const color of ['w', 'b'] as const) {
      if (chess.findPiece({ type: 'p', color }).length > 8
        || pieces.filter(piece => piece?.color === color).length > 16) return null;
    }
    for (const [right, king, rook, color] of [
      ['K', 'e1', 'h1', 'w'], ['Q', 'e1', 'a1', 'w'],
      ['k', 'e8', 'h8', 'b'], ['q', 'e8', 'a8', 'b'],
    ] as const) {
      if (castling.includes(right) && (chess.get(king)?.type !== 'k'
        || chess.get(king)?.color !== color || chess.get(rook)?.type !== 'r'
        || chess.get(rook)?.color !== color)) return null;
    }
    if (enPassant !== '-') {
      const file = enPassant.charAt(0);
      const pawn = chess.get(`${file}${previousSide === 'w' ? '4' : '5'}` as Square);
      const start = `${file}${previousSide === 'w' ? '2' : '7'}` as Square;
      if (pawn?.type !== 'p' || pawn.color !== previousSide || chess.get(start)
        || chess.get(enPassant as Square) || Number(halfmove) !== 0) return null;
    }
    return { fen: chess.fen(), sideToMove: chess.turn() === 'w' ? 'white' : 'black' };
  } catch { return null; }
}

// Internal adapter: only the game owner may inspect terminal board conditions.
export function createPositionAdapter(startingFen = STANDARD_STARTING_FEN) {
  const chess = new Chess(startingFen);
  const history: MoveRecord[] = [];
  let lockedPawnPosition: boolean | undefined;
  const getPosition = (): PositionSnapshot => ({
    fen: chess.fen(),
    sideToMove: chess.turn() === 'w' ? 'white' : 'black',
  });

  const proveNoMate = (side: Side): 'impossible' | 'unresolved' => {
    const pieces = chess.board().flatMap(row => row.flatMap(piece => piece ? [{
      side: piece.color === 'w' ? 'white' as const : 'black' as const,
      kind: piece.type, square: piece.square,
    }] : []));
    const material = matingPossibility(pieces, side);
    if (material === 'impossible') return material;
    if (pieces.every(piece => piece.kind === 'p' || piece.kind === 'k')) {
      lockedPawnPosition ??= proveLockedPawnPosition(chess.fen());
      if (lockedPawnPosition) return 'impossible';
    }
    return 'unresolved';
  };

  const position: ChessPosition = {
    getPosition,
    getHistory: () => history.map(move => ({ ...move })),
    getLegalDestinations(from) {
      if (typeof from !== 'string' || !/^[a-h][1-8]$/.test(from)) return [];
      const destinations = new Map<string, LegalDestination>();
      for (const move of chess.moves({ verbose: true })) {
        if (move.from !== from) continue;
        destinations.set(move.to, { to: move.to,
          capture: move.captured !== undefined || move.flags.includes('e') });
      }
      return Array.from(destinations.values());
    },
    submitMove(request) {
      if ((request.side !== 'white' && request.side !== 'black')
        || typeof request.from !== 'string' || !/^[a-h][1-8]$/.test(request.from)
        || typeof request.to !== 'string' || !/^[a-h][1-8]$/.test(request.to)
        || (request.promotion !== undefined && !['q', 'r', 'b', 'n'].includes(request.promotion))) {
        return reject('invalid_input');
      }
      if (request.side !== getPosition().sideToMove) return reject('wrong_turn');

      // Match a legal move before mutating state; never turn a library exception into a rejection.
      const candidates = chess.moves({ verbose: true })
        .filter(move => move.from === request.from && move.to === request.to);
      if (request.promotion === undefined && candidates.some(move => move.promotion !== undefined)) {
        return reject('promotion_required');
      }
      const candidate = candidates.find(move => move.promotion === request.promotion);
      if (!candidate) return reject('illegal_move');

      const move = chess.move(candidate);
      lockedPawnPosition = undefined;
      const record: MoveRecord = {
        side: request.side,
        from: move.from,
        to: move.to,
        ...(request.promotion === undefined ? {} : { promotion: request.promotion }),
        ply: history.length + 1,
        san: move.san,
        uci: `${move.from}${move.to}${request.promotion ?? ''}`,
        beforeFen: move.before,
        afterFen: move.after,
      };
      history.push(record);
      return { accepted: true, move: { ...record }, position: getPosition() };
    },
  };
  return {
    position,
    // chess.js normalizes en passant to a target with an actually legal capture.
    repetitionKey: () => chess.fen().split(' ').slice(0, 4).join(' '),
    reversiblePlies: () => Number(chess.fen().split(' ')[4]),
    proveNoMate,
    matingPossibility: (side: Side): MatingPossibility => {
      const negative = proveNoMate(side);
      if (negative === 'impossible') return negative;
      // An actual legal mate on the next move proves possibility, even with
      // material that cannot force mate. Absence of one proves nothing.
      if (getPosition().sideToMove === side && chess.moves({ verbose: true })
        .some(move => new Chess(move.after).isCheckmate())) return 'possible';
      return 'unresolved';
    },
    previewMove: (request: MoveRequest) => createPositionAdapter(chess.fen()).position.submitMove(request),
    isCheckmate: () => chess.isCheckmate(),
    isStalemate: () => chess.isStalemate(),
  };
}

// A closed graph of quiet king moves in a pawn-only position proves that no pawn
// can ever move or be captured. Budget exhaustion is inconclusive, never a draw.
function proveLockedPawnPosition(fen: string): boolean {
  const pending = [fen];
  const seen = new Set<string>();
  while (pending.length > 0) {
    const candidate = new Chess(pending.pop()!);
    const key = candidate.fen().split(' ').slice(0, 4).join(' ');
    if (seen.has(key)) continue;
    if (seen.size >= 4096) return false;
    seen.add(key);
    if (candidate.isCheckmate()) return false;
    const moves = candidate.moves({ verbose: true });
    if (moves.some(move => move.piece !== 'k' || move.captured !== undefined)) return false;
    for (const move of moves) pending.push(move.after);
  }
  return true;
}
