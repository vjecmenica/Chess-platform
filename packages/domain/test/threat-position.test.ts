import { expect, it } from 'vitest';
import { opponentPassPosition, STANDARD_STARTING_FEN, createPositionFromFen } from '../src/index.js';

it('passes to the opponent for either side and advances only the appropriate counters', () => {
  expect(opponentPassPosition(STANDARD_STARTING_FEN)).toEqual({ kind: 'ready',
    fen: STANDARD_STARTING_FEN.replace(' w ', ' b ').replace('0 1', '1 1') });
  const black = STANDARD_STARTING_FEN.replace(' w ', ' b ').replace('0 1', '8 12');
  expect(opponentPassPosition(black)).toEqual({ kind: 'ready',
    fen: STANDARD_STARTING_FEN.replace('0 1', '9 13') });
});
it('expires en passant, keeps both castling rights, and never modifies the real position', () => {
  const fen = 'r3k2r/8/8/3pP3/8/8/8/R3K2R w KQkq d6 0 12';
  const original = createPositionFromFen(fen);
  expect(opponentPassPosition(fen)).toEqual({ kind: 'ready', fen: fen.replace(' w ', ' b ').replace('d6 0', '- 1') });
  expect(original.getPosition().fen).toBe(fen);
});
it.each([
  '4r1k1/8/8/8/8/8/8/4K3 w - - 0 1',
  '4k3/8/8/8/8/8/8/4R1K1 b - - 0 1',
])('refuses a pass from check: %s', fen => {
  expect(opponentPassPosition(fen)).toEqual({ kind: 'unavailable', reason: 'in_check' });
});
it('rejects malformed or inconsistent positions and terminal positions', () => {
  for (const fen of ['invalid', '4k3/8/8/8/8/8/8/4K3 w K - 0 1',
    '4k3/8/8/8/8/8/8/4R1K1 w - - 0 1'])
    expect(opponentPassPosition(fen)).toEqual({ kind: 'unavailable', reason: 'invalid_position' });
  expect(opponentPassPosition('7k/5K2/6Q1/8/8/8/8/8 b - - 0 1'))
    .toEqual({ kind: 'unavailable', reason: 'no_moves' });
});

it('clears Black en passant after passing and preserves queenside and kingside rights', () => {
  expect(opponentPassPosition('r3k2r/8/8/8/3Pp3/8/8/R3K2R b KQkq d3 0 12')).toEqual({
    kind:'ready',fen:'r3k2r/8/8/8/3Pp3/8/8/R3K2R w KQkq - 1 13'
  });
});
