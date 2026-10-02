ALTER TABLE chess.games
  ADD COLUMN claim_draw_offer text CHECK (claim_draw_offer IN ('white', 'black'));

ALTER TABLE chess.game_actions
  ADD COLUMN payload jsonb NOT NULL DEFAULT '{}'::jsonb;

ALTER TABLE chess.game_actions DROP CONSTRAINT game_actions_kind_check;
ALTER TABLE chess.game_actions ADD CONSTRAINT game_actions_kind_check
  CHECK (kind IN ('resign', 'offer_draw', 'accept_draw', 'decline_draw', 'claim_draw'));

ALTER TABLE chess.game_move_receipts DROP CONSTRAINT game_move_receipts_kind_check;
ALTER TABLE chess.game_move_receipts ADD CONSTRAINT game_move_receipts_kind_check
  CHECK (kind IN ('move', 'resign', 'offer_draw', 'accept_draw', 'decline_draw', 'claim_draw'));
