CREATE TABLE "user_game_link_sorts" (
	"user_id" text NOT NULL,
	"game_id" uuid NOT NULL,
	"role" text NOT NULL,
	"sort" text NOT NULL,
	CONSTRAINT "user_game_link_sorts_user_id_game_id_role_pk" PRIMARY KEY("user_id","game_id","role")
);
--> statement-breakpoint
ALTER TABLE "user_game_links" ADD COLUMN "base_position" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "user_game_links" ADD COLUMN "related_position" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "user_game_link_sorts" ADD CONSTRAINT "user_game_link_sorts_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "user_game_link_sorts" ADD CONSTRAINT "user_game_link_sorts_game_id_games_id_fk" FOREIGN KEY ("game_id") REFERENCES "public"."games"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
--
-- Fold 'remaster' links into 'remake'.
--
-- Links now come in four flavours you can add -- DLC, prequel, sequel and
-- remake/remaster -- so a rebuild and a polish share one kind. A pair linked
-- both ways round is refused by the API, so the only possible collision is
-- the same pair filed as both a remaster and a remake in the same direction;
-- the remake row is kept and the remaster row dropped rather than tripping the
-- (user, game, related, kind) unique constraint on the UPDATE below.
--
DELETE FROM "user_game_links" AS remaster
USING "user_game_links" AS remake
WHERE remaster."kind" = 'remaster'
  AND remake."kind" = 'remake'
  AND remaster."user_id" = remake."user_id"
  AND remaster."game_id" = remake."game_id"
  AND remaster."related_game_id" = remake."related_game_id";--> statement-breakpoint
UPDATE "user_game_links" SET "kind" = 'remake' WHERE "kind" = 'remaster';--> statement-breakpoint
--
-- Give existing links a hand-set order to start from.
--
-- Every section opens sorted by release date, so these numbers only show once
-- someone switches a section to custom order -- and then they should read as
-- the list they were just looking at, not as the order the links happened to
-- be made in. Each row sits in two lists (its base game's, and its related
-- game's), so it is numbered twice: by the *other* game's release date within
-- each. Unknown dates go last, as they do on screen.
--
UPDATE "user_game_links" AS l
SET "base_position" = ranked.rn
FROM (
  SELECT
    link."id",
    row_number() OVER (
      PARTITION BY link."user_id", link."game_id", link."kind"
      ORDER BY other."release_date" NULLS LAST, other."title", link."created_at"
    ) AS rn
  FROM "user_game_links" AS link
  JOIN "games" AS other ON other."id" = link."related_game_id"
) AS ranked
WHERE l."id" = ranked."id";--> statement-breakpoint
UPDATE "user_game_links" AS l
SET "related_position" = ranked.rn
FROM (
  SELECT
    link."id",
    row_number() OVER (
      PARTITION BY link."user_id", link."related_game_id", link."kind"
      ORDER BY other."release_date" NULLS LAST, other."title", link."created_at"
    ) AS rn
  FROM "user_game_links" AS link
  JOIN "games" AS other ON other."id" = link."game_id"
) AS ranked
WHERE l."id" = ranked."id";
