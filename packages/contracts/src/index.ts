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
  readonly game: { readonly id: string | null; readonly status: 'not_created' | 'active' | 'finished';
    readonly clocks: 'not_integrated'; readonly rated: false;
    readonly initialMs: 300_000; readonly incrementMs: 3_000 };
  readonly createdAt: string;
}

export type GameSide = 'white' | 'black';
export interface SavedMove {
  readonly ply: number;
  readonly side: GameSide;
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
  readonly status: 'active' | 'finished';
  readonly position: { readonly fen: string; readonly sideToMove: GameSide };
  readonly result: { readonly outcome: 'win' | 'draw'; readonly reason: string;
    readonly winner?: GameSide } | null;
  readonly clocks: null;
  readonly clockStatus: 'not_integrated';
  readonly timeControl: { readonly initialMs: 300_000; readonly incrementMs: 3_000 };
  readonly rated: false;
  readonly yourSeat: GameSide;
}

export interface GameReadResponse extends GameState {
  readonly history: readonly SavedMove[];
}

export interface MoveAcceptedResponse {
  readonly accepted: true;
  readonly move: SavedMove;
  readonly game: GameState;
}
