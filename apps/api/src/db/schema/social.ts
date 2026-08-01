import { index, pgTable, text, timestamp, unique, uuid } from "drizzle-orm/pg-core";
import { user } from "./auth.js";
import { friendshipStatusEnum } from "./enums.js";

/**
 * Friendships, established by friend code.
 *
 * Deliberately two-step: entering someone's code creates a *pending* row and
 * they have to accept. A library says a lot about a person, so knowing a code
 * shouldn't be enough to read one — the same reason console friend codes ask
 * for confirmation.
 *
 * One row per pair. Which side is requester/addressee is history, not
 * meaning, so "my friends" has to look at both columns.
 */
export const friendships = pgTable(
  "friendships",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    requesterId: text("requester_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    addresseeId: text("addressee_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    status: friendshipStatusEnum("status").notNull().default("pending"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    respondedAt: timestamp("responded_at", { withTimezone: true }),
  },
  (t) => [
    // stops a duplicate request in the same direction; the reverse direction
    // is handled in the route, which accepts the existing request instead
    unique().on(t.requesterId, t.addresseeId),
    index("friendships_requester_idx").on(t.requesterId),
    index("friendships_addressee_idx").on(t.addresseeId),
  ],
);
