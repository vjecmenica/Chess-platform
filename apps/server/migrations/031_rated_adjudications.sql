CREATE TABLE chess.rated_adjudications (
  game_id uuid PRIMARY KEY REFERENCES chess.games(id) ON DELETE CASCADE,
  pending_version integer NOT NULL CHECK (pending_version > 0),
  kind text NOT NULL CHECK (kind IN ('resignation', 'timeout')),
  status text NOT NULL DEFAULT 'queued' CHECK (status IN ('queued', 'processing', 'retry', 'review', 'resolved')),
  attempts integer NOT NULL DEFAULT 0 CHECK (attempts >= 0),
  due_at timestamptz DEFAULT clock_timestamp(),
  lease_token uuid,
  diagnostic text,
  nodes_visited integer CHECK (nodes_visited >= 0),
  search_ms integer CHECK (search_ms >= 0),
  mate_line jsonb,
  decided_by text,
  decided_at timestamptz,
  policy_version text,
  CHECK ((status IN ('queued', 'processing', 'retry')) = (due_at IS NOT NULL)),
  CHECK ((status = 'processing') = (lease_token IS NOT NULL)),
  CHECK ((status = 'resolved') = (mate_line IS NOT NULL)
    AND (status = 'resolved') = (decided_by IS NOT NULL)
    AND (status = 'resolved') = (decided_at IS NOT NULL)
    AND (status = 'resolved') = (policy_version IS NOT NULL)),
  CHECK (mate_line IS NULL OR jsonb_typeof(mate_line) = 'array')
);

CREATE INDEX rated_adjudications_due_idx ON chess.rated_adjudications (due_at, game_id)
  WHERE due_at IS NOT NULL;

INSERT INTO chess.rated_adjudications (game_id, pending_version, kind)
SELECT id, version, pending->>'kind' FROM chess.games WHERE rated AND status = 'pending_adjudication';
