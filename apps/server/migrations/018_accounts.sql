CREATE TABLE chess.accounts (
  id uuid PRIMARY KEY,
  username text NOT NULL UNIQUE CHECK (username ~ '^[a-z0-9_]{3,24}$'),
  password_hash text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE chess.guest_sessions ADD COLUMN account_id uuid REFERENCES chess.accounts(id);
CREATE INDEX guest_sessions_account_idx ON chess.guest_sessions (account_id) WHERE account_id IS NOT NULL;

CREATE TABLE chess.account_sessions (
  token_hash bytea PRIMARY KEY CHECK (octet_length(token_hash) = 32),
  account_id uuid NOT NULL REFERENCES chess.accounts(id),
  guest_id uuid NOT NULL REFERENCES chess.guest_sessions(id),
  expires_at timestamptz NOT NULL
);
CREATE INDEX account_sessions_expiry_idx ON chess.account_sessions (expires_at);

CREATE TABLE chess.account_auth_limits (
  key_hash bytea PRIMARY KEY,
  attempts integer NOT NULL CHECK (attempts > 0),
  resets_at timestamptz NOT NULL
);
CREATE INDEX account_auth_limits_expiry_idx ON chess.account_auth_limits (resets_at);
