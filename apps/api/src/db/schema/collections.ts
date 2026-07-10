import {
  index,
  pgTable,
  primaryKey,
  real,
  text,
  timestamp,
  unique,
  uuid,
} from "drizzle-orm/pg-core";
import { user } from "./auth.js";
import { games } from "./catalog.js";

/** User-defined groupings (franchises, marathons) with a visual play-order graph. */
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
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [unique().on(t.userId, t.name)],
);

/** Games in a collection; x/y are node positions on the play-order graph. */
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
