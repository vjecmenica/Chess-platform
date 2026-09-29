CREATE TABLE chess.games (
  id uuid PRIMARY KEY REFERENCES chess.challenges(id),
  starting_fen text NOT NULL,
  fen text NOT NULL,
  side_to_move text NOT NULL CHECK (side_to_move IN ('white', 'black')),
  status text NOT NULL CHECK (status IN ('active', 'finished')),
  result jsonb,
  version integer NOT NULL DEFAULT 0 CHECK (version >= 0),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT game_result_matches_status CHECK ((status = 'active') = (result IS NULL))
);

CREATE TABLE chess.game_moves (
  game_id uuid NOT NULL REFERENCES chess.games(id),
  ply integer NOT NULL CHECK (ply > 0),
  record jsonb NOT NULL,
  PRIMARY KEY (game_id, ply)
);

CREATE TABLE chess.game_move_receipts (
  game_id uuid NOT NULL REFERENCES chess.games(id),
  guest_id uuid NOT NULL REFERENCES chess.guest_sessions(id),
  request_id uuid NOT NULL,
  payload jsonb NOT NULL,
  response jsonb NOT NULL,
  PRIMARY KEY (game_id, guest_id, request_id)
);

-- Existing accepted challenges receive the same standard-start game as new acceptances.
INSERT INTO chess.games (id, starting_fen, fen, side_to_move, status)
SELECT id,
  'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1',
  'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1',
  'white', 'active'
FROM chess.challenges
WHERE acceptor_guest_id IS NOT NULL;
