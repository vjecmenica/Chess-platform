-- Independent of chat, game events, and opening explorer source data.
CREATE TABLE chess.game_notes (
  game_id uuid NOT NULL REFERENCES chess.games(id),
  owner text NOT NULL,
  body text NOT NULL CHECK (char_length(body) <= 10000),
  version integer NOT NULL CHECK (version > 0),
  PRIMARY KEY (game_id, owner)
);
