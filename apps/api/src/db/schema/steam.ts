import {
  index,
  integer,
  pgTable,
  primaryKey,
  text,
  timestamp,
  unique,
  uuid,
} from "drizzle-orm/pg-core";
import { games } from "./catalog.js";
import { user } from "./auth.js";

/** One linked Steam account per user (SteamID64; profile must be public). */
export const steamAccounts = pgTable("steam_accounts", {
  userId: text("user_id")
    .primaryKey()
    .references(() => user.id, { onDelete: "cascade" }),
  steamId: text("steam_id").notNull(),
  personaName: text("persona_name"),
  lastImportAt: timestamp("last_import_at", { withTimezone: true }),
  lastSyncAt: timestamp("last_sync_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

/**
 * Per-user decisions about individual Steam apps, applied on every import.
 * Matching by title alone can't tell two games called "Deadlock" apart, so
 * this is the manual override: 'block' keeps an app out of the library for
 * good, 'map' pins it to the game you say it is.
 */
export const steamImportRules = pgTable(
  "steam_import_rules",
  {
    userId: text("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    steamAppId: integer("steam_app_id").notNull(),
    action: text("action").notNull(), // block | map
    // the game 'map' pins this app to; null for 'block'
    gameId: uuid("game_id").references(() => games.id, { onDelete: "cascade" }),
    // Steam's own name for the app, so the rule list reads as something
    appName: text("app_name"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [primaryKey({ columns: [t.userId, t.steamAppId] })],
);

/** Shared achievement catalog per game (provider-scoped, Steam first). */
export const achievements = pgTable(
  "achievements",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    gameId: uuid("game_id")
      .notNull()
      .references(() => games.id, { onDelete: "cascade" }),
    provider: text("provider").notNull().default("steam"),
    externalId: text("external_id").notNull(), // Steam apiname
    name: text("name").notNull(),
    description: text("description"),
    iconUrl: text("icon_url"),
    iconGrayUrl: text("icon_gray_url"),
  },
  (t) => [
    unique().on(t.gameId, t.provider, t.externalId),
    index("achievements_game_idx").on(t.gameId),
  ],
);

export const userAchievements = pgTable(
  "user_achievements",
  {
    userId: text("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    achievementId: uuid("achievement_id")
      .notNull()
      .references(() => achievements.id, { onDelete: "cascade" }),
    unlockedAt: timestamp("unlocked_at", { withTimezone: true }),
  },
  (t) => [primaryKey({ columns: [t.userId, t.achievementId] })],
);
