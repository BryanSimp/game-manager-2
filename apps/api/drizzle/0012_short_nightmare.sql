CREATE TABLE "user_consoles" (
	"user_id" text NOT NULL,
	"platform_id" uuid NOT NULL,
	"added_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "user_consoles_user_id_platform_id_pk" PRIMARY KEY("user_id","platform_id")
);
--> statement-breakpoint
ALTER TABLE "platforms" ADD COLUMN "release_date" date;--> statement-breakpoint
ALTER TABLE "platforms" ADD COLUMN "summary" text;--> statement-breakpoint
ALTER TABLE "platforms" ADD COLUMN "logo_url" text;--> statement-breakpoint
ALTER TABLE "platforms" ADD COLUMN "meta_fetched_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "user_preferences" ADD COLUMN "default_platform_id" uuid;--> statement-breakpoint
ALTER TABLE "user_preferences" ADD COLUMN "default_platform_format" "ownership_format" DEFAULT 'digital' NOT NULL;--> statement-breakpoint
ALTER TABLE "user_preferences" ADD COLUMN "badge_opacity" integer DEFAULT 100 NOT NULL;--> statement-breakpoint
ALTER TABLE "user_consoles" ADD CONSTRAINT "user_consoles_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "user_consoles" ADD CONSTRAINT "user_consoles_platform_id_platforms_id_fk" FOREIGN KEY ("platform_id") REFERENCES "public"."platforms"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "user_preferences" ADD CONSTRAINT "user_preferences_default_platform_id_platforms_id_fk" FOREIGN KEY ("default_platform_id") REFERENCES "public"."platforms"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "user_game_platforms" DROP COLUMN "position";--> statement-breakpoint
-- Existing ownership already says which consoles people have; seed the new
-- list from it so nobody opens the consoles page to an empty shelf.
INSERT INTO "user_consoles" ("user_id", "platform_id")
SELECT DISTINCT ug."user_id", ugp."platform_id"
FROM "user_game_platforms" ugp
JOIN "user_games" ug ON ug."id" = ugp."user_game_id"
ON CONFLICT DO NOTHING;