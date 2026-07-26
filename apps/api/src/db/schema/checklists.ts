import {
  boolean,
  index,
  integer,
  pgTable,
  primaryKey,
  text,
  timestamp,
  uuid,
  type AnyPgColumn,
} from "drizzle-orm/pg-core";
import { games } from "./catalog.js";
import { user } from "./auth.js";
import { checklistKindEnum } from "./enums.js";

/**
 * Completionist checklists (missions, collectibles, endings). No public API
 * has this data, so it's user-created and crowd-sourced in-app: publish a
 * template, other users adopt a private copy and track their own progress.
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
    // estimate; 'completion' is the original free-form collectibles kind
    kind: checklistKindEnum("kind").notNull().default("completion"),
    // wiki page a scraped mission list came from (CC-BY-SA attribution)
    sourceUrl: text("source_url"),
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
