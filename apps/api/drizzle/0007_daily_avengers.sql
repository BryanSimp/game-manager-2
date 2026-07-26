CREATE TYPE "public"."checklist_kind" AS ENUM('completion', 'missions');--> statement-breakpoint
CREATE TYPE "public"."progress_basis" AS ENUM('main', 'main_extra', 'completionist');--> statement-breakpoint
ALTER TABLE "user_games" ADD COLUMN "progress_basis" "progress_basis" DEFAULT 'main' NOT NULL;--> statement-breakpoint
ALTER TABLE "checklist_templates" ADD COLUMN "kind" "checklist_kind" DEFAULT 'completion' NOT NULL;--> statement-breakpoint
ALTER TABLE "checklist_templates" ADD COLUMN "source_url" text;--> statement-breakpoint
--
-- Repair time-to-beat rows written by the swapped IGDB mapping.
--
-- services/catalog.ts stored IGDB's `normally` (a full normal playthrough) as
-- ttb_main and `hastily` (rushing the critical path) as ttb_main_extra, which
-- is backwards -- Metal Gear Solid V read 101h main story / 49h main+extras.
--
-- Sort the three figures ascending in one pass. Pairwise swaps are not enough:
-- fixing main+extras against completionist can re-invert it against main.
-- Nulls drop out and the remaining values shift left, so a game with only two
-- known figures lands them in main and main+extras -- the same rule
-- normalizeTtb() applies in packages/shared/src/progress.ts. Conditional and
-- idempotent, so re-running is a no-op and hand-corrected rows are untouched.
--
UPDATE "games" AS g
SET "ttb_main" = s.sorted[1],
    "ttb_main_extra" = s.sorted[2],
    "ttb_completionist" = s.sorted[3]
FROM (
  SELECT
    "id",
    (
      SELECT array_agg(v ORDER BY v)
      FROM unnest(ARRAY["ttb_main", "ttb_main_extra", "ttb_completionist"]) AS v
      WHERE v IS NOT NULL AND v > 0
    ) AS sorted
  FROM "games"
) AS s
WHERE g."id" = s."id"
  AND s.sorted IS NOT NULL
  AND (
    g."ttb_main" IS DISTINCT FROM s.sorted[1]
    OR g."ttb_main_extra" IS DISTINCT FROM s.sorted[2]
    OR g."ttb_completionist" IS DISTINCT FROM s.sorted[3]
  );