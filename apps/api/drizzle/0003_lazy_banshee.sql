CREATE TABLE "collection_games" (
	"collection_id" uuid NOT NULL,
	"game_id" uuid NOT NULL,
	"position_x" real DEFAULT 0 NOT NULL,
	"position_y" real DEFAULT 0 NOT NULL,
	CONSTRAINT "collection_games_collection_id_game_id_pk" PRIMARY KEY("collection_id","game_id")
);
--> statement-breakpoint
CREATE TABLE "collection_links" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"collection_id" uuid NOT NULL,
	"from_game_id" uuid NOT NULL,
	"to_game_id" uuid NOT NULL,
	"label" text
);
--> statement-breakpoint
CREATE TABLE "collections" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" text NOT NULL,
	"name" text NOT NULL,
	"description" text,
	"accent_color" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "collections_user_id_name_unique" UNIQUE("user_id","name")
);
--> statement-breakpoint
ALTER TABLE "user_game_platforms" ADD COLUMN "position" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "collection_games" ADD CONSTRAINT "collection_games_collection_id_collections_id_fk" FOREIGN KEY ("collection_id") REFERENCES "public"."collections"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "collection_games" ADD CONSTRAINT "collection_games_game_id_games_id_fk" FOREIGN KEY ("game_id") REFERENCES "public"."games"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "collection_links" ADD CONSTRAINT "collection_links_collection_id_collections_id_fk" FOREIGN KEY ("collection_id") REFERENCES "public"."collections"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "collection_links" ADD CONSTRAINT "collection_links_from_game_id_games_id_fk" FOREIGN KEY ("from_game_id") REFERENCES "public"."games"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "collection_links" ADD CONSTRAINT "collection_links_to_game_id_games_id_fk" FOREIGN KEY ("to_game_id") REFERENCES "public"."games"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "collections" ADD CONSTRAINT "collections_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "collection_links_collection_idx" ON "collection_links" USING btree ("collection_id");