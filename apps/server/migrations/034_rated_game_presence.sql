CREATE TABLE chess.rated_game_presence (
  game_id uuid PRIMARY KEY REFERENCES chess.games(id) ON DELETE CASCADE,
  white_heartbeat_at timestamptz,
  black_heartbeat_at timestamptz,
  white_activity_at timestamptz,
  black_activity_at timestamptz,
  disconnected_side text CHECK (disconnected_side IN ('white', 'black')),
  grace_deadline_at timestamptz,
  confirmed_at timestamptz,
  CHECK ((disconnected_side IS NULL) = (grace_deadline_at IS NULL)),
  CHECK (confirmed_at IS NULL OR (grace_deadline_at IS NOT NULL AND confirmed_at >= grace_deadline_at))
);

CREATE INDEX rated_game_presence_confirmed_idx ON chess.rated_game_presence (confirmed_at, game_id)
  WHERE confirmed_at IS NOT NULL;
