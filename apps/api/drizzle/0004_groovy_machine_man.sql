CREATE TABLE "game_box_art" (
	"game_id" uuid NOT NULL,
	"platform_id" uuid NOT NULL,
	"image_id" uuid,
	"source" text NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "game_box_art_game_id_platform_id_pk" PRIMARY KEY("game_id","platform_id")
);
--> statement-breakpoint
ALTER TABLE "game_box_art" ADD CONSTRAINT "game_box_art_game_id_games_id_fk" FOREIGN KEY ("game_id") REFERENCES "public"."games"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "game_box_art" ADD CONSTRAINT "game_box_art_platform_id_platforms_id_fk" FOREIGN KEY ("platform_id") REFERENCES "public"."platforms"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "game_box_art" ADD CONSTRAINT "game_box_art_image_id_images_id_fk" FOREIGN KEY ("image_id") REFERENCES "public"."images"("id") ON DELETE no action ON UPDATE no action;