ALTER TABLE chess.game_chat_messages ADD COLUMN kind text NOT NULL DEFAULT 'user' CHECK (kind IN ('user','system'));
ALTER TABLE chess.game_chat_messages ADD COLUMN event_key text;
CREATE UNIQUE INDEX game_chat_event_key ON chess.game_chat_messages(game_id,event_key) WHERE event_key IS NOT NULL;
CREATE TABLE chess.game_rematches (
 id uuid PRIMARY KEY, game_id uuid NOT NULL REFERENCES chess.games(id), sender_side text NOT NULL CHECK(sender_side IN ('white','black')),
 sender_seat uuid NOT NULL REFERENCES chess.guest_sessions(id), request_id uuid NOT NULL,
 status text NOT NULL CHECK(status IN ('pending','accepted','declined','expired')),
 created_at timestamptz NOT NULL DEFAULT clock_timestamp(), expires_at timestamptz NOT NULL DEFAULT clock_timestamp()+interval '2 minutes',
 new_game_id uuid REFERENCES chess.challenges(id), UNIQUE(game_id,sender_side,request_id)
);
CREATE UNIQUE INDEX game_rematch_pending ON chess.game_rematches(game_id) WHERE status='pending';
CREATE INDEX game_rematch_history ON chess.game_rematches(game_id,created_at DESC,id);
CREATE FUNCTION chess.draw_chat_event() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE message_id bigint; phrase text;
BEGIN
 phrase := CASE NEW.kind WHEN 'offer_draw' THEN 'offered a draw.' WHEN 'accept_draw' THEN 'accepted the draw offer.' WHEN 'decline_draw' THEN 'declined the draw offer.' ELSE NULL END;
 IF phrase IS NOT NULL THEN
 INSERT INTO chess.game_chat_messages(game_id,sender_side,request_id,body,kind,event_key)
 VALUES(NEW.game_id,NEW.side,gen_random_uuid(),phrase,'system','draw:'||NEW.version) RETURNING id INTO message_id;
 PERFORM pg_notify('chess_game_updates',json_build_object('id',NEW.game_id,'chatId',message_id::text)::text);
 END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER draw_chat_event AFTER INSERT ON chess.game_actions FOR EACH ROW EXECUTE FUNCTION chess.draw_chat_event();
