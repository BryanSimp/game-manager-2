import { index, pgTable, text, timestamp, uuid } from "drizzle-orm/pg-core";
import { user } from "./auth.js";

/**
 * In-app feedback: bug reports, feature requests and opinions on what's
 * already there, triaged from the admin analytics page.
 *
 * A table rather than the email the marketing contact form sends, because
 * this is a queue: it gets filtered, sorted, marked planned or done, and
 * exported months later. An inbox does none of that.
 *
 * `userId` is nullable with `on delete set null` — a report is worth keeping
 * after the person who filed it leaves (the bug doesn't leave with them), but
 * it stops being attributable, which is the right trade. `kind`, `area` and
 * `status` are text validated by the zod enums in `@gm/shared` rather than pg
 * enums: adding a triage state shouldn't need an ALTER TYPE that can't be
 * used in the transaction that adds it.
 */
export const feedback = pgTable(
  "feedback",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    userId: text("user_id").references(() => user.id, { onDelete: "set null" }),
    // bug | feature_request | feedback
    kind: text("kind").notNull(),
    // which part of the app — see FEEDBACK_AREAS
    area: text("area").notNull(),
    subject: text("subject").notNull(),
    message: text("message").notNull(),
    // new | planned | in_progress | done | declined
    status: text("status").notNull().default("new"),
    /** admin-only triage note; never returned to the submitter */
    adminNote: text("admin_note"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index("feedback_status_time_idx").on(t.status, t.createdAt),
    index("feedback_kind_time_idx").on(t.kind, t.createdAt),
    index("feedback_user_time_idx").on(t.userId, t.createdAt),
  ],
);
