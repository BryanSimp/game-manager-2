import { index, jsonb, pgTable, text, timestamp, uuid } from "drizzle-orm/pg-core";

/**
 * Append-only behavioral event log, deliberately separate from the
 * operational tables: nothing user-facing reads it, and rows arrive in
 * background batches (services/analytics.ts) so a slow insert can never sit
 * in a request path.
 *
 * `userId` has no FK on purpose — a batched flush must never fail because a
 * user was deleted between the event and the write, and aggregate queries
 * join against `user` anyway, so departed users fall out of current metrics
 * naturally.
 */
export const analyticsEvents = pgTable(
  "analytics_events",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    userId: text("user_id"),
    // sign_up | steam_link | game_added | collection_created | activity | scrape
    type: text("type").notNull(),
    meta: jsonb("meta"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index("analytics_events_type_time_idx").on(t.type, t.createdAt),
    index("analytics_events_user_time_idx").on(t.userId, t.createdAt),
    index("analytics_events_time_idx").on(t.createdAt),
  ],
);
