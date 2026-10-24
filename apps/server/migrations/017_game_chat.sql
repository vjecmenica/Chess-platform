CREATE TABLE chess.game_chat_messages (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  game_id uuid NOT NULL REFERENCES chess.games(id),
  sender_side text NOT NULL CHECK (sender_side IN ('white', 'black')),
  request_id uuid NOT NULL,
  body text NOT NULL CHECK (char_length(body) BETWEEN 1 AND 500 AND body = btrim(body)),
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  UNIQUE (game_id, sender_side, request_id)
);

CREATE INDEX game_chat_history_idx ON chess.game_chat_messages (game_id, id DESC);
CREATE INDEX game_chat_rate_idx ON chess.game_chat_messages (game_id, sender_side, created_at DESC);
