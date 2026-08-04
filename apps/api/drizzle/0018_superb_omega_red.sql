CREATE TABLE "analytics_events" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" text,
	"type" text NOT NULL,
	"meta" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE INDEX "analytics_events_type_time_idx" ON "analytics_events" USING btree ("type","created_at");--> statement-breakpoint
CREATE INDEX "analytics_events_user_time_idx" ON "analytics_events" USING btree ("user_id","created_at");--> statement-breakpoint
CREATE INDEX "analytics_events_time_idx" ON "analytics_events" USING btree ("created_at");--> statement-breakpoint
INSERT INTO "analytics_events" ("user_id", "type", "meta", "created_at")
SELECT "id", 'sign_up', '{"backfilled": true}'::jsonb, "created_at" FROM "user";--> statement-breakpoint
INSERT INTO "analytics_events" ("user_id", "type", "meta", "created_at")
SELECT "user_id", 'steam_link', '{"backfilled": true}'::jsonb, "created_at" FROM "steam_accounts";--> statement-breakpoint
INSERT INTO "analytics_events" ("user_id", "type", "meta", "created_at")
SELECT DISTINCT ON ("user_id") "user_id", 'game_added', '{"backfilled": true}'::jsonb, "created_at"
FROM "user_games" ORDER BY "user_id", "created_at" ASC;--> statement-breakpoint
INSERT INTO "analytics_events" ("user_id", "type", "meta", "created_at")
SELECT DISTINCT ON ("user_id") "user_id", 'collection_created', '{"backfilled": true}'::jsonb, "created_at"
FROM "collections" ORDER BY "user_id", "created_at" ASC;