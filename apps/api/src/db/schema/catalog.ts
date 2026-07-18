import {
  date,
  integer,
  pgTable,
  primaryKey,
  text,
  timestamp,
  uuid,
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

/** Consoles/platforms, seeded from a curated list; family drives shelf grouping. */
export const platforms = pgTable("platforms", {
  id: uuid("id").defaultRandom().primaryKey(),
  igdbPlatformId: integer("igdb_platform_id").unique(),
  name: text("name").notNull().unique(),
  abbreviation: text("abbreviation"),
  family: platformFamilyEnum("family").notNull().default("other"),
  sortOrder: integer("sort_order").notNull().default(0),
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
 * Real per-platform retail box art (front scans), fetched from
 * libretro-thumbnails and cached locally. imageId null = confirmed miss.
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
