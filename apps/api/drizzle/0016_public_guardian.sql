ALTER TABLE "collection_games" ADD COLUMN "sort_order" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
-- Backfill the flat list order from where the nodes already sit on the graph
-- (top-to-bottom, then left-to-right). Without this every existing row is 0,
-- so "Custom order" would open as an arbitrary jumble on collections that
-- already had a deliberate layout.
UPDATE "collection_games" cg
SET "sort_order" = ranked.rn
FROM (
  SELECT
    "collection_id",
    "game_id",
    row_number() OVER (
      PARTITION BY "collection_id"
      ORDER BY "position_y", "position_x", "game_id"
    ) AS rn
  FROM "collection_games"
) ranked
WHERE cg."collection_id" = ranked."collection_id"
  AND cg."game_id" = ranked."game_id";
