CREATE TABLE "user_game_links" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" text NOT NULL,
	"game_id" uuid NOT NULL,
	"related_game_id" uuid NOT NULL,
	"kind" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "user_game_links_user_id_game_id_related_game_id_kind_unique" UNIQUE("user_id","game_id","related_game_id","kind")
);
--> statement-breakpoint
ALTER TABLE "user_preferences" ADD COLUMN "publish_mode" text DEFAULT 'manual' NOT NULL;--> statement-breakpoint
ALTER TABLE "user_game_links" ADD CONSTRAINT "user_game_links_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "user_game_links" ADD CONSTRAINT "user_game_links_game_id_games_id_fk" FOREIGN KEY ("game_id") REFERENCES "public"."games"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "user_game_links" ADD CONSTRAINT "user_game_links_related_game_id_games_id_fk" FOREIGN KEY ("related_game_id") REFERENCES "public"."games"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "user_game_links_user_game_idx" ON "user_game_links" USING btree ("user_id","game_id");--> statement-breakpoint
CREATE INDEX "user_game_links_user_related_idx" ON "user_game_links" USING btree ("user_id","related_game_id");