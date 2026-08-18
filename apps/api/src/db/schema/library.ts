import {
  boolean,
  index,
  integer,
  jsonb,
  numeric,
  pgTable,
  primaryKey,
  text,
  timestamp,
  unique,
  uuid,
} from "drizzle-orm/pg-core";
import { ownershipFormatEnum, progressBasisEnum } from "./enums.js";
import { games, images, platforms } from "./catalog.js";
import { user } from "./auth.js";

/** Per-user state for a catalog game. */
export const userGames = pgTable(
  "user_games",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    userId: text("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    gameId: uuid("game_id")
      .notNull()
      .references(() => games.id, { onDelete: "cascade" }),
    // text, not an enum: a category is either a built-in key or the id of one
    // of this user's custom categories. Validated in the route against both.
    status: text("status").notNull().default("backlog"),
    rating: numeric("rating", { precision: 2, scale: 1 }),
    notes: text("notes"),
    customCoverImageId: uuid("custom_cover_image_id").references(() => images.id),
    // false = "endless game", excluded from backlog-time math
    ttbEnabled: boolean("ttb_enabled").notNull().default(true),
    // which how-long-to-beat figure the mission time estimate divides up
    progressBasis: progressBasisEnum("progress_basis").notNull().default("main"),
    // synced from Steam (GetOwnedGames playtime_forever)
    steamPlaytimeMinutes: integer("steam_playtime_minutes"),
    // "100% completed" sub-state of finished (all collectibles/endings/etc.)
    completed100: boolean("completed_100").notNull().default(false),
    startedAt: timestamp("started_at", { withTimezone: true }),
    finishedAt: timestamp("finished_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    unique().on(t.userId, t.gameId),
    index("user_games_user_status_idx").on(t.userId, t.status),
    // the community average rating groups by game across every user, which
    // the (user, game) unique index can't serve
    index("user_games_game_idx").on(t.gameId),
  ],
);

/**
 * How long a game took *this* user, in seconds.
 *
 * Play times used to be written straight onto the shared `games` row, which
 * meant one person's typo became everyone's number and there was nothing to
 * average. They live per-user now: your figure drives your own estimate, and
 * the average of everyone's fills in games IGDB has no data for. Legacy
 * `games.ttb_source = 'manual'` values predate this and still win — see
 * `resolveTtb` in @gm/shared for the precedence.
 */
export const userTimeToBeat = pgTable(
  "user_time_to_beat",
  {
    userId: text("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    gameId: uuid("game_id")
      .notNull()
      .references(() => games.id, { onDelete: "cascade" }),
    mainSeconds: integer("main_seconds"),
    mainExtraSeconds: integer("main_extra_seconds"),
    completionistSeconds: integer("completionist_seconds"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    primaryKey({ columns: [t.userId, t.gameId] }),
    index("user_time_to_beat_game_idx").on(t.gameId),
  ],
);

/** Which platform(s) the user owns a game on, each physical or digital. */
export const userGamePlatforms = pgTable(
  "user_game_platforms",
  {
    userGameId: uuid("user_game_id")
      .notNull()
      .references(() => userGames.id, { onDelete: "cascade" }),
    platformId: uuid("platform_id")
      .notNull()
      .references(() => platforms.id, { onDelete: "cascade" }),
    format: ownershipFormatEnum("format").notNull(),
  },
  (t) => [primaryKey({ columns: [t.userGameId, t.platformId, t.format] })],
);

/**
 * Consoles the user says they own. This is the list every platform picker
 * offers first — filing a game under a console you haven't added is still
 * possible, it just adds the console at the same time (see
 * `rememberConsoles`), so the two can never drift apart.
 */
export const userConsoles = pgTable(
  "user_consoles",
  {
    userId: text("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    platformId: uuid("platform_id")
      .notNull()
      .references(() => platforms.id, { onDelete: "cascade" }),
    // your own art for this console, overriding the IGDB logo
    customImageId: uuid("custom_image_id").references(() => images.id),
    addedAt: timestamp("added_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [primaryKey({ columns: [t.userId, t.platformId] })],
);

/** User-created tags/categories, optionally grouped ("Mood", "Franchise"…). */
export const tags = pgTable(
  "tags",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    userId: text("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    color: text("color"),
    groupName: text("group_name"),
  },
  (t) => [unique().on(t.userId, t.name)],
);

export const userGameTags = pgTable(
  "user_game_tags",
  {
    userGameId: uuid("user_game_id")
      .notNull()
      .references(() => userGames.id, { onDelete: "cascade" }),
    tagId: uuid("tag_id")
      .notNull()
      .references(() => tags.id, { onDelete: "cascade" }),
  },
  (t) => [primaryKey({ columns: [t.userGameId, t.tagId] })],
);

/** Display preferences — jsonb is deliberate here, it's pure UI config. */
export const userPreferences = pgTable("user_preferences", {
  userId: text("user_id")
    .primaryKey()
    .references(() => user.id, { onDelete: "cascade" }),
  theme: text("theme").notNull().default("dark"),
  // category a newly added game lands in
  defaultStatus: text("default_status").notNull().default("backlog"),
  statusColors: jsonb("status_colors"),
  // platform a newly added game is filed under, when set
  defaultPlatformId: uuid("default_platform_id").references(() => platforms.id, {
    onDelete: "set null",
  }),
  defaultPlatformFormat: ownershipFormatEnum("default_platform_format")
    .notNull()
    .default("digital"),
  showPlatformBadge: boolean("show_platform_badge").notNull().default(true),
  showTimeBadge: boolean("show_time_badge").notNull().default(true),
  showRating: boolean("show_rating").notNull().default(true),
  // how solid category badges look, in percent — one setting for every badge
  badgeOpacity: integer("badge_opacity").notNull().default(100),
  // covers per row on the library grid at full width, 1–8
  libraryColumns: integer("library_columns").notNull().default(5),
  // category the library opens on: a category key/id, or 'all' for no filter
  defaultLibraryFilter: text("default_library_filter").notNull().default("all"),
  dashboardConfig: jsonb("dashboard_config"),
});

/**
 * User-defined categories, sitting alongside the built-in ones. The row id is
 * what lands in `user_games.status`, so renaming a category doesn't have to
 * rewrite every game that uses it.
 */
export const customCategories = pgTable(
  "custom_categories",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    userId: text("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    color: text("color"),
    sortOrder: integer("sort_order").notNull().default(0),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [unique().on(t.userId, t.name)],
);
