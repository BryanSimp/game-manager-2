-- "Display on game": show a game's custom estimate time on its library card.
-- Off for every existing row -- nobody has asked for it yet, and a custom time
-- typed as a target ("just the first act") shouldn't start replacing the
-- game's real length on the card because of an upgrade.
ALTER TABLE "user_games" ADD COLUMN "progress_custom_display" boolean DEFAULT false NOT NULL;
