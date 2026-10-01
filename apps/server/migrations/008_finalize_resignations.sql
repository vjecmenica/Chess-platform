-- Earlier releases froze inconclusive resignations. Under the casual-game
-- concession policy they become wins; proven no-mate draws were already final.
UPDATE chess.games
SET status = 'finished',
    result = jsonb_build_object('outcome', 'win',
      'winner', CASE pending->>'resigningSide' WHEN 'white' THEN 'black' ELSE 'white' END,
      'reason', 'resignation'),
    pending = NULL,
    clock_phase = CASE WHEN clock_mode = 'five_plus_three' THEN 'stopped' ELSE clock_phase END,
    turn_started_at = NULL,
    deadline_at = NULL,
    updated_at = now()
WHERE status = 'pending_adjudication' AND pending->>'kind' = 'resignation';
