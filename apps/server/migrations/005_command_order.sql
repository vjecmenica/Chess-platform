-- A move is durably admitted before it competes for the game row. Pending receipts
-- survive a worker restart and are replayed in receipt order.
ALTER TABLE chess.game_move_receipts
  ALTER COLUMN response DROP NOT NULL,
  ALTER COLUMN status_code DROP NOT NULL,
  ADD COLUMN admission_id bigint GENERATED ALWAYS AS IDENTITY,
  ADD COLUMN applied boolean NOT NULL DEFAULT false,
  ADD CONSTRAINT move_receipt_completion CHECK (
    (response IS NULL AND status_code IS NULL)
    OR (response IS NOT NULL AND status_code IS NOT NULL)
  );

CREATE UNIQUE INDEX game_move_receipt_admission_idx
  ON chess.game_move_receipts (admission_id);
CREATE INDEX game_move_receipt_pending_idx
  ON chess.game_move_receipts (game_id, received_at, admission_id)
  WHERE response IS NULL;

-- Each live server advertises the latest instant for which it has durably
-- admitted or dismissed every HTTP arrival. A flag waits for every live server.
CREATE TABLE chess.clock_ingress_watermarks (
  instance_id uuid PRIMARY KEY,
  safe_through_ms bigint NOT NULL CHECK (safe_through_ms >= 0),
  lease_until timestamptz NOT NULL
);

ALTER TABLE chess.games DROP CONSTRAINT games_clock_phase_check;
ALTER TABLE chess.games ADD CONSTRAINT games_clock_phase_check
  CHECK (clock_phase IN ('legacy_untimed', 'waiting', 'running', 'handoff', 'stopped', 'flagged'));
