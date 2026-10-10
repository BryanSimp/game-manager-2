import {
  boolean,
  index,
  integer,
  pgTable,
  primaryKey,
  real,
  smallint,
  text,
  timestamp,
  unique,
  uuid,
  type AnyPgColumn,
} from "drizzle-orm/pg-core";
import { user } from "./auth.js";
import { games } from "./catalog.js";

/**
 * User-defined groupings (franchises, marathons) with visual play-order graphs.
 *
 * Publishing and adopting follow the checklist rules exactly: `is_public` puts
 * a collection in everyone's browse list, and adopting takes a **private
 * copy** — games, links and all — rather than a live reference. Editing your
 * copy can't touch the original, and the original changing can't rearrange
 * your marathon halfway through it. `adopted_from_id` is provenance only,
 * which is why it survives the source being deleted (`set null`).
 */
export const collections = pgTable(
  "collections",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    userId: text("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    description: text("description"),
    accentColor: text("accent_color"),
    /** listed for everyone to browse and adopt */
    isPublic: boolean("is_public").notNull().default(false),
    /** the public collection this was copied from, if any */
    adoptedFromId: uuid("adopted_from_id").references((): AnyPgColumn => collections.id, {
      onDelete: "set null",
    }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [unique().on(t.userId, t.name), index("collections_public_idx").on(t.isPublic)],
);

/**
 * Games in a collection.
 *
 * Membership and the flat list order live here. `sort_order` is what you get
 * when you just want a numbered run of games, and is what the list view's
 * "Custom order" sorts by. Where a game sits on a *graph* is a different
 * question with a different answer per graph — see `collection_graph_nodes`.
 */
export const collectionGames = pgTable(
  "collection_games",
  {
    collectionId: uuid("collection_id")
      .notNull()
      .references(() => collections.id, { onDelete: "cascade" }),
    gameId: uuid("game_id")
      .notNull()
      .references(() => games.id, { onDelete: "cascade" }),
    /** 1-based place in the flat list; ties fall back to title */
    sortOrder: integer("sort_order").notNull().default(0),
  },
  (t) => [
    primaryKey({ columns: [t.collectionId, t.gameId] }),
    // the PK indexes (collection, game) — "which collections contain this
    // game" needs the other direction, and that's the whole browse-by-game
    // feature
    index("collection_games_game_idx").on(t.gameId),
  ],
);

/**
 * A named arrangement of a collection's games — "Play order", "Timeline",
 * "Release date".
 *
 * A collection used to have exactly one graph, stored as two columns on
 * `collection_games` and a pile of links. But the order you *play* a series in
 * and the order its story *happens* in are both worth drawing, and they
 * disagree — so a graph is its own row now, and a collection has as many as
 * you make. Every graph covers every game in the collection: they're different
 * views of one list, not different lists.
 *
 * Every collection has at least one. Creating a collection makes the first,
 * and the API refuses to delete the last, so a graph tab always exists to
 * click.
 */
export const collectionGraphs = pgTable(
  "collection_graphs",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    collectionId: uuid("collection_id")
      .notNull()
      .references(() => collections.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    /** tab order, 1-based; new graphs go on the end */
    position: integer("position").notNull().default(0),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  // two tabs with the same name would be two tabs you can't tell apart; the
  // unique index also serves "the graphs of this collection"
  (t) => [unique().on(t.collectionId, t.name)],
);

/**
 * Where one game sits on one graph.
 *
 * Written for every game on every graph — when a game joins the collection and
 * when a graph is created — rather than filled in lazily, so a node's place
 * never depends on anything but the last time someone put it there. Reordering
 * the flat list, in particular, can't move it.
 */
export const collectionGraphNodes = pgTable(
  "collection_graph_nodes",
  {
    graphId: uuid("graph_id")
      .notNull()
      .references(() => collectionGraphs.id, { onDelete: "cascade" }),
    gameId: uuid("game_id")
      .notNull()
      .references(() => games.id, { onDelete: "cascade" }),
    positionX: real("position_x").notNull().default(0),
    positionY: real("position_y").notNull().default(0),
  },
  (t) => [primaryKey({ columns: [t.graphId, t.gameId] })],
);

/**
 * Directed edges of one graph ("play this, then that").
 *
 * `collection_id` is implied by `graph_id` and kept anyway: removing a game
 * from a collection clears its arrows on every graph at once, and that's one
 * indexed delete rather than a join.
 */
export const collectionLinks = pgTable(
  "collection_links",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    collectionId: uuid("collection_id")
      .notNull()
      .references(() => collections.id, { onDelete: "cascade" }),
    graphId: uuid("graph_id")
      .notNull()
      .references(() => collectionGraphs.id, { onDelete: "cascade" }),
    fromGameId: uuid("from_game_id")
      .notNull()
      .references(() => games.id, { onDelete: "cascade" }),
    toGameId: uuid("to_game_id")
      .notNull()
      .references(() => games.id, { onDelete: "cascade" }),
    label: text("label"),
  },
  (t) => [
    index("collection_links_collection_idx").on(t.collectionId),
    index("collection_links_graph_idx").on(t.graphId),
  ],
);

/** Thumbs up/down on a published collection. Mirrors `checklist_votes`. */
export const collectionVotes = pgTable(
  "collection_votes",
  {
    collectionId: uuid("collection_id")
      .notNull()
      .references(() => collections.id, { onDelete: "cascade" }),
    userId: text("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    value: smallint("value").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    primaryKey({ columns: [t.collectionId, t.userId] }),
    index("collection_votes_collection_idx").on(t.collectionId),
  ],
);
