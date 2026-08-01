-- game_status no longer backs a column after this migration; the values are
-- added only to keep the type consistent with GAME_STATUSES in @gm/shared
ALTER TYPE "public"."game_status" ADD VALUE IF NOT EXISTS 'uncategorized' BEFORE 'wishlist';--> statement-breakpoint
ALTER TYPE "public"."game_status" ADD VALUE IF NOT EXISTS 'shelved' BEFORE 'dropped';--> statement-breakpoint
CREATE TABLE "custom_categories" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" text NOT NULL,
	"name" text NOT NULL,
	"color" text,
	"sort_order" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "custom_categories_user_id_name_unique" UNIQUE("user_id","name")
);
--> statement-breakpoint
--
-- Categories become free text: a built-in key, or the id of one of the
-- user's custom_categories rows. The existing default is game_status-typed,
-- and Postgres won't cast a default across types, so it has to be dropped
-- before the column changes and restored afterwards.
--
ALTER TABLE "user_games" ALTER COLUMN "status" DROP DEFAULT;--> statement-breakpoint
ALTER TABLE "user_games" ALTER COLUMN "status" SET DATA TYPE text;--> statement-breakpoint
ALTER TABLE "user_games" ALTER COLUMN "status" SET DEFAULT 'backlog';--> statement-breakpoint
ALTER TABLE "user_preferences" ADD COLUMN "default_status" text DEFAULT 'backlog' NOT NULL;--> statement-breakpoint
ALTER TABLE "custom_categories" ADD CONSTRAINT "custom_categories_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;