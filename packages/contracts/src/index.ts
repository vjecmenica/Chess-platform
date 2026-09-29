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
  readonly game: { readonly status: 'not_started'; readonly rated: false;
    readonly initialMs: 300_000; readonly incrementMs: 3_000 };
  readonly createdAt: string;
}
