ALTER TABLE chess.games DROP CONSTRAINT game_result_matches_status;
ALTER TABLE chess.games DROP CONSTRAINT games_status_check;
ALTER TABLE chess.games ADD CONSTRAINT games_status_check
  CHECK (status IN ('waiting', 'active', 'pending_adjudication', 'finished'));
ALTER TABLE chess.games ADD CONSTRAINT game_result_matches_status
  CHECK ((status = 'finished') = (result IS NOT NULL));

-- Earlier HTTP-preview games keep their original untimed rules. New games start waiting for both guests.
ALTER TABLE chess.games
  ADD COLUMN clock_mode text NOT NULL DEFAULT 'legacy_untimed'
    CHECK (clock_mode IN ('legacy_untimed', 'five_plus_three')),
  ADD COLUMN clock_phase text NOT NULL DEFAULT 'legacy_untimed'
    CHECK (clock_phase IN ('legacy_untimed', 'waiting', 'running', 'stopped', 'flagged')),
  ADD COLUMN ready_white boolean NOT NULL DEFAULT false,
  ADD COLUMN ready_black boolean NOT NULL DEFAULT false,
  ADD COLUMN white_remaining_ms integer NOT NULL DEFAULT 300000 CHECK (white_remaining_ms >= 0),
  ADD COLUMN black_remaining_ms integer NOT NULL DEFAULT 300000 CHECK (black_remaining_ms >= 0),
  ADD COLUMN turn_started_at timestamptz,
  ADD COLUMN deadline_at timestamptz,
  ADD COLUMN flagged_side text CHECK (flagged_side IN ('white', 'black')),
  ADD COLUMN flagged_at timestamptz,
  ADD COLUMN pending jsonb,
  ADD COLUMN timeout_witness jsonb;

ALTER TABLE chess.game_move_receipts
  ADD COLUMN received_at timestamptz,
  ADD COLUMN status_code integer NOT NULL DEFAULT 200 CHECK (status_code BETWEEN 200 AND 599);

CREATE INDEX games_due_clock_idx ON chess.games (deadline_at)
  WHERE clock_mode = 'five_plus_three' AND clock_phase = 'running';
