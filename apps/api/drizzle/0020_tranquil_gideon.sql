CREATE TABLE "user_time_to_beat" (
	"user_id" text NOT NULL,
	"game_id" uuid NOT NULL,
	"main_seconds" integer,
	"main_extra_seconds" integer,
	"completionist_seconds" integer,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "user_time_to_beat_user_id_game_id_pk" PRIMARY KEY("user_id","game_id")
);
--> statement-breakpoint
CREATE TABLE "collection_votes" (
	"collection_id" uuid NOT NULL,
	"user_id" text NOT NULL,
	"value" smallint NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "collection_votes_collection_id_user_id_pk" PRIMARY KEY("collection_id","user_id")
);
--> statement-breakpoint
CREATE TABLE "checklist_votes" (
	"template_id" uuid NOT NULL,
	"user_id" text NOT NULL,
	"value" smallint NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "checklist_votes_template_id_user_id_pk" PRIMARY KEY("template_id","user_id")
);
--> statement-breakpoint
ALTER TABLE "checklist_templates" ALTER COLUMN "kind" DROP DEFAULT;--> statement-breakpoint
ALTER TABLE "checklist_templates" ADD COLUMN "position" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "user_time_to_beat" ADD CONSTRAINT "user_time_to_beat_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "user_time_to_beat" ADD CONSTRAINT "user_time_to_beat_game_id_games_id_fk" FOREIGN KEY ("game_id") REFERENCES "public"."games"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "collection_votes" ADD CONSTRAINT "collection_votes_collection_id_collections_id_fk" FOREIGN KEY ("collection_id") REFERENCES "public"."collections"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "collection_votes" ADD CONSTRAINT "collection_votes_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "checklist_votes" ADD CONSTRAINT "checklist_votes_template_id_checklist_templates_id_fk" FOREIGN KEY ("template_id") REFERENCES "public"."checklist_templates"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "checklist_votes" ADD CONSTRAINT "checklist_votes_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "user_time_to_beat_game_idx" ON "user_time_to_beat" USING btree ("game_id");--> statement-breakpoint
CREATE INDEX "collection_votes_collection_idx" ON "collection_votes" USING btree ("collection_id");--> statement-breakpoint
CREATE INDEX "checklist_votes_template_idx" ON "checklist_votes" USING btree ("template_id");--> statement-breakpoint
CREATE INDEX "user_games_game_idx" ON "user_games" USING btree ("game_id");--> statement-breakpoint
CREATE INDEX "collection_games_game_idx" ON "collection_games" USING btree ("game_id");--> statement-breakpoint
--
-- Give a user's existing lists for a game an order.
--
-- Until now there was no order to have: the UI showed exactly one list per
-- kind and picked the oldest when a game had duplicates. Number them
-- oldest-first so that rule survives, with the main story list pulled to the
-- front of its game -- that's where the Progress tab renders it anyway.
-- Guarded on position = 0 so it can't scramble an order set by hand.
--
UPDATE "checklist_templates" AS t
SET "position" = ranked.rn
FROM (
  SELECT
    "id",
    row_number() OVER (
      PARTITION BY "author_user_id", "game_id"
      ORDER BY ("kind" = 'missions') DESC, "created_at", "id"
    ) AS rn
  FROM "checklist_templates"
) AS ranked
WHERE t."id" = ranked."id"
  AND t."position" = 0;--> statement-breakpoint
--
-- Fold 'completion' lists into 'side_quests'.
--
-- The two kinds only ever differed in which panel rendered them: 'missions'
-- and 'side_quests' lived on the Progress tab, 'completion' in a separate
-- Checklists panel underneath. There is one panel now, and a list's own title
-- is what tells "Riddler trophies" from "Endings", so one kind is enough.
-- 'completion' stays in checklist_kind backing nothing, the way game_status
-- outlived the status enum.
--
-- The literal is hidden behind EXECUTE on purpose. Drizzle applies every
-- pending migration in a single transaction, so on a brand-new database
-- 0008's `ALTER TYPE ... ADD VALUE 'side_quests'` has not committed yet and
-- Postgres refuses to parse any statement using that value. A new database
-- also has no rows to fold, so the guard skips the branch entirely and the
-- string is never parsed. On an existing database 0008 committed long ago and
-- this runs normally.
--
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM "checklist_templates" WHERE "kind" = 'completion') THEN
    EXECUTE 'UPDATE "checklist_templates" SET "kind" = ''side_quests'' WHERE "kind" = ''completion''';
  END IF;
END $$;