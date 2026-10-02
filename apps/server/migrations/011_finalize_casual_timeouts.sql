-- Pending timeout rows were inconclusive under the old bounded-search flow.
-- They were not proven no-mate draws; those were already finished at flag fall.
-- Apply the explicit casual flag-forfeit policy and notify connected players.
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM chess.games
    WHERE status = 'pending_adjudication' AND pending->>'kind' = 'timeout'
      AND (flagged_side IS NULL OR flagged_side NOT IN ('white', 'black')
        OR flagged_at IS NULL)) THEN
    RAISE EXCEPTION 'A pending timeout lacks its saved flag and cannot be migrated';
  END IF;
END $$;

WITH finished AS (
  UPDATE chess.games
  SET status = 'finished',
      result = jsonb_build_object('outcome', 'win',
        'winner', CASE flagged_side WHEN 'white' THEN 'black' ELSE 'white' END,
        'reason', 'timeout', 'flaggedSide', flagged_side,
        'deadlineMs', (extract(epoch FROM flagged_at) * 1000)::bigint),
      pending = NULL,
      timeout_adjudicated_at = now(),
      version = version + 1,
      updated_at = now()
  WHERE status = 'pending_adjudication' AND pending->>'kind' = 'timeout'
  RETURNING id, version
)
SELECT pg_notify('chess_game_updates', json_build_object('id', id, 'version', version)::text)
FROM finished;
