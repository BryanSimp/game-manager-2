ALTER TYPE "public"."import_source" ADD VALUE 'steam';--> statement-breakpoint
CREATE TABLE "checklist_items" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"template_id" uuid NOT NULL,
	"position" integer DEFAULT 0 NOT NULL,
	"text" text NOT NULL,
	"category" text
);
--> statement-breakpoint
CREATE TABLE "checklist_templates" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"game_id" uuid NOT NULL,
	"author_user_id" text NOT NULL,
	"title" text NOT NULL,
	"is_public" boolean DEFAULT false NOT NULL,
	"adopted_from_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "user_checklist_items" (
	"user_id" text NOT NULL,
	"item_id" uuid NOT NULL,
	"completed_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "user_checklist_items_user_id_item_id_pk" PRIMARY KEY("user_id","item_id")
);
--> statement-breakpoint
CREATE TABLE "achievements" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"game_id" uuid NOT NULL,
	"provider" text DEFAULT 'steam' NOT NULL,
	"external_id" text NOT NULL,
	"name" text NOT NULL,
	"description" text,
	"icon_url" text,
	"icon_gray_url" text,
	CONSTRAINT "achievements_game_id_provider_external_id_unique" UNIQUE("game_id","provider","external_id")
);
--> statement-breakpoint
CREATE TABLE "steam_accounts" (
	"user_id" text PRIMARY KEY NOT NULL,
	"steam_id" text NOT NULL,
	"persona_name" text,
	"last_import_at" timestamp with time zone,
	"last_sync_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "user_achievements" (
	"user_id" text NOT NULL,
	"achievement_id" uuid NOT NULL,
	"unlocked_at" timestamp with time zone,
	CONSTRAINT "user_achievements_user_id_achievement_id_pk" PRIMARY KEY("user_id","achievement_id")
);
--> statement-breakpoint
ALTER TABLE "games" ADD COLUMN "steam_app_id" integer;--> statement-breakpoint
ALTER TABLE "user_games" ADD COLUMN "steam_playtime_minutes" integer;--> statement-breakpoint
ALTER TABLE "import_items" ADD COLUMN "steam_app_id" integer;--> statement-breakpoint
ALTER TABLE "checklist_items" ADD CONSTRAINT "checklist_items_template_id_checklist_templates_id_fk" FOREIGN KEY ("template_id") REFERENCES "public"."checklist_templates"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "checklist_templates" ADD CONSTRAINT "checklist_templates_game_id_games_id_fk" FOREIGN KEY ("game_id") REFERENCES "public"."games"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "checklist_templates" ADD CONSTRAINT "checklist_templates_author_user_id_user_id_fk" FOREIGN KEY ("author_user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "checklist_templates" ADD CONSTRAINT "checklist_templates_adopted_from_id_checklist_templates_id_fk" FOREIGN KEY ("adopted_from_id") REFERENCES "public"."checklist_templates"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "user_checklist_items" ADD CONSTRAINT "user_checklist_items_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "user_checklist_items" ADD CONSTRAINT "user_checklist_items_item_id_checklist_items_id_fk" FOREIGN KEY ("item_id") REFERENCES "public"."checklist_items"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "achievements" ADD CONSTRAINT "achievements_game_id_games_id_fk" FOREIGN KEY ("game_id") REFERENCES "public"."games"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "steam_accounts" ADD CONSTRAINT "steam_accounts_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "user_achievements" ADD CONSTRAINT "user_achievements_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "user_achievements" ADD CONSTRAINT "user_achievements_achievement_id_achievements_id_fk" FOREIGN KEY ("achievement_id") REFERENCES "public"."achievements"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "checklist_items_template_idx" ON "checklist_items" USING btree ("template_id");--> statement-breakpoint
CREATE INDEX "checklist_templates_game_idx" ON "checklist_templates" USING btree ("game_id");--> statement-breakpoint
CREATE INDEX "checklist_templates_author_idx" ON "checklist_templates" USING btree ("author_user_id");--> statement-breakpoint
CREATE INDEX "achievements_game_idx" ON "achievements" USING btree ("game_id");--> statement-breakpoint
ALTER TABLE "games" ADD CONSTRAINT "games_steam_app_id_unique" UNIQUE("steam_app_id");