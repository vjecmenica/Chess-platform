import { describe, expect, it } from 'vitest';
import type { GameReadResponse } from '@chess/contracts';
import { availableClaimForPlayer } from '../src/draw-claim-control';

const game = { status: 'active', yourSeat: 'white',
  position: { sideToMove: 'white' },
  availableDrawClaims: ['threefold_repetition'] } as GameReadResponse;

describe('online draw-claim control', () => {
  it('shows only a confirmed, current-position claim for the player to move', () => {
    expect(availableClaimForPlayer(game)).toBe('threefold_repetition');
    expect(availableClaimForPlayer({ ...game, availableDrawClaims: ['fifty_move'] })).toBe('fifty_move');
    expect(availableClaimForPlayer({ ...game, availableDrawClaims: [] })).toBeNull();
    expect(availableClaimForPlayer({ ...game, yourSeat: 'black' })).toBeNull();
    expect(availableClaimForPlayer({ ...game, status: 'finished' })).toBeNull();
  });
});
