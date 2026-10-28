-- A durable account-owned seat identity, separate from every browser guest bearer.
-- Existing browser guests and historical challenge seats are unchanged.
ALTER TABLE chess.guest_sessions ADD COLUMN account_play_seat boolean NOT NULL DEFAULT false;
ALTER TABLE chess.guest_sessions ADD CONSTRAINT account_play_seat_owner
  CHECK (NOT account_play_seat OR account_id IS NOT NULL);
CREATE UNIQUE INDEX guest_sessions_account_play_seat_idx
  ON chess.guest_sessions (account_id) WHERE account_play_seat;
