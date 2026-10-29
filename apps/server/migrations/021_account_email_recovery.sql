ALTER TABLE chess.accounts
  ADD COLUMN verified_email text,
  ADD COLUMN pending_email text;
CREATE UNIQUE INDEX accounts_verified_email_idx ON chess.accounts (verified_email)
  WHERE verified_email IS NOT NULL;

-- Only digests are retained. Reissuing replaces the previous token for that purpose.
CREATE TABLE chess.account_email_tokens (
  account_id uuid NOT NULL REFERENCES chess.accounts(id),
  purpose text NOT NULL CHECK (purpose IN ('verify', 'reset')),
  token_hash bytea NOT NULL UNIQUE CHECK (octet_length(token_hash) = 32),
  email text NOT NULL,
  expires_at timestamptz NOT NULL,
  PRIMARY KEY (account_id, purpose)
);
CREATE INDEX account_email_tokens_expiry_idx ON chess.account_email_tokens (expires_at);
