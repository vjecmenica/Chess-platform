-- Account archives traverse original guest seats in stable chronological order.
CREATE INDEX challenges_creator_chronological_idx
  ON chess.challenges (creator_guest_id, created_at DESC, id DESC);
CREATE INDEX challenges_acceptor_chronological_idx
  ON chess.challenges (acceptor_guest_id, created_at DESC, id DESC)
  WHERE acceptor_guest_id IS NOT NULL;
