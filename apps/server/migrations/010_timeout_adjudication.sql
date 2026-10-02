ALTER TABLE chess.games
  ADD COLUMN timeout_search_exhausted_at timestamptz,
  ADD COLUMN timeout_adjudicated_at timestamptz,
  ADD COLUMN timeout_search_retry_after timestamptz;

CREATE INDEX games_pending_timeout_search_idx ON chess.games (id)
  WHERE status = 'pending_adjudication' AND timeout_search_exhausted_at IS NULL;
