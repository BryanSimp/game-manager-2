import {
  date,
  integer,
  pgTable,
  primaryKey,
  text,
  timestamp,
  uuid,
  type AnyPgColumn,
} from "drizzle-orm/pg-core";
import { imageKindEnum, platformFamilyEnum, ttbSourceEnum } from "./enums.js";
import { user } from "./auth.js";

/** Uploaded/cached image files on the /data/images volume. */
export const images = pgTable("images", {
  id: uuid("id").defaultRandom().primaryKey(),
  kind: imageKindEnum("kind").notNull(),
  filename: text("filename").notNull(),
  mime: text("mime").notNull(),
  width: integer("width"),
  height: integer("height"),
  // null = shared asset (e.g. an IGDB cover); set = user upload
  ownerUserId: text("owner_user_id").references(() => user.id, { onDelete: "cascade" }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

/** Shared game catalog — one row per real-world game, shared by all users. */
export const games = pgTable("games", {
  id: uuid("id").defaultRandom().primaryKey(),
  igdbId: integer("igdb_id").unique(),
  // set once a Steam import confidently matches this game — achievements sync key
  steamAppId: integer("steam_app_id").unique(),
  title: text("title").notNull(),
  slug: text("slug"),
  summary: text("summary"),
  releaseDate: date("release_date"),
  coverImageId: uuid("cover_image_id").references(() => images.id),
  // remote IGDB cover URL — fallback while/if the local download hasn't happened
  coverUrl: text("cover_url"),
  ttbMain: integer("ttb_main"),
  ttbMainExtra: integer("ttb_main_extra"),
  ttbCompletionist: integer("ttb_completionist"),
  ttbSource: ttbSourceEnum("ttb_source"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

/**
 * Consoles/platforms, seeded from a curated list; family groups them on the
 * consoles page. `summary`/`releaseDate` come from the seed (curated, and
 * present with or without IGDB); `logoUrl` is filled in lazily from IGDB.
 */
export const platforms = pgTable("platforms", {
  id: uuid("id").defaultRandom().primaryKey(),
  igdbPlatformId: integer("igdb_platform_id").unique(),
  name: text("name").notNull().unique(),
  abbreviation: text("abbreviation"),
  family: platformFamilyEnum("family").notNull().default("other"),
  sortOrder: integer("sort_order").notNull().default(0),
  /**
   * Sub-platform parent: the PC storefronts (Steam, Epic, GOG…) hang off
   * "PC". A game filed under Steam is still a PC game — anything that counts
   * or filters by platform rolls children up into their parent, and only the
   * badge and the consoles page care about which store it came from.
   * One level deep, deliberately: nobody needs a store inside a store.
   */
  parentPlatformId: uuid("parent_platform_id").references((): AnyPgColumn => platforms.id, {
    onDelete: "set null",
  }),
  // first-region hardware launch, or the storefront's opening date
  releaseDate: date("release_date"),
  summary: text("summary"),
  // IGDB platform logo, hot-linked rather than cached — there are only a few
  logoUrl: text("logo_url"),
  // when IGDB was last asked about this platform, so misses aren't retried
  metaFetchedAt: timestamp("meta_fetched_at", { withTimezone: true }),
});

/** Platforms a game exists on (catalog-level, not ownership). */
export const gamePlatforms = pgTable(
  "game_platforms",
  {
    gameId: uuid("game_id")
      .notNull()
      .references(() => games.id, { onDelete: "cascade" }),
    platformId: uuid("platform_id")
      .notNull()
      .references(() => platforms.id, { onDelete: "cascade" }),
  },
  (t) => [primaryKey({ columns: [t.gameId, t.platformId] })],
);

export const genres = pgTable("genres", {
  id: uuid("id").defaultRandom().primaryKey(),
  igdbGenreId: integer("igdb_genre_id").unique(),
  name: text("name").notNull().unique(),
});

export const gameGenres = pgTable(
  "game_genres",
  {
    gameId: uuid("game_id")
      .notNull()
      .references(() => games.id, { onDelete: "cascade" }),
    genreId: uuid("genre_id")
      .notNull()
      .references(() => genres.id, { onDelete: "cascade" }),
  },
  (t) => [primaryKey({ columns: [t.gameId, t.genreId] })],
);

/**
 * Real per-platform retail box art (front scans) from libretro-thumbnails.
 *
 * **Backs nothing as of phase 20.** The 3D box viewer was the only thing that
 * ever displayed a scan, and it's gone; `services/boxart.ts`, which was the
 * only thing that ever wrote a row, went with it (it had already stopped
 * being called when the virtual shelf was removed in phase 11).
 *
 * The table is deliberately left in place rather than dropped, the same way
 * the `game_status` type outlived the status enum: its rows point at `images`
 * rows whose files are still on the volume, and there is no orphaned-image
 * cleanup job to tidy up after a DROP. Nothing reads it, so it costs nothing
 * to keep and would cost real data to remove.
 */
export const gameBoxArt = pgTable(
  "game_box_art",
  {
    gameId: uuid("game_id")
      .notNull()
      .references(() => games.id, { onDelete: "cascade" }),
    platformId: uuid("platform_id")
      .notNull()
      .references(() => platforms.id, { onDelete: "cascade" }),
    imageId: uuid("image_id").references(() => images.id),
    source: text("source").notNull(), // libretro | miss
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [primaryKey({ columns: [t.gameId, t.platformId] })],
);

/** App-wide key/value settings (IGDB credentials, registration toggle, etc.). */
export const settings = pgTable("settings", {
  key: text("key").primaryKey(),
  value: text("value").notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});
