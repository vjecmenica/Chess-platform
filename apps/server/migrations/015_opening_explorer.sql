-- Private import bookkeeping contains fingerprints, never source game text.
CREATE TABLE chess.explorer_config (
  singleton boolean PRIMARY KEY DEFAULT true CHECK (singleton),
  max_plies integer NOT NULL CHECK (max_plies BETWEEN 1 AND 80),
  identity_version integer NOT NULL DEFAULT 1 CHECK (identity_version = 1)
);
CREATE TABLE chess.explorer_imports (
  checksum text PRIMARY KEY CHECK (length(checksum) = 64),
  source_name text NOT NULL,
  status text NOT NULL CHECK (status IN ('running', 'complete', 'failed')),
  processed bigint NOT NULL DEFAULT 0,
  accepted bigint NOT NULL DEFAULT 0,
  skipped bigint NOT NULL DEFAULT 0,
  invalid bigint NOT NULL DEFAULT 0,
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE chess.explorer_games (
  fingerprint bytea PRIMARY KEY CHECK (octet_length(fingerprint) = 32)
);
CREATE TABLE chess.explorer_moves (
  position text NOT NULL,
  uci text NOT NULL CHECK (uci ~ '^[a-h][1-8][a-h][1-8][qrbn]?$'),
  white bigint NOT NULL CHECK (white >= 0),
  draws bigint NOT NULL CHECK (draws >= 0),
  black bigint NOT NULL CHECK (black >= 0),
  PRIMARY KEY (position, uci)
);
