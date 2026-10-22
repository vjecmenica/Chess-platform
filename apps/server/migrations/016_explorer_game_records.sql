-- Source PGNs remain private; public replay returns structured main-line data only.
CREATE TABLE chess.explorer_records (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  fingerprint bytea NOT NULL UNIQUE REFERENCES chess.explorer_games(fingerprint),
  original_pgn text NOT NULL,
  tags jsonb NOT NULL CHECK (jsonb_typeof(tags) = 'object'),
  white_name text, black_name text, white_rating integer, black_rating integer,
  white_fide_id text, black_fide_id text,
  result text NOT NULL CHECK (result IN ('1-0', '0-1', '1/2-1/2')),
  game_date text, event text, site text, round text, eco text, opening text, time_control text
);
CREATE TABLE chess.explorer_game_positions (
  position text NOT NULL,
  game_id bigint NOT NULL REFERENCES chess.explorer_records(id),
  ply integer NOT NULL CHECK (ply BETWEEN 0 AND 80),
  uci text CHECK (uci ~ '^[a-h][1-8][a-h][1-8][qrbn]?$'),
  PRIMARY KEY (position, game_id)
);
CREATE INDEX explorer_game_positions_game ON chess.explorer_game_positions(game_id);
-- Administrative reruns backfill earlier aggregate-only imports without recounting.
UPDATE chess.explorer_imports SET status = 'failed' WHERE status = 'complete';
