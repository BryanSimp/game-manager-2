import {
  boolean,
  index,
  integer,
  pgTable,
  primaryKey,
  real,
  text,
  timestamp,
  unique,
  uuid,
  type AnyPgColumn,
} from "drizzle-orm/pg-core";
import { user } from "./auth.js";
import { games } from "./catalog.js";

/**
 * User-defined groupings (franchises, marathons) with a visual play-order graph.
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
 * Two independent orderings live here, because they answer different
 * questions. `position_x`/`position_y` place a node on the play-order *graph*,
 * which is about branches ("do either of these, then this"). `sort_order` is
 * the flat list order — what you get when you just want a numbered run of
 * games — and is what the list view's "Custom order" sorts by.
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
    positionX: real("position_x").notNull().default(0),
    positionY: real("position_y").notNull().default(0),
    /** 1-based place in the flat list; ties fall back to title */
    sortOrder: integer("sort_order").notNull().default(0),
  },
  (t) => [primaryKey({ columns: [t.collectionId, t.gameId] })],
);

/** Directed edges of the play-order graph ("play this, then that"). */
export const collectionLinks = pgTable(
  "collection_links",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    collectionId: uuid("collection_id")
      .notNull()
      .references(() => collections.id, { onDelete: "cascade" }),
    fromGameId: uuid("from_game_id")
      .notNull()
      .references(() => games.id, { onDelete: "cascade" }),
    toGameId: uuid("to_game_id")
      .notNull()
      .references(() => games.id, { onDelete: "cascade" }),
    label: text("label"),
  },
  (t) => [index("collection_links_collection_idx").on(t.collectionId)],
);
