-- Preferences belong to the original game seat, including account-owned seats.
CREATE TABLE chess.game_chat_preferences (
  game_id uuid NOT NULL REFERENCES chess.games(id),
  side text NOT NULL CHECK (side IN ('white', 'black')),
  muted boolean NOT NULL DEFAULT false,
  version integer NOT NULL DEFAULT 0 CHECK (version >= 0),
  PRIMARY KEY (game_id, side)
);
-- No-op commands need receipts too: an old retry must not toggle a later state.
CREATE TABLE chess.game_chat_mute_receipts (
  game_id uuid NOT NULL REFERENCES chess.games(id),
  side text NOT NULL CHECK (side IN ('white', 'black')),
  request_id uuid NOT NULL,
  muted boolean NOT NULL,
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  PRIMARY KEY (game_id, side, request_id)
);
-- Preserve old duplicates. The game lock serializes future checks and inserts.
CREATE INDEX game_chat_preset_usage ON chess.game_chat_messages (game_id, sender_side, body)
  WHERE kind = 'user' AND body IN ('good game', 'well played', 'thank you', 'got to go', 'goodbye');
