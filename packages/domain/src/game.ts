import type { MatingPossibility } from './mating.js';
import { createPositionAdapter, STANDARD_STARTING_FEN } from './position.js';
import type { MoveRecord, MoveRejection, MoveRequest, PositionSnapshot, Side } from './position.js';

export interface SideCommand {
  readonly side: Side;
}

export type ResignationPolicy = 'casual_concession' | 'fide_proof_required';
export type TimeoutPolicy = 'casual_flag_forfeit' | 'fide_proof_required';

export type GameResult =
  | { readonly outcome: 'win'; readonly winner: Side; readonly reason: 'checkmate' | 'resignation' }
  | { readonly outcome: 'win'; readonly winner: Side; readonly reason: 'timeout';
      readonly flaggedSide: Side; readonly deadlineMs: number }
  | { readonly outcome: 'draw'; readonly reason: 'stalemate' | 'agreement' | 'dead_position' | 'fivefold_repetition'
      | 'seventy_five_move' | 'threefold_repetition' | 'fifty_move' | 'resignation_no_mating_possibility' }
  | { readonly outcome: 'draw'; readonly reason: 'timeout_no_mating_possibility';
      readonly flaggedSide: Side; readonly deadlineMs: number };

export interface TimeoutDetails {
  readonly flaggedSide: Side;
  readonly deadlineMs: number;
}

export type GameSnapshot = { readonly position: PositionSnapshot } & (
  | { readonly status: 'active'; readonly result: null; readonly drawOffer: Side | null;
      readonly claimDrawOffer: Side | null }
  | { readonly status: 'pending_adjudication'; readonly result: null; readonly drawOffer: null;
      readonly claimDrawOffer: null;
      readonly pending: { readonly kind: 'resignation'; readonly resigningSide: Side }
        | ({ readonly kind: 'timeout' } & TimeoutDetails) }
  | { readonly status: 'finished'; readonly result: GameResult; readonly drawOffer: null;
      readonly claimDrawOffer: null;
      readonly adjudication?: MateRuling }
);

export type GameRejection =
  | 'game_finished' | 'invalid_side' | 'draw_too_early'
  | 'draw_offer_too_early' | 'draw_offer_cooldown' | 'draw_offer_pending'
  | 'no_draw_offer' | 'own_draw_offer' | 'invalid_claim' | 'claim_not_available'
  | 'adjudication_pending' | 'no_pending_resignation' | 'no_pending_timeout'
  | 'invalid_ruling' | 'invalid_timeout';

export interface MateRuling {
  readonly verdict: 'mate_possible';
  readonly mateLine: readonly Omit<MoveRequest, 'side'>[];
}
export type ResignationRuling = MateRuling;

export interface TimeoutCommand extends TimeoutDetails {
  /** A previously found candidate; the game verifies it before awarding a win. */
  readonly mateLine?: readonly Omit<MoveRequest, 'side'>[];
}

export interface DrawClaim extends SideCommand {
  readonly rule: 'threefold_repetition' | 'fifty_move';
  readonly intendedMove?: Omit<MoveRequest, 'side'>;
}

export type ClaimResult =
  | { readonly accepted: true; readonly game: GameSnapshot }
  | Rejected<GameRejection | MoveRejection>;
export type IncorrectClaimResult =
  | { readonly accepted: true; readonly game: GameSnapshot; readonly move?: MoveRecord }
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
  getDrawOfferNextEligiblePly(): Readonly<Record<Side, number>>;
  getMatingPossibility(side: Side): MatingPossibility;
  claimDraw(command: DrawClaim): ClaimResult;
  getAvailableDrawClaims(): readonly DrawClaim['rule'][];
  /** Records the consequences of a legally formed claim whose threshold was not met. */
  recordIncorrectDrawClaim(command: DrawClaim): IncorrectClaimResult;
  submitMove(request: MoveRequest): GameMoveResult;
  resign(command: SideCommand): CommandResult;
  flagTimeout(command: TimeoutCommand): CommandResult;
  verifyMateLine(winner: Side, mateLine: readonly Omit<MoveRequest, 'side'>[]): boolean;
  verifyResignationMateLine(mateLine: readonly Omit<MoveRequest, 'side'>[]): boolean;
  resolveResignation(ruling: ResignationRuling): CommandResult;
  verifyTimeoutMateLine(mateLine: readonly Omit<MoveRequest, 'side'>[]): boolean;
  resolveTimeout(ruling: MateRuling): CommandResult;
  offerDraw(command: SideCommand): CommandResult;
  /** Replays a previously accepted offer; new player commands must use offerDraw. */
  replayAcceptedDrawOffer(command: SideCommand): CommandResult;
  acceptDraw(command: SideCommand): CommandResult;
  declineDraw(command: SideCommand): CommandResult;
}

const messages: Record<GameRejection, string> = {
  game_finished: 'The game has already finished.',
  invalid_side: 'The acting side must be white or black.',
  draw_too_early: 'Both sides must make a move before a draw can be agreed.',
  draw_offer_too_early: 'Both players must make a move before either can offer a draw.',
  draw_offer_cooldown: 'More than 20 further half-moves must be played before this player can offer another draw.',
  invalid_claim: 'Choose threefold_repetition or fifty_move as the claim rule.',
  claim_not_available: 'The specified position does not meet the claimed draw threshold.',
  adjudication_pending: 'The game is awaiting adjudication.',
  no_pending_resignation: 'There is no resignation awaiting adjudication.',
  no_pending_timeout: 'There is no timeout awaiting adjudication.',
  invalid_ruling: 'Provide a legal mate line ending in checkmate by the opponent.',
  invalid_timeout: 'The timeout must name the side to move and a nonnegative integer deadline.',
  draw_offer_pending: 'Respond to the pending draw offer before making another.',
  no_draw_offer: 'There is no pending draw offer.',
  own_draw_offer: 'Only the opponent can respond to your draw offer.',
};

function reject(reason: GameRejection): Rejected<GameRejection> {
  return { accepted: false, reason, message: messages[reason] };
}

export function createGame(resignationPolicy: ResignationPolicy,
  timeoutPolicy: TimeoutPolicy = 'fide_proof_required'): ChessGame {
  return createGameFromPosition(STANDARD_STARTING_FEN, resignationPolicy, timeoutPolicy);
}

// A trusted starting position for saved games and rule fixtures; no history is inferred from FEN.
export function createGameFromPosition(startingFen: string,
  resignationPolicy: ResignationPolicy = 'casual_concession',
  timeoutPolicy: TimeoutPolicy = 'fide_proof_required'): ChessGame {
  const board = createPositionAdapter(startingFen);
  const position = board.position;
  let result: GameResult | null = null;
  let pendingResignation: Side | null = null;
  let pendingTimeout: TimeoutDetails | null = null;
  let adjudication: MateRuling | null = null;
  let drawOffer: Side | null = null;
  let claimDrawOffer: Side | null = null;
  let ply = 0;
  const lastOfferPly: Record<Side, number | null> = { white: null, black: null };
  const occurrences = new Map([[board.repetitionKey(), 1]]);

  const getState = (): GameSnapshot => {
    if (result !== null) return { status: 'finished', result: { ...result }, drawOffer: null,
      claimDrawOffer: null,
      ...(adjudication === null ? {} : { adjudication: { verdict: 'mate_possible' as const,
        mateLine: adjudication.mateLine.map(move => ({ ...move })) } }),
      position: position.getPosition() };
    if (pendingResignation !== null) return { status: 'pending_adjudication', result: null,
      drawOffer: null, claimDrawOffer: null,
      pending: { kind: 'resignation', resigningSide: pendingResignation },
      position: position.getPosition() };
    if (pendingTimeout !== null) return { status: 'pending_adjudication', result: null,
      drawOffer: null, claimDrawOffer: null,
      pending: { kind: 'timeout', ...pendingTimeout }, position: position.getPosition() };
    return { status: 'active', result: null, drawOffer, claimDrawOffer,
      position: position.getPosition() };
  };

  function validate(command: SideCommand): Rejected<GameRejection> | undefined {
    if (result !== null) return reject('game_finished');
    if (pendingResignation !== null || pendingTimeout !== null) return reject('adjudication_pending');
    if (command.side !== 'white' && command.side !== 'black') return reject('invalid_side');
    return undefined;
  }

  function finish(finalResult: GameResult): void {
    result = finalResult;
    pendingResignation = null;
    pendingTimeout = null;
    drawOffer = null;
    claimDrawOffer = null;
  }

  function recordDrawOffer(side: Side): CommandResult {
    drawOffer = side;
    lastOfferPly[side] = ply;
    return { accepted: true, game: getState() };
  }

  function respondToDraw(command: SideCommand, accept: boolean): CommandResult {
    const rejection = validate(command);
    if (rejection) return rejection;
    const opponent = command.side === 'white' ? 'black' : 'white';
    if (drawOffer !== opponent && claimDrawOffer !== opponent) {
      return drawOffer === command.side || claimDrawOffer === command.side
        ? reject('own_draw_offer') : reject('no_draw_offer');
    }
    if (accept && ply < 2) return reject('draw_too_early');
    if (accept) finish({ outcome: 'draw', reason: 'agreement' });
    else { if (drawOffer === opponent) drawOffer = null;
      if (claimDrawOffer === opponent) claimDrawOffer = null; }
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

  function verifyMateLine(winner: Side, mateLine: readonly Omit<MoveRequest, 'side'>[]): boolean {
    if (result !== null || winner !== 'white' && winner !== 'black' || !Array.isArray(mateLine)
      || mateLine.length === 0 || mateLine.length > 256) return false;
    const replay = createGameFromPosition(startingFen, resignationPolicy);
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

  function verifyResignationMateLine(mateLine: readonly Omit<MoveRequest, 'side'>[]): boolean {
    if (pendingResignation === null) return false;
    return verifyMateLine(pendingResignation === 'white' ? 'black' : 'white', mateLine);
  }

  function verifyTimeoutMateLine(mateLine: readonly Omit<MoveRequest, 'side'>[]): boolean {
    if (pendingTimeout === null) return false;
    return verifyMateLine(pendingTimeout.flaggedSide === 'white' ? 'black' : 'white', mateLine);
  }

  function retainRuling(ruling: MateRuling): void {
    adjudication = { verdict: 'mate_possible', mateLine: ruling.mateLine.map(move => ({
      from: move.from, to: move.to, ...(move.promotion === undefined ? {} : { promotion: move.promotion }),
    })) };
  }

  adjudicate();
  return {
    getState,
    getDrawOfferNextEligiblePly: () => ({
      white: lastOfferPly.white === null ? 2 : lastOfferPly.white + 21,
      black: lastOfferPly.black === null ? 2 : lastOfferPly.black + 21,
    }),
    verifyMateLine,
    verifyResignationMateLine,
    verifyTimeoutMateLine,
    getAvailableDrawClaims() {
      if (getState().status !== 'active') return [];
      const available: DrawClaim['rule'][] = [];
      if ((occurrences.get(board.repetitionKey()) ?? 0) >= 3) available.push('threefold_repetition');
      if (board.reversiblePlies() >= 100) available.push('fifty_move');
      return available;
    },
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
    recordIncorrectDrawClaim(command) {
      const rejection = validate(command);
      if (rejection) return rejection;
      if (command.side !== position.getPosition().sideToMove) {
        return { accepted: false, reason: 'wrong_turn', message: 'Only the side to move may claim a draw.' };
      }
      if (command.rule !== 'threefold_repetition' && command.rule !== 'fifty_move') return reject('invalid_claim');
      if (command.intendedMove !== undefined) {
        const preview = board.previewMove({ ...command.intendedMove, side: command.side });
        if (!preview.accepted) return preview;
        const moved = this.submitMove({ ...command.intendedMove, side: command.side });
        if (!moved.accepted) return moved;
        if (getState().status === 'active') {
          if (drawOffer === command.side) drawOffer = null;
          claimDrawOffer = command.side;
        }
        return { accepted: true, move: moved.move, game: getState() };
      }
      if (drawOffer === command.side) drawOffer = null;
      claimDrawOffer = command.side;
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
      if (claimDrawOffer !== null && claimDrawOffer !== request.side) claimDrawOffer = null;
      return { accepted: true, move: moveResult.move, game: getState() };
    },
    resign(command) {
      const rejection = validate(command);
      if (rejection) return rejection;
      const winner = command.side === 'white' ? 'black' : 'white';
      const possibility = board.matingPossibility(winner);
      if (possibility === 'impossible') {
        finish({ outcome: 'draw', reason: 'resignation_no_mating_possibility' });
      } else if (possibility === 'possible' || resignationPolicy === 'casual_concession') {
        // Casual games treat an unresolved mating query as a concession, not as a proof.
        finish({ outcome: 'win', winner, reason: 'resignation' });
      } else {
        pendingResignation = command.side;
        drawOffer = null;
        claimDrawOffer = null;
      }
      return { accepted: true, game: getState() };
    },
    flagTimeout(command) {
      if (result !== null) return reject('game_finished');
      if (pendingResignation !== null || pendingTimeout !== null) return reject('adjudication_pending');
      if (!command || (command.flaggedSide !== 'white' && command.flaggedSide !== 'black')
        || command.flaggedSide !== position.getPosition().sideToMove
        || !Number.isSafeInteger(command.deadlineMs) || command.deadlineMs < 0) {
        return reject('invalid_timeout');
      }
      const winner = command.flaggedSide === 'white' ? 'black' : 'white';
      const possibility = board.matingPossibility(winner);
      const verifiedMateLine = command.mateLine !== undefined
        && verifyMateLine(winner, command.mateLine);
      if (possibility === 'impossible') {
        finish({ outcome: 'draw', reason: 'timeout_no_mating_possibility',
          flaggedSide: command.flaggedSide, deadlineMs: command.deadlineMs });
      } else if (possibility === 'possible' || timeoutPolicy === 'casual_flag_forfeit'
        || verifiedMateLine) {
        finish({ outcome: 'win', winner, reason: 'timeout',
          flaggedSide: command.flaggedSide, deadlineMs: command.deadlineMs });
        if (possibility !== 'possible' && verifiedMateLine && command.mateLine !== undefined) {
          retainRuling({ verdict: 'mate_possible', mateLine: command.mateLine });
        }
      } else {
        pendingTimeout = { flaggedSide: command.flaggedSide, deadlineMs: command.deadlineMs };
        drawOffer = null;
        claimDrawOffer = null;
      }
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
      retainRuling(ruling);
      return { accepted: true, game: getState() };
    },
    resolveTimeout(ruling) {
      if (result !== null) return reject('game_finished');
      if (pendingTimeout === null) return reject('no_pending_timeout');
      if (!ruling || typeof ruling !== 'object' || ruling.verdict !== 'mate_possible'
        || !verifyTimeoutMateLine(ruling.mateLine)) return reject('invalid_ruling');
      const { flaggedSide, deadlineMs } = pendingTimeout;
      const winner = flaggedSide === 'white' ? 'black' : 'white';
      finish({ outcome: 'win', winner, reason: 'timeout', flaggedSide, deadlineMs });
      retainRuling(ruling);
      return { accepted: true, game: getState() };
    },
    offerDraw(command) {
      const rejection = validate(command);
      if (rejection) return rejection;
      if (drawOffer !== null || claimDrawOffer !== null) return reject('draw_offer_pending');
      if (ply < 2) return reject('draw_offer_too_early');
      const previous = lastOfferPly[command.side];
      if (previous !== null && ply <= previous + 20) return reject('draw_offer_cooldown');
      return recordDrawOffer(command.side);
    },
    replayAcceptedDrawOffer(command) {
      const rejection = validate(command);
      if (rejection) return rejection;
      if (drawOffer !== null || claimDrawOffer !== null) return reject('draw_offer_pending');
      return recordDrawOffer(command.side);
    },
    acceptDraw: command => respondToDraw(command, true),
    declineDraw: command => respondToDraw(command, false),
  };
}
