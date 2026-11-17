ALTER TABLE chess.accounts ADD COLUMN avatar_key uuid UNIQUE;

-- An upload is staged here before storing bytes. Replacing/removing an avatar
-- queues its old key in the same transaction that updates the account.
CREATE TABLE chess.avatar_cleanup (
  object_key uuid PRIMARY KEY,
  staged boolean NOT NULL DEFAULT false,
  delete_after timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX avatar_cleanup_due_idx ON chess.avatar_cleanup (delete_after);
