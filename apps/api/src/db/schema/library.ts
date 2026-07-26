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
import { gameStatusEnum, ownershipFormatEnum, progressBasisEnum } from "./enums.js";
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
    status: gameStatusEnum("status").notNull().default("backlog"),
    rating: numeric("rating", { precision: 2, scale: 1 }),
    notes: text("notes"),
    customCoverImageId: uuid("custom_cover_image_id").references(() => images.id),
    // false = "endless game", excluded from backlog-time math
    ttbEnabled: boolean("ttb_enabled").notNull().default(true),
    // which how-long-to-beat figure the mission time estimate divides up
    progressBasis: progressBasisEnum("progress_basis").notNull().default("main"),
    // synced from Steam (GetOwnedGames playtime_forever)
    steamPlaytimeMinutes: integer("steam_playtime_minutes"),
    startedAt: timestamp("started_at", { withTimezone: true }),
    finishedAt: timestamp("finished_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    unique().on(t.userId, t.gameId),
    index("user_games_user_status_idx").on(t.userId, t.status),
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
    // custom order on the virtual shelf, per platform row
    position: integer("position").notNull().default(0),
  },
  (t) => [primaryKey({ columns: [t.userGameId, t.platformId, t.format] })],
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
  statusColors: jsonb("status_colors"),
  showPlatformBadge: boolean("show_platform_badge").notNull().default(true),
  showTimeBadge: boolean("show_time_badge").notNull().default(true),
  dashboardConfig: jsonb("dashboard_config"),
});
