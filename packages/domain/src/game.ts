import type { MatingPossibility } from './mating.js';
import { createPositionAdapter, STANDARD_STARTING_FEN } from './position.js';
import type { MoveRecord, MoveRejection, MoveRequest, PositionSnapshot, Side } from './position.js';

export interface SideCommand {
  readonly side: Side;
}

export type GameResult =
  | { readonly outcome: 'win'; readonly winner: Side; readonly reason: 'checkmate' | 'resignation' }
  | { readonly outcome: 'draw'; readonly reason: 'stalemate' | 'agreement' | 'dead_position' | 'fivefold_repetition'
      | 'seventy_five_move' | 'threefold_repetition' | 'fifty_move' | 'resignation_no_mating_possibility' };

export type GameSnapshot = { readonly position: PositionSnapshot } & (
  | { readonly status: 'active'; readonly result: null; readonly drawOffer: Side | null }
  | { readonly status: 'finished'; readonly result: GameResult; readonly drawOffer: null }
);

export type GameRejection =
  | 'game_finished' | 'invalid_side' | 'draw_too_early'
  | 'draw_offer_pending' | 'no_draw_offer' | 'own_draw_offer' | 'invalid_claim' | 'claim_not_available';

export interface DrawClaim extends SideCommand {
  readonly rule: 'threefold_repetition' | 'fifty_move';
  readonly intendedMove?: Omit<MoveRequest, 'side'>;
}

export type ClaimResult =
  | { readonly accepted: true; readonly game: GameSnapshot }
  | Rejected<GameRejection | MoveRejection>;

type Rejected<R extends string> = { readonly accepted: false; readonly reason: R; readonly message: string };
export type CommandResult =
  | { readonly accepted: true; readonly game: GameSnapshot }
  | Rejected<GameRejection>;
export type GameMoveResult =
  | { readonly accepted: true; readonly move: MoveRecord; readonly game: GameSnapshot }
  | Rejected<MoveRejection | GameRejection>;

export interface ChessGame {
  getState(): GameSnapshot;
  getHistory(): readonly MoveRecord[];
  getMatingPossibility(side: Side): MatingPossibility;
  claimDraw(command: DrawClaim): ClaimResult;
  submitMove(request: MoveRequest): GameMoveResult;
  resign(command: SideCommand): CommandResult;
  offerDraw(command: SideCommand): CommandResult;
  acceptDraw(command: SideCommand): CommandResult;
  declineDraw(command: SideCommand): CommandResult;
}

const messages: Record<GameRejection, string> = {
  game_finished: 'The game has already finished.',
  invalid_side: 'The acting side must be white or black.',
  draw_too_early: 'Both sides must make a move before a draw can be agreed.',
  invalid_claim: 'Choose threefold_repetition or fifty_move as the claim rule.',
  claim_not_available: 'The specified position does not meet the claimed draw threshold.',
  draw_offer_pending: 'Respond to the pending draw offer before making another.',
  no_draw_offer: 'There is no pending draw offer.',
  own_draw_offer: 'Only the opponent can respond to your draw offer.',
};

function reject(reason: GameRejection): Rejected<GameRejection> {
  return { accepted: false, reason, message: messages[reason] };
}

export function createGame(): ChessGame {
  return createGameFromPosition(STANDARD_STARTING_FEN);
}

// Internal setup for rule fixtures. Not exported by the package; no history is inferred from FEN.
export function createGameFromPosition(startingFen: string): ChessGame {
  const board = createPositionAdapter(startingFen);
  const position = board.position;
  let result: GameResult | null = null;
  let drawOffer: Side | null = null;
  let ply = 0;
  const occurrences = new Map([[board.repetitionKey(), 1]]);

  const getState = (): GameSnapshot => result === null
    ? { status: 'active', result: null, drawOffer, position: position.getPosition() }
    : { status: 'finished', result: { ...result }, drawOffer: null, position: position.getPosition() };

  function validate(command: SideCommand): Rejected<GameRejection> | undefined {
    if (result !== null) return reject('game_finished');
    if (command.side !== 'white' && command.side !== 'black') return reject('invalid_side');
    return undefined;
  }

  function finish(finalResult: GameResult): void {
    result = finalResult;
    drawOffer = null;
  }

  function respondToDraw(command: SideCommand, accept: boolean): CommandResult {
    const rejection = validate(command);
    if (rejection) return rejection;
    if (drawOffer === null) return reject('no_draw_offer');
    if (drawOffer === command.side) return reject('own_draw_offer');
    if (accept && ply < 2) return reject('draw_too_early');
    if (accept) finish({ outcome: 'draw', reason: 'agreement' });
    else drawOffer = null;
    return { accepted: true, game: getState() };
  }

  function adjudicate(): void {
    const next = position.getPosition().sideToMove;
    if (board.isCheckmate()) finish({ outcome: 'win', winner: next === 'white' ? 'black' : 'white', reason: 'checkmate' });
    else if (board.isStalemate()) finish({ outcome: 'draw', reason: 'stalemate' });
    else if (board.matingPossibility('white') === 'impossible' && board.matingPossibility('black') === 'impossible') {
      finish({ outcome: 'draw', reason: 'dead_position' });
    } else if (occurrences.get(board.repetitionKey())! >= 5) finish({ outcome: 'draw', reason: 'fivefold_repetition' });
    else if (board.reversiblePlies() >= 150) finish({ outcome: 'draw', reason: 'seventy_five_move' });
  }

  adjudicate();
  return {
    getState,
    getMatingPossibility: side => board.matingPossibility(side),
    claimDraw(command) {
      const rejection = validate(command);
      if (rejection) return rejection;
      if (command.side !== position.getPosition().sideToMove) {
        return { accepted: false, reason: 'wrong_turn', message: 'Only the side to move may claim a draw.' };
      }
      if (command.rule !== 'threefold_repetition' && command.rule !== 'fifty_move') return reject('invalid_claim');
      let key = board.repetitionKey();
      let count = occurrences.get(key)!;
      let reversiblePlies = board.reversiblePlies();
      if (command.intendedMove !== undefined) {
        const preview = board.previewMove({ ...command.intendedMove, side: command.side });
        if (!preview.accepted) return preview;
        const candidate = createPositionAdapter(preview.position.fen);
        key = candidate.repetitionKey();
        count = (occurrences.get(key) ?? 0) + 1;
        reversiblePlies = candidate.reversiblePlies();
      }
      if (command.rule === 'threefold_repetition' ? count < 3 : reversiblePlies < 100) {
        return reject('claim_not_available');
      }
      finish({ outcome: 'draw', reason: command.rule });
      return { accepted: true, game: getState() };
    },
    getHistory: () => position.getHistory(),
    submitMove(request) {
      const rejection = validate(request);
      if (rejection) return rejection;
      const moveResult = position.submitMove(request);
      if (!moveResult.accepted) return moveResult;
      ply = moveResult.move.ply;
      const key = board.repetitionKey();
      occurrences.set(key, (occurrences.get(key) ?? 0) + 1);
      adjudicate();
      if (drawOffer !== null && drawOffer !== request.side) drawOffer = null;
      return { accepted: true, move: moveResult.move, game: getState() };
    },
    resign(command) {
      const rejection = validate(command);
      if (rejection) return rejection;
      const winner = command.side === 'white' ? 'black' : 'white';
      finish(board.matingPossibility(winner) === 'impossible'
        ? { outcome: 'draw', reason: 'resignation_no_mating_possibility' }
        : { outcome: 'win', winner, reason: 'resignation' });
      return { accepted: true, game: getState() };
    },
    offerDraw(command) {
      const rejection = validate(command);
      if (rejection) return rejection;
      if (drawOffer !== null) return reject('draw_offer_pending');
      drawOffer = command.side;
      return { accepted: true, game: getState() };
    },
    acceptDraw: command => respondToDraw(command, true),
    declineDraw: command => respondToDraw(command, false),
  };
}
