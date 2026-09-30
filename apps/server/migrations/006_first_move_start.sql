-- Preserve readiness for saved games. Only games created after this migration
-- explicitly use the free first move and post-commit clock handoff.
ALTER TABLE chess.games
  ADD COLUMN clock_start_mode text NOT NULL DEFAULT 'readiness'
    CHECK (clock_start_mode IN ('readiness', 'first_move'));

ALTER TABLE chess.games DROP CONSTRAINT games_clock_phase_check;
ALTER TABLE chess.games ADD CONSTRAINT games_clock_phase_check
  CHECK (clock_phase IN ('legacy_untimed', 'waiting', 'awaiting_first_move',
    'running', 'handoff', 'stopped', 'flagged'));
