ALTER TABLE chess.challenges
  ADD COLUMN rated boolean NOT NULL DEFAULT false,
  ADD COLUMN rated_creator_account_id uuid REFERENCES chess.accounts(id),
  ADD CONSTRAINT challenge_rated_creator CHECK (rated = (rated_creator_account_id IS NOT NULL));

CREATE FUNCTION chess.check_challenge_rating_terms() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'UPDATE' THEN
    IF ROW(NEW.rated, NEW.rated_creator_account_id) IS DISTINCT FROM ROW(OLD.rated, OLD.rated_creator_account_id)
      OR (OLD.rated AND (ROW(NEW.creator_guest_id, NEW.time_control) IS DISTINCT FROM ROW(OLD.creator_guest_id, OLD.time_control)
        OR (OLD.acceptor_guest_id IS NOT NULL AND NEW.acceptor_guest_id IS DISTINCT FROM OLD.acceptor_guest_id))) THEN
      RAISE check_violation USING MESSAGE = 'Challenge rating terms are immutable';
    END IF;
  ELSIF NEW.rated AND NOT EXISTS (
    SELECT 1 FROM chess.guest_sessions WHERE id = NEW.creator_guest_id
      AND account_play_seat AND account_id = NEW.rated_creator_account_id
  ) THEN
    RAISE check_violation USING MESSAGE = 'A rated challenge requires an account-owned creator seat';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER challenge_rating_terms_guard
  BEFORE INSERT OR UPDATE OF rated, rated_creator_account_id, creator_guest_id, time_control, acceptor_guest_id
  ON chess.challenges FOR EACH ROW EXECUTE FUNCTION chess.check_challenge_rating_terms();
