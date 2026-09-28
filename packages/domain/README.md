# Domain move validation

`@chess/domain` owns chess rules without exposing chess.js types. It currently supports only standard chess from the standard starting position. It does not decide game results, run clocks, save games, or authenticate players.

```ts
import { createPosition } from '@chess/domain';

const position = createPosition();
const result = position.submitMove({ side: 'white', from: 'e2', to: 'e4' });

if (result.accepted) {
  console.log(result.move.san); // e4
  console.log(result.position.sideToMove); // black
} else {
  console.log(result.reason, result.message);
}
```

## API

- `createPosition()` creates an independent position with White to move and empty history. `STANDARD_STARTING_FEN` is exported for replay consumers.
- `getPosition()` returns `{ fen, sideToMove }`. Sides are `white` and `black`. FEN includes the board, turn, castling rights, en passant state, and move counters. The en passant target is included only when a legal en passant capture is available, following chess.js normalization. FEN counters do not imply a draw policy.
- `submitMove({ side, from, to, promotion? })` accepts lowercase squares `a1`–`h8`. Promotion uses `q`, `r`, `b`, or `n` and is required when promoting; there is no automatic queen choice. A promotion field on an ordinary move is rejected. Castling uses the king's coordinates, such as `e1` to `g1`.
- `getHistory()` returns ordered records with a one-based half-move number (`ply`), side, origin, destination, optional promotion, SAN notation, UCI coordinates, and before/after FEN. Starting from `STANDARD_STARTING_FEN` and submitting each record reconstructs the positions for later replay.

An accepted result has `accepted: true`, a `move` record, and the new `position`. A rejection has `accepted: false`, a stable `reason`, and a readable `message`:

| Reason | Meaning |
| --- | --- |
| `invalid_input` | Invalid side, square syntax, or promotion choice. |
| `wrong_turn` | The supplied side is not the side to move. |
| `promotion_required` | The move can promote, but a piece was not chosen. |
| `illegal_move` | No legal move matches the request, including blocked paths or exposing the king. |

Input validation happens before turn checking, then legal-move matching. Every rejected request preserves the position, side to move, and history. Returned records and snapshots are detached copies, so changing them cannot change the internal position. The API is typed; a future network boundary must still validate incoming data and derive the side from the authorized session.

The adapter checks move legality, not match lifecycle. It does not call chess.js game-over helpers or stop play on a repetition or move-count draw rule. Check or mate markers in SAN are notation, not a saved game result. Result adjudication and clock behavior belong to the next roadmap step.

## Checks

From the repository root:

```sh
npm test -- packages/domain/test
npm run check
```

Fixtures reach special positions through legal moves from the standard start. Tests cover normal moves, turn order, king safety, castling and lost rights, en passant and its expiry, all four promotion choices, replay history, and unchanged state after rejection. They need no database, network service, or clock.
