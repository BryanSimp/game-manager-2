ALTER TYPE "public"."image_kind" ADD VALUE 'console_logo';--> statement-breakpoint
ALTER TABLE "platforms" ADD COLUMN "parent_platform_id" uuid;--> statement-breakpoint
ALTER TABLE "user_consoles" ADD COLUMN "custom_image_id" uuid;--> statement-breakpoint
ALTER TABLE "platforms" ADD CONSTRAINT "platforms_parent_platform_id_platforms_id_fk" FOREIGN KEY ("parent_platform_id") REFERENCES "public"."platforms"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "user_consoles" ADD CONSTRAINT "user_consoles_custom_image_id_images_id_fk" FOREIGN KEY ("custom_image_id") REFERENCES "public"."images"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
-- The Windows store is now labelled for the Xbox app people actually install
-- from. No-op on any database that never saw the old name.
UPDATE "platforms" SET "name" = 'Xbox / Microsoft Store', "abbreviation" = 'Xbox PC' WHERE "name" = 'Microsoft Store';--> statement-breakpoint
-- Storefronts become children of PC. The seed does this too, but doing it here
-- means the backfill below can rely on it.
INSERT INTO "platforms" ("name", "family", "sort_order") VALUES ('Steam', 'pc', 51) ON CONFLICT ("name") DO NOTHING;--> statement-breakpoint
UPDATE "platforms" SET "parent_platform_id" = (SELECT "id" FROM "platforms" WHERE "name" = 'PC')
WHERE "name" IN ('Steam', 'Epic Games Store', 'GOG', 'Battle.net', 'Origin', 'EA App', 'Ubisoft Connect', 'Xbox / Microsoft Store', 'itch.io');--> statement-breakpoint
-- Steam libraries imported before the split sit on the generic PC platform.
-- A game carrying a steam_app_id demonstrably came from Steam, so move that
-- ownership onto the Steam sub-platform — same PC game, now with its store.
INSERT INTO "user_game_platforms" ("user_game_id", "platform_id", "format")
SELECT ugp."user_game_id", (SELECT "id" FROM "platforms" WHERE "name" = 'Steam'), ugp."format"
FROM "user_game_platforms" ugp
JOIN "user_games" ug ON ug."id" = ugp."user_game_id"
JOIN "games" g ON g."id" = ug."game_id"
WHERE ugp."platform_id" = (SELECT "id" FROM "platforms" WHERE "name" = 'PC')
  AND g."steam_app_id" IS NOT NULL
ON CONFLICT DO NOTHING;--> statement-breakpoint
DELETE FROM "user_game_platforms" ugp
USING "user_games" ug, "games" g
WHERE ug."id" = ugp."user_game_id"
  AND g."id" = ug."game_id"
  AND ugp."platform_id" = (SELECT "id" FROM "platforms" WHERE "name" = 'PC')
  AND g."steam_app_id" IS NOT NULL;--> statement-breakpoint
-- and put Steam on those users' consoles list
INSERT INTO "user_consoles" ("user_id", "platform_id")
SELECT DISTINCT ug."user_id", ugp."platform_id"
FROM "user_game_platforms" ugp
JOIN "user_games" ug ON ug."id" = ugp."user_game_id"
WHERE ugp."platform_id" = (SELECT "id" FROM "platforms" WHERE "name" = 'Steam')
ON CONFLICT DO NOTHING;