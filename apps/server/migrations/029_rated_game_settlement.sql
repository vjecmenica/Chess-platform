ALTER TABLE chess.games
  ADD COLUMN rated boolean NOT NULL DEFAULT false,
  ADD COLUMN rated_white_account_id uuid REFERENCES chess.accounts(id),
  ADD COLUMN rated_black_account_id uuid REFERENCES chess.accounts(id),
  ADD COLUMN rating_pool text CHECK (rating_pool IN ('bullet', 'blitz', 'rapid', 'classical')),
  ADD CONSTRAINT game_rating_terms CHECK (
    (NOT rated AND rated_white_account_id IS NULL AND rated_black_account_id IS NULL AND rating_pool IS NULL)
    OR (rated AND rated_white_account_id IS NOT NULL AND rated_black_account_id IS NOT NULL
      AND rated_white_account_id <> rated_black_account_id AND rating_pool IS NOT NULL
      AND clock_mode = 'five_plus_three')
  );

CREATE FUNCTION chess.check_game_rating_terms() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'UPDATE' THEN
    IF ROW(NEW.rated, NEW.rated_white_account_id, NEW.rated_black_account_id, NEW.rating_pool)
      IS DISTINCT FROM ROW(OLD.rated, OLD.rated_white_account_id, OLD.rated_black_account_id, OLD.rating_pool) THEN
      RAISE check_violation USING MESSAGE = 'Game rating terms are immutable';
    END IF;
  ELSIF NEW.rated THEN
    -- Keep this database check aligned with ratingPoolByTimeControl in @chess/contracts.
    IF NEW.status NOT IN ('waiting', 'active') OR NOT EXISTS (
      SELECT 1 FROM chess.challenges c
      JOIN chess.guest_sessions w ON w.id = c.creator_guest_id
      JOIN chess.guest_sessions b ON b.id = c.acceptor_guest_id
      WHERE c.id = NEW.id AND w.account_id = NEW.rated_white_account_id
        AND b.account_id = NEW.rated_black_account_id
        AND NEW.rating_pool = CASE
          WHEN c.time_control = '1+0' THEN 'bullet'
          WHEN c.time_control IN ('3+0', '3+2', '5+3') THEN 'blitz'
          WHEN c.time_control IN ('10+0', '10+2', '10+5', '15+0', '15+2', '15+5') THEN 'rapid'
          WHEN c.time_control IN ('20+0', '20+10', '25+0', '25+10', '30+0', '30+10') THEN 'classical'
        END
    ) THEN
      RAISE check_violation USING MESSAGE = 'Rated games require matching registered seats and a supported preset at creation';
    END IF;
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER game_rating_terms_guard
  BEFORE INSERT OR UPDATE OF rated, rated_white_account_id, rated_black_account_id, rating_pool
  ON chess.games FOR EACH ROW EXECUTE FUNCTION chess.check_game_rating_terms();

CREATE TABLE chess.game_rating_settlements (
  game_id uuid PRIMARY KEY REFERENCES chess.games(id),
  pool text NOT NULL CHECK (pool IN ('bullet', 'blitz', 'rapid', 'classical')),
  white_account_id uuid NOT NULL,
  black_account_id uuid NOT NULL CHECK (black_account_id <> white_account_id),
  final_result jsonb NOT NULL,
  white_before jsonb NOT NULL,
  white_after jsonb NOT NULL,
  black_before jsonb NOT NULL,
  black_after jsonb NOT NULL,
  settled_at timestamptz NOT NULL,
  policy_version text NOT NULL
);

CREATE FUNCTION chess.require_game_rating_settlement() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM chess.game_rating_settlements WHERE game_id = NEW.id AND pool = NEW.rating_pool
      AND white_account_id = NEW.rated_white_account_id AND black_account_id = NEW.rated_black_account_id
      AND final_result = NEW.result
  ) THEN
    RAISE check_violation USING MESSAGE = 'A finished rated game requires an atomic rating settlement';
  END IF;
  RETURN NULL;
END;
$$;

CREATE CONSTRAINT TRIGGER finished_game_rating_settlement
  AFTER UPDATE ON chess.games DEFERRABLE INITIALLY DEFERRED
  FOR EACH ROW WHEN (NEW.rated AND NEW.status = 'finished')
  EXECUTE FUNCTION chess.require_game_rating_settlement();
