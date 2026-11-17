CREATE TABLE chess.account_game_favorites (
  account_id uuid NOT NULL REFERENCES chess.accounts(id) ON DELETE CASCADE,
  game_id uuid NOT NULL REFERENCES chess.games(id) ON DELETE CASCADE,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (account_id, game_id)
);

CREATE INDEX account_game_favorites_game_idx ON chess.account_game_favorites (game_id);
