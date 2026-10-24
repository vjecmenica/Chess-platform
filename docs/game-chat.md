# Participant game chat

Site games have a private text conversation between their two existing guest seats.
Imported PGNs, opening-book replays, and blank analysis have no chat. Messages remain
readable after a game ends, but new sends require an active game. Guest-session
expiry still applies; knowing a challenge URL does not grant access to its chat.

Apply `017_game_chat.sql` with `npm run db:migrate` before deploying the server.
This forward migration adds only `chess.game_chat_messages` and its indexes.
Messages contain a game reference, server-derived side, UUID retry key, plain text,
timestamp, and bigint ordering cursor. No generic messaging or forum tables exist.

`GET /games/:id/chat?after=<decimal cursor>` returns at most the latest 100 messages
after that cursor, ordered oldest first, plus `canSend`. Omitting the cursor returns
the latest 100 messages. This is a recent-history window, not a bulk export or an
unbounded pagination endpoint. The browser also caps its list at 100 messages.

`POST /games/:id/chat` accepts `{ "text": "..." }`, the existing guest cookie,
`X-CSRF-Token`, and UUID `Idempotency-Key`. Text is trimmed and must contain 1–500
characters. A retry with the same game, side, key and trimmed text returns the
original message, even after the game ends. Reusing that key for different text
returns 409. A fresh send after finalization returns 409. Each side may send five
messages per rolling ten seconds; excess requests return 429 and `Retry-After: 10`.
Rate checks and inserts share the game-row transaction lock with finalization, so
they remain ordered across server processes. Chat never changes game versions,
move receipts, authoritative clock values, or the clock deadline ordering rules.

The existing participant-authorized SSE connection carries distinct `chat` events
alongside `game` events. PostgreSQL NOTIFY becomes visible only after the message
transaction commits. A chat event fetches chat history only; it does not re-read
the game. Reopening the stream, returning focus, and becoming visible fetch missed
history. While SSE is unavailable, the existing four-second fallback also refreshes
chat. Notification payloads carry only a game ID and message cursor, not message
text or guest credentials. Proxies must preserve the existing SSE configuration.
The client also recreates failed streams after four seconds if native EventSource
reconnection has not recovered them (for example, following a proxy HTTP error).
Named heartbeats every 15 seconds detect silent proxy stalls: after 35 seconds
without stream activity, the client fetches recent state and reconnects. Heartbeats
themselves do not fetch chat or the game.

Send acknowledgements are deduplicated against history. The history cursor advances
only from history responses, so a newer own-message acknowledgement cannot skip an
older opponent message. Uncertain send failures retain the retry key; editing the
draft starts a new request. Reads and sends time out after ten seconds. Messages
render as text, never HTML.

The desktop rail stays beside the board. On narrower screens it becomes a
section below the board/moves. The Hide/Show button is the only collapse control.
Hiding is local to the browser, game, and seat and survives refresh; it does not
delete history or notify the opponent.
The list follows new messages only while the reader is near its bottom. Otherwise,
a New messages control lets the reader jump down explicitly.

Current limits: only recent history is exposed; there are no attachments, exports,
moderation, public rooms, account messaging, or delivery/read receipts. Messages
remain stored with the game; no retention/deletion policy is introduced here.
