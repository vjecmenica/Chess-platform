CREATE TABLE chess.guest_sessions (
  id uuid PRIMARY KEY,
  token_hash bytea NOT NULL UNIQUE,
  csrf_token text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  expires_at timestamptz NOT NULL,
  CONSTRAINT guest_session_token_hash_length CHECK (octet_length(token_hash) = 32),
  CONSTRAINT guest_session_csrf_length CHECK (length(csrf_token) = 64),
  CONSTRAINT guest_session_expiry CHECK (expires_at > created_at)
);

CREATE TABLE chess.challenges (
  id uuid PRIMARY KEY,
  creator_guest_id uuid NOT NULL REFERENCES chess.guest_sessions(id),
  create_request_id uuid NOT NULL,
  acceptor_guest_id uuid REFERENCES chess.guest_sessions(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  accepted_at timestamptz,
  CONSTRAINT challenge_distinct_seats CHECK (acceptor_guest_id IS NULL OR acceptor_guest_id <> creator_guest_id),
  CONSTRAINT challenge_acceptance_consistent CHECK ((acceptor_guest_id IS NULL) = (accepted_at IS NULL)),
  CONSTRAINT challenge_create_retry UNIQUE (creator_guest_id, create_request_id)
);

CREATE INDEX challenges_acceptor_guest_id_idx ON chess.challenges (acceptor_guest_id)
  WHERE acceptor_guest_id IS NOT NULL;
