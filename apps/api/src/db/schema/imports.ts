import {
  index,
  integer,
  jsonb,
  pgEnum,
  pgTable,
  real,
  text,
  timestamp,
  uuid,
} from "drizzle-orm/pg-core";
import { user } from "./auth.js";
import { images } from "./catalog.js";

export const importSourceEnum = pgEnum("import_source", [
  "screenshot",
  "shelf_photo",
  "text_paste",
  "steam",
]);

export const importJobStatusEnum = pgEnum("import_job_status", [
  "pending",
  "ocr",
  "matching",
  "review",
  "done",
  "failed",
]);

export const importItemResolutionEnum = pgEnum("import_item_resolution", [
  "pending",
  "auto",
  "manual",
  "skipped",
]);

export const importJobs = pgTable(
  "import_jobs",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    userId: text("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    source: importSourceEnum("source").notNull(),
    status: importJobStatusEnum("status").notNull().default("pending"),
    imageId: uuid("image_id").references(() => images.id),
    error: text("error"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("import_jobs_user_idx").on(t.userId)],
);

export const importItems = pgTable(
  "import_items",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    jobId: uuid("job_id")
      .notNull()
      .references(() => importJobs.id, { onDelete: "cascade" }),
    position: integer("position").notNull().default(0),
    rawText: text("raw_text").notNull(),
    cleanedTitle: text("cleaned_title").notNull(),
    /** [{igdbId, gameId, title, releaseYear, coverSrc}] — top match first */
    candidates: jsonb("candidates"),
    confidence: real("confidence"),
    resolution: importItemResolutionEnum("resolution").notNull().default("pending"),
    // steam imports: the appid behind this row, for dedup on later re-imports
    steamAppId: integer("steam_app_id"),
  },
  (t) => [index("import_items_job_idx").on(t.jobId)],
);
