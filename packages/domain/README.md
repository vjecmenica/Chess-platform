# Domain positions and games

`@chess/domain` owns chess rules without exposing chess.js types. It supports standard chess from the standard starting position, move validation, replay history, and a small game lifecycle. It does not run clocks, save games, or authenticate players. The [game rules](../../docs/game-rules.md) separate implemented results from pending draw policy.

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

## Position API

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

The position API checks legality without enforcing game status. It remains suitable for replay; use the game API when a result must stop play. Neither API automatically ends play for repetition or move counters.

## Game API

`createGame()` creates an independent active game and privately owns its position. Callers cannot bypass completion checks by accessing that position.

`getState()` returns a detached snapshot with `position`, `status`, `result`, and `drawOffer`. An active snapshot has a null result and an optional offerer's side. A finished snapshot has a result and no offer. `getHistory()` returns the same ordered, detached move records as the position API.

`submitMove({ side, from, to, promotion? })` uses the existing move rules. Success returns `{ accepted: true, move, game }`, including any result caused by the move. All other commands take `{ side }` and return `{ accepted: true, game }` on success:

- `resign` awards the opponent a win under the current simplified policy; mating-possibility exceptions are pending review.
- `offerDraw` requires at least one move by each side and no pending offer.
- `acceptDraw` finishes by agreement; only the recipient of a pending offer can accept.
- `declineDraw` clears an offer without finishing; only its recipient can decline.

Offers can be made outside the actor's turn. The offerer's move preserves an offer; the recipient's accepted move declines it. An illegal move does not decline it. Results clear offers. See the [precise policy](../../docs/game-rules.md#implemented-lifecycle).

A win is `{ outcome: 'win', winner, reason: 'checkmate' | 'resignation' }`. A draw is `{ outcome: 'draw', reason: 'stalemate' | 'agreement' }`. No other results or draw claims exist yet.

Rejections return `{ accepted: false, reason, message }` and preserve all state. The game first checks completion (`game_finished`), then the acting side (`invalid_side`). Moves then use the position API's rejection reasons. Draw commands can reject with `draw_too_early`, `draw_offer_pending`, `no_draw_offer`, or `own_draw_offer`. A terminal retry is rejected even if it repeats the original command; later server request receipts will handle network retries. The future server must validate payloads and derive the side from the authorized session, not trust a client-supplied side.

```ts
import { createGame } from '@chess/domain';

const game = createGame();
game.submitMove({ side: 'white', from: 'e2', to: 'e4' });
game.submitMove({ side: 'black', from: 'e7', to: 'e5' });
game.offerDraw({ side: 'white' });
const response = game.acceptDraw({ side: 'black' });
if (response.accepted) console.log(response.game.result); // Draw by agreement.
```

## Checks

From the repository root:

```sh
npm test -- packages/domain/test
npm run check
```

Fixtures reach special positions through legal moves from the standard start. Tests cover normal moves, turn order, king safety, castling and lost rights, en passant and its expiry, all four promotion choices, replay history, and unchanged state after rejection. Lifecycle tests cover both colors delivering mate, stalemate, resignation, agreement, draw-offer lifetime, invalid commands, terminal retries, and unchanged state after rejection. They need no database, network service, or clock.
