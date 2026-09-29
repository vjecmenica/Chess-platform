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
  | { readonly status: 'pending_adjudication'; readonly result: null; readonly drawOffer: null;
      readonly pending: { readonly kind: 'resignation'; readonly resigningSide: Side } }
  | { readonly status: 'finished'; readonly result: GameResult; readonly drawOffer: null;
      readonly adjudication?: ResignationRuling }
);

export type GameRejection =
  | 'game_finished' | 'invalid_side' | 'draw_too_early'
  | 'draw_offer_pending' | 'no_draw_offer' | 'own_draw_offer' | 'invalid_claim' | 'claim_not_available'
  | 'adjudication_pending' | 'no_pending_resignation' | 'invalid_ruling';

export interface ResignationRuling {
  readonly verdict: 'mate_possible';
  readonly mateLine: readonly Omit<MoveRequest, 'side'>[];
}

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
  verifyResignationMateLine(mateLine: readonly Omit<MoveRequest, 'side'>[]): boolean;
  resolveResignation(ruling: ResignationRuling): CommandResult;
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
  adjudication_pending: 'The accepted resignation is awaiting adjudication.',
  no_pending_resignation: 'There is no resignation awaiting adjudication.',
  invalid_ruling: 'Provide a legal mate line ending in checkmate by the opponent.',
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
  let pendingResignation: Side | null = null;
  let adjudication: ResignationRuling | null = null;
  let drawOffer: Side | null = null;
  let ply = 0;
  const occurrences = new Map([[board.repetitionKey(), 1]]);

  const getState = (): GameSnapshot => {
    if (result !== null) return { status: 'finished', result: { ...result }, drawOffer: null,
      ...(adjudication === null ? {} : { adjudication: { verdict: 'mate_possible' as const,
        mateLine: adjudication.mateLine.map(move => ({ ...move })) } }),
      position: position.getPosition() };
    if (pendingResignation !== null) return { status: 'pending_adjudication', result: null,
      drawOffer: null, pending: { kind: 'resignation', resigningSide: pendingResignation },
      position: position.getPosition() };
    return { status: 'active', result: null, drawOffer, position: position.getPosition() };
  };

  function validate(command: SideCommand): Rejected<GameRejection> | undefined {
    if (result !== null) return reject('game_finished');
    if (pendingResignation !== null) return reject('adjudication_pending');
    if (command.side !== 'white' && command.side !== 'black') return reject('invalid_side');
    return undefined;
  }

  function finish(finalResult: GameResult): void {
    result = finalResult;
    pendingResignation = null;
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
    else if (board.proveNoMate('white') === 'impossible' && board.proveNoMate('black') === 'impossible') {
      finish({ outcome: 'draw', reason: 'dead_position' });
    } else if (occurrences.get(board.repetitionKey())! >= 5) finish({ outcome: 'draw', reason: 'fivefold_repetition' });
    else if (board.reversiblePlies() >= 150) finish({ outcome: 'draw', reason: 'seventy_five_move' });
  }

  function verifyResignationMateLine(mateLine: readonly Omit<MoveRequest, 'side'>[]): boolean {
    if (result !== null || pendingResignation === null || !Array.isArray(mateLine)
      || mateLine.length === 0 || mateLine.length > 256) return false;
    const winner = pendingResignation === 'white' ? 'black' : 'white';
    const replay = createGameFromPosition(startingFen);
    for (const move of position.getHistory()) {
      if (!replay.submitMove(move).accepted) return false;
    }
    for (const move of mateLine) {
      if (!move || typeof move !== 'object') return false;
      if (!replay.submitMove({ ...move, side: replay.getState().position.sideToMove }).accepted) return false;
    }
    const replayResult = replay.getState().result;
    return replayResult?.outcome === 'win' && replayResult.reason === 'checkmate'
      && replayResult.winner === winner;
  }

  adjudicate();
  return {
    getState,
    verifyResignationMateLine,
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
      const possibility = board.matingPossibility(winner);
      if (possibility === 'unresolved') {
        pendingResignation = command.side;
        drawOffer = null;
        return { accepted: true, game: getState() };
      }
      finish(possibility === 'impossible'
        ? { outcome: 'draw', reason: 'resignation_no_mating_possibility' }
        : { outcome: 'win', winner, reason: 'resignation' });
      return { accepted: true, game: getState() };
    },
    resolveResignation(ruling) {
      if (result !== null) return reject('game_finished');
      if (pendingResignation === null) return reject('no_pending_resignation');
      if (!ruling || typeof ruling !== 'object') return reject('invalid_ruling');
      const winner = pendingResignation === 'white' ? 'black' : 'white';
      if (ruling.verdict !== 'mate_possible' || !verifyResignationMateLine(ruling.mateLine)) {
        return reject('invalid_ruling');
      }
      finish({ outcome: 'win', winner, reason: 'resignation' });
      adjudication = { verdict: 'mate_possible', mateLine: ruling.mateLine.map(move => ({
        from: move.from, to: move.to, ...(move.promotion === undefined ? {} : { promotion: move.promotion }),
      })) };
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
