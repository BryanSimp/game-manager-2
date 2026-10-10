-- Added, not used: Postgres lets a transaction add an enum value but not read
-- or write it until that transaction commits, and the migrator runs every
-- pending migration in one. Nothing below touches 'custom'.
ALTER TYPE "public"."progress_basis" ADD VALUE 'custom';--> statement-breakpoint
CREATE TABLE "collection_graph_nodes" (
	"graph_id" uuid NOT NULL,
	"game_id" uuid NOT NULL,
	"position_x" real DEFAULT 0 NOT NULL,
	"position_y" real DEFAULT 0 NOT NULL,
	CONSTRAINT "collection_graph_nodes_graph_id_game_id_pk" PRIMARY KEY("graph_id","game_id")
);
--> statement-breakpoint
CREATE TABLE "collection_graphs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"collection_id" uuid NOT NULL,
	"name" text NOT NULL,
	"position" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "collection_graphs_collection_id_name_unique" UNIQUE("collection_id","name")
);
--> statement-breakpoint
ALTER TABLE "user_games" ADD COLUMN "progress_custom_seconds" integer;--> statement-breakpoint
-- Nullable until the backfill below has given every existing arrow a graph.
ALTER TABLE "collection_links" ADD COLUMN "graph_id" uuid;--> statement-breakpoint
ALTER TABLE "collection_graph_nodes" ADD CONSTRAINT "collection_graph_nodes_graph_id_collection_graphs_id_fk" FOREIGN KEY ("graph_id") REFERENCES "public"."collection_graphs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "collection_graph_nodes" ADD CONSTRAINT "collection_graph_nodes_game_id_games_id_fk" FOREIGN KEY ("game_id") REFERENCES "public"."games"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "collection_graphs" ADD CONSTRAINT "collection_graphs_collection_id_collections_id_fk" FOREIGN KEY ("collection_id") REFERENCES "public"."collections"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "collection_links" ADD CONSTRAINT "collection_links_graph_id_collection_graphs_id_fk" FOREIGN KEY ("graph_id") REFERENCES "public"."collection_graphs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "collection_links_graph_idx" ON "collection_links" USING btree ("graph_id");--> statement-breakpoint
--
-- Turn every collection's one graph into a graph of its own.
--
-- A collection used to *be* its graph: node positions were two columns on
-- collection_games and the arrows hung straight off the collection. Each
-- collection gets one "Play order" graph here, and its existing layout and
-- arrows move onto it unchanged, so nothing looks different after the upgrade
-- until someone adds a second graph.
--
-- Every collection gets one, empty ones included -- the API never lets a
-- collection drop to zero graphs, so it mustn't start there either.
--
INSERT INTO "collection_graphs" ("collection_id", "name", "position")
SELECT "id", 'Play order', 1 FROM "collections";--> statement-breakpoint
INSERT INTO "collection_graph_nodes" ("graph_id", "game_id", "position_x", "position_y")
SELECT graph."id", member."game_id", member."position_x", member."position_y"
FROM "collection_games" AS member
JOIN "collection_graphs" AS graph ON graph."collection_id" = member."collection_id";--> statement-breakpoint
UPDATE "collection_links" AS link
SET "graph_id" = graph."id"
FROM "collection_graphs" AS graph
WHERE graph."collection_id" = link."collection_id";--> statement-breakpoint
ALTER TABLE "collection_links" ALTER COLUMN "graph_id" SET NOT NULL;--> statement-breakpoint
-- Only now that the positions have been copied somewhere else.
ALTER TABLE "collection_games" DROP COLUMN "position_x";--> statement-breakpoint
ALTER TABLE "collection_games" DROP COLUMN "position_y";
