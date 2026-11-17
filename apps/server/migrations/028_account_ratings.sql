CREATE TABLE chess.account_ratings (
  account_id uuid NOT NULL REFERENCES chess.accounts(id) ON DELETE CASCADE,
  pool text NOT NULL CHECK (pool IN ('bullet', 'blitz', 'rapid', 'classical')),
  rating double precision NOT NULL CHECK (rating > '-Infinity' AND rating < 'Infinity'),
  rd double precision NOT NULL CHECK (rd > 0 AND rd <= 350),
  volatility double precision NOT NULL CHECK (volatility > 0 AND volatility < 'Infinity'),
  rated_games integer NOT NULL CHECK (rated_games >= 0),
  last_rated_at timestamptz,
  CHECK ((rated_games = 0) = (last_rated_at IS NULL)),
  CHECK (last_rated_at BETWEEN 'epoch'::timestamptz AND '275760-09-13 00:00:00+00'::timestamptz),
  PRIMARY KEY (account_id, pool)
);
