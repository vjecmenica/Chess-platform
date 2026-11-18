-- The account archive looks up Rated games by immutable participant ID.
CREATE INDEX games_rated_white_account_idx ON chess.games (rated_white_account_id) WHERE rated;
CREATE INDEX games_rated_black_account_idx ON chess.games (rated_black_account_id) WHERE rated;
