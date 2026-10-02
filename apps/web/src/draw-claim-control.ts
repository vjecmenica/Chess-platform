import type { GameReadResponse } from '@chess/contracts';

export function availableClaimForPlayer(game: GameReadResponse):
  'threefold_repetition' | 'fifty_move' | null {
  if (game.status !== 'active' || game.position.sideToMove !== game.yourSeat) return null;
  return game.availableDrawClaims[0] ?? null;
}
