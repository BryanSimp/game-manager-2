CREATE TABLE "steam_import_rules" (
	"user_id" text NOT NULL,
	"steam_app_id" integer NOT NULL,
	"action" text NOT NULL,
	"game_id" uuid,
	"app_name" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "steam_import_rules_user_id_steam_app_id_pk" PRIMARY KEY("user_id","steam_app_id")
);
--> statement-breakpoint
ALTER TABLE "user_preferences" ADD COLUMN "show_rating" boolean DEFAULT true NOT NULL;--> statement-breakpoint
ALTER TABLE "steam_import_rules" ADD CONSTRAINT "steam_import_rules_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "steam_import_rules" ADD CONSTRAINT "steam_import_rules_game_id_games_id_fk" FOREIGN KEY ("game_id") REFERENCES "public"."games"("id") ON DELETE cascade ON UPDATE no action;