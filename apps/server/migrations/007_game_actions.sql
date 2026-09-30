ALTER TABLE chess.games
  ADD COLUMN draw_offer text CHECK (draw_offer IN ('white', 'black')),
  ADD COLUMN resignation_witness jsonb;

CREATE TABLE chess.game_actions (
  game_id uuid NOT NULL REFERENCES chess.games(id),
  version integer NOT NULL CHECK (version > 0),
  after_ply integer NOT NULL CHECK (after_ply >= 0),
  side text NOT NULL CHECK (side IN ('white', 'black')),
  kind text NOT NULL CHECK (kind IN ('resign', 'offer_draw', 'accept_draw', 'decline_draw')),
  PRIMARY KEY (game_id, version)
);

ALTER TABLE chess.game_move_receipts
  ADD COLUMN kind text NOT NULL DEFAULT 'move'
    CHECK (kind IN ('move', 'resign', 'offer_draw', 'accept_draw', 'decline_draw'));
