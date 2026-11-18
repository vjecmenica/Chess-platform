ALTER TABLE chess.games
  ADD COLUMN resignation_policy text NOT NULL DEFAULT 'casual_concession'
    CHECK (resignation_policy IN ('casual_concession', 'fide_proof_required')),
  ADD COLUMN timeout_policy text NOT NULL DEFAULT 'casual_flag_forfeit'
    CHECK (timeout_policy IN ('casual_flag_forfeit', 'fide_proof_required'));

-- Preserve the rules used to record existing terminal events and pending decisions.
UPDATE chess.games
SET resignation_policy = 'fide_proof_required', timeout_policy = 'fide_proof_required'
WHERE rated AND status IN ('finished', 'aborted', 'pending_adjudication');

ALTER TABLE chess.rated_adjudications ADD CONSTRAINT rated_resignation_concession_evidence_check
  CHECK (policy_version IS DISTINCT FROM 'rated-resignation-concession-v1'
    OR (kind = 'resignation' AND mate_line = '[]'::jsonb AND decided_by LIKE 'operator:_%'));
