ALTER TABLE chess.game_moves
  ADD COLUMN remaining_ms_after_move integer
  CHECK (remaining_ms_after_move >= 0);
