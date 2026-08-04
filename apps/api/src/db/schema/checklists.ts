import {
  boolean,
  index,
  integer,
  pgTable,
  primaryKey,
  smallint,
  text,
  timestamp,
  uuid,
  type AnyPgColumn,
} from "drizzle-orm/pg-core";
import { games } from "./catalog.js";
import { user } from "./auth.js";
import { checklistKindEnum } from "./enums.js";

/**
 * Per-game lists (missions, collectibles, endings). No public API has this
 * data, so it's user-created and crowd-sourced in-app: publish a template,
 * other users adopt a private copy and track their own progress.
 *
 * A user keeps *many* lists per game, ordered by `position`: one main-story
 * list (`kind='missions'`, the only one the time estimate divides up) followed
 * by as many extra lists as they like (`kind='side_quests'`, whatever they're
 * called — "Riddler trophies", "Endings"). `kind='completion'` is the original
 * free-form flavour; migration 0020 folded those into `side_quests`, so the
 * enum value survives but backs nothing (same fate as `game_status`).
 */
export const checklistTemplates = pgTable(
  "checklist_templates",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    gameId: uuid("game_id")
      .notNull()
      .references(() => games.id, { onDelete: "cascade" }),
    authorUserId: text("author_user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    title: text("title").notNull(),
    // 'missions' lists are ordered story beats and drive the time-remaining
    // estimate; 'side_quests' is every other list you keep for the game.
    //
    // Deliberately no column default. It can't be 'side_quests' (migrations
    // all run in one transaction, and Postgres forbids using a value that
    // ALTER TYPE added in that same transaction — 0008 is where it was
    // added), and defaulting to the dead 'completion' kind would quietly
    // mis-file any insert that forgot to say. No default makes drizzle
    // require it at the type level instead.
    kind: checklistKindEnum("kind").notNull(),
    // where this list sits among your lists for this game, 1-based. The main
    // story list is normally 1; extras follow in the order you arranged them.
    position: integer("position").notNull().default(0),
    // wiki page a scraped mission list came from (CC-BY-SA attribution)
    sourceUrl: text("source_url"),
    // story missions are played in order, so ticking #15 implies #1-14 are
    // done too. Off by default — collectibles and side quests have no order.
    sequential: boolean("sequential").notNull().default(false),
    isPublic: boolean("is_public").notNull().default(false),
    // provenance when adopted from someone else's public template
    adoptedFromId: uuid("adopted_from_id").references(
      (): AnyPgColumn => checklistTemplates.id,
      { onDelete: "set null" },
    ),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index("checklist_templates_game_idx").on(t.gameId),
    index("checklist_templates_author_idx").on(t.authorUserId),
  ],
);

/**
 * Thumbs up/down on a published list — the only signal for whether someone
 * else's mission list is worth copying. One row per (template, voter);
 * `value` is +1 or -1, and clearing a vote deletes the row rather than
 * storing a zero. Counts are aggregated on read: a denormalised counter
 * drifts, and the result sets here are one game's worth of lists.
 */
export const checklistVotes = pgTable(
  "checklist_votes",
  {
    templateId: uuid("template_id")
      .notNull()
      .references(() => checklistTemplates.id, { onDelete: "cascade" }),
    userId: text("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    value: smallint("value").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    primaryKey({ columns: [t.templateId, t.userId] }),
    index("checklist_votes_template_idx").on(t.templateId),
  ],
);

export const checklistItems = pgTable(
  "checklist_items",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    templateId: uuid("template_id")
      .notNull()
      .references(() => checklistTemplates.id, { onDelete: "cascade" }),
    position: integer("position").notNull().default(0),
    text: text("text").notNull(),
    category: text("category"),
  },
  (t) => [index("checklist_items_template_idx").on(t.templateId)],
);

/** A row means "this user completed this item" — absence means not done. */
export const userChecklistItems = pgTable(
  "user_checklist_items",
  {
    userId: text("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    itemId: uuid("item_id")
      .notNull()
      .references(() => checklistItems.id, { onDelete: "cascade" }),
    completedAt: timestamp("completed_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [primaryKey({ columns: [t.userId, t.itemId] })],
);
