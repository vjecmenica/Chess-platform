import { Chess } from 'chess.js';

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

export interface ChessPosition {
  getPosition(): PositionSnapshot;
  getHistory(): readonly MoveRecord[];
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
  const chess = new Chess(STANDARD_STARTING_FEN);
  const history: MoveRecord[] = [];
  const getPosition = (): PositionSnapshot => ({
    fen: chess.fen(),
    sideToMove: chess.turn() === 'w' ? 'white' : 'black',
  });

  return {
    getPosition,
    getHistory: () => history.map(move => ({ ...move })),
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
}
