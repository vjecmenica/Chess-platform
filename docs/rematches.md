# Private rematches and offer history

Only the original participants of a finished site game may offer a rematch. Offers
expire after two minutes without acceptance; no online presence is implied. The
recipient explicitly accepts or declines. Acceptance atomically creates one new
casual Standard game with swapped colors, the saved time control, and the normal
30-second opening deadline. New account play seats follow existing authentication
rules; earlier guest games are never claimed retroactively. Duplicate offer keys
and repeated responses cannot create another game. At most one offer is pending,
with five offers per original game per ten minutes. Expired unlinked guest seats
cannot receive new offers. Returning to an old accepted game shows an Open game
link; tabs that observed a pending offer navigate on acceptance.

New opponent matchmaking remains unavailable. The disabled New time-control
button is a placeholder, not a challenge-link generator.

Migration 023 adds participant-bound rematch offers and typed, durable system chat
entries. Accepted draw actions append their system entry in the same transaction
via a database trigger; declining by playing a move and rematch state changes
append their entries in their command transaction.
Notifications are commit-delivered through the existing chat SSE signal, without
incrementing game move versions. UI reconnect/polling restores both offer state
and bounded chronological chat history. Old draw actions have no recorded event
timestamp, so the migration does not invent historical chat timestamps for them.
System text cannot be submitted through the user chat endpoint. Neither notes nor
messages become public. Numeric unread counts exclude own entries, deduplicate
IDs, and respect the per-browser game/side read watermark.
The reconnect window remains the latest 100 entries; unread counts describe that
bounded recovered history, rather than promising an unlimited offline backlog.

Apply the forward migration during normal deployment. Do not run migrations or
imports against a busy explorer database without the usual operational planning.
Integration validation uses TEST_DATABASE_URL only.
