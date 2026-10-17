-- Older challenges keep their original 5+3 terms, including untimed previews.
ALTER TABLE chess.challenges
  ADD COLUMN time_control text NOT NULL DEFAULT '5+3'
    CHECK (time_control IN ('1+0', '3+0', '3+2', '5+3',
      '10+0', '10+2', '10+5', '15+0', '15+2', '15+5',
      '20+0', '20+10', '25+0', '25+10', '30+0', '30+10'));
