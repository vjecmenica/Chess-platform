-- Existing first_move and readiness games retain their original clock rules.
ALTER TABLE chess.games DROP CONSTRAINT games_clock_start_mode_check;
ALTER TABLE chess.games ADD CONSTRAINT games_clock_start_mode_check
  CHECK (clock_start_mode IN ('readiness', 'first_move', 'first_move_grace'));

ALTER TABLE chess.games DROP CONSTRAINT games_status_check;
ALTER TABLE chess.games ADD CONSTRAINT games_status_check
  CHECK (status IN ('waiting', 'active', 'pending_adjudication', 'finished', 'aborted'));
ALTER TABLE chess.games DROP CONSTRAINT game_result_matches_status;
ALTER TABLE chess.games ADD CONSTRAINT game_result_matches_status
  CHECK ((status IN ('finished', 'aborted')) = (result IS NOT NULL));

ALTER TABLE chess.games
  ADD COLUMN white_first_move_deadline_at timestamptz,
  ADD COLUMN black_first_move_deadline_at timestamptz;

CREATE INDEX games_due_first_move_grace_idx ON chess.games
  (white_first_move_deadline_at, black_first_move_deadline_at)
  WHERE status = 'active' AND clock_start_mode = 'first_move_grace';
