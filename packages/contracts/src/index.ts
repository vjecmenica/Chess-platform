export type ReadinessResponse =
  | { status: 'ok'; database: 'connected' }
  | { status: 'error'; database: 'unavailable' };

export interface GuestSessionResponse {
  readonly csrfToken: string;
}

export interface ChallengeSummary {
  readonly id: string;
  readonly path: string;
  readonly status: 'open' | 'accepted';
  readonly yourSeat: 'white' | 'black' | null;
  readonly seats: { readonly white: 'occupied'; readonly black: 'open' | 'occupied' };
  readonly game: { readonly id: string | null;
    readonly status: 'not_created' | 'waiting' | 'active' | 'pending_adjudication' | 'finished' | 'aborted';
    readonly clocks: 'not_integrated' | 'authoritative'; readonly rated: false;
    readonly initialMs: number; readonly incrementMs: number };
  readonly createdAt: string;
}

export type GameSide = 'white' | 'black';
export interface ClockState {
  readonly startMode: 'readiness' | 'first_move' | 'first_move_grace';
  readonly phase: 'waiting' | 'awaiting_first_move' | 'running' | 'handoff' | 'stopped' | 'flagged';
  readonly ready: Readonly<Record<GameSide, boolean>>;
  readonly remainingMs: Readonly<Record<GameSide, number>>;
  readonly activeSide: GameSide | null;
  readonly deadlineMs: number | null;
  readonly firstMoveDeadlineMs: Readonly<Record<GameSide, number | null>>;
  readonly flaggedSide: GameSide | null;
  readonly flaggedAtMs: number | null;
  readonly serverNowMs: number;
  readonly outagePolicy: 'continues_through_server_outage';
}
export interface SavedMove {
  readonly ply: number;
  readonly side: GameSide;
  readonly remainingMsAfterMove: number | null;
  readonly from: string;
  readonly to: string;
  readonly promotion?: 'q' | 'r' | 'b' | 'n';
  readonly san: string;
  readonly uci: string;
  readonly beforeFen: string;
  readonly afterFen: string;
}

export interface GameState {
  readonly id: string;
  readonly version: number;
  readonly status: 'waiting' | 'active' | 'pending_adjudication' | 'finished' | 'aborted';
  readonly position: { readonly fen: string; readonly sideToMove: GameSide };
  readonly result: { readonly outcome: 'win' | 'draw' | 'aborted'; readonly reason: string;
    readonly winner?: GameSide; readonly flaggedSide?: GameSide; readonly missedSide?: GameSide;
    readonly deadlineMs?: number } | null;
  readonly drawOffer: GameSide | null;
  readonly claimDrawOffer: GameSide | null;
  readonly availableDrawClaims: readonly ('threefold_repetition' | 'fifty_move')[];
  readonly timeoutAdjudication: 'searching' | 'unresolved' | null;
  readonly drawOfferNextEligiblePly: Readonly<Record<GameSide, number>>;
  readonly pending?: { readonly kind: 'timeout'; readonly flaggedSide: GameSide;
    readonly deadlineMs: number } | { readonly kind: 'resignation'; readonly resigningSide: GameSide };
  readonly clocks: ClockState | null;
  readonly clockStatus: 'not_integrated' | 'authoritative';
  readonly timeControl: { readonly initialMs: number; readonly incrementMs: number }
    | { readonly source: 'pgn'; readonly raw: string } | null;
  readonly rated: false;
  readonly yourSeat: GameSide;
}

export type GamePlayerNames = Readonly<Record<GameSide, string | null>>;
export interface GameReadResponse extends GameState {
  /** Authorized site-game reads only; null means the seat has not been explicitly linked. */
  readonly playerNames?: GamePlayerNames;
  readonly history: readonly SavedMove[];
}

export interface GameChatMessage {
  /** Decimal bigint cursor; never convert it to a JavaScript number. */
  readonly id: string;
  readonly side: GameSide;
  readonly text: string;
  readonly sentAt: string;
}

export interface GameChatHistory {
  readonly messages: readonly GameChatMessage[];
  readonly canSend: boolean;
}

export interface MoveAcceptedResponse {
  readonly accepted: true;
  readonly move: SavedMove;
  readonly game: GameState;
}

export interface GameActionAcceptedResponse {
  readonly accepted: true;
  readonly game: GameState;
}

export interface GameClaimAcceptedResponse extends GameActionAcceptedResponse {
  readonly claimCorrect: boolean;
  readonly bonusMs: number;
  readonly move?: SavedMove;
}
export { timeControlPresets, defaultTimeControl, isTimeControlId } from './time-controls.js';
export type { TimeControlId } from './time-controls.js';
export interface ExplorerListedGame {
  readonly id: string;
  readonly white_name: string | null; readonly black_name: string | null;
  readonly white_rating: number | null; readonly black_rating: number | null;
  readonly white_fide_id: string | null; readonly black_fide_id: string | null;
  readonly result: string; readonly game_date: string | null;
  readonly event: string | null; readonly site: string | null; readonly round: string | null;
  readonly eco: string | null; readonly opening: string | null; readonly time_control: string | null;
  readonly ply: number; readonly uci: string | null;
}
export interface ExplorerGamePage {
  readonly games: readonly ExplorerListedGame[];
  readonly page: number; readonly hasMore: boolean; readonly totalPages: number;
}
export interface AccountIdentity { readonly id: string; readonly username: string }
export interface AccountEmailState { readonly verified: string | null; readonly pending: string | null; readonly deliveryEnabled: boolean }
export interface AccountState { readonly email?: AccountEmailState | null; readonly account: AccountIdentity | null; readonly guestLinked: boolean;
  readonly createdAt: string | null }
export interface AccountGame { readonly id: string; readonly side: 'white' | 'black';
  readonly status: GameState['status']; readonly createdAt: string;
  readonly opponent: string | null; readonly result: GameState['result']; readonly timeControl: string | null }
export interface AccountGames { readonly account: AccountIdentity; readonly games: readonly AccountGame[];
  readonly next: string | null; readonly summary: { readonly wins: number; readonly draws: number; readonly losses: number } }
