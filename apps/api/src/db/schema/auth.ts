import { boolean, index, integer, pgTable, text, timestamp } from "drizzle-orm/pg-core";

// Tables owned by better-auth (email/password + admin + bearer plugins).
// Property names must match better-auth's model fields; column names are snake_case.

export const user = pgTable("user", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  email: text("email").notNull().unique(),
  emailVerified: boolean("email_verified").notNull().default(false),
  image: text("image"),
  // admin plugin
  role: text("role").notNull().default("user"),
  banned: boolean("banned").notNull().default(false),
  banReason: text("ban_reason"),
  banExpires: timestamp("ban_expires", { withTimezone: true }),
  // shareable code others use to send a friend request; generated on first
  // use rather than at signup, so existing accounts don't need a backfill
  friendCode: text("friend_code").unique(),
  // freemium: premium accounts see no ads. Flipped server-side only (admin /
  // future billing webhook) — better-auth's additionalFields marks it
  // input:false so a signup payload can never set it
  isPremium: boolean("is_premium").notNull().default(false),
  // Seeded showcase accounts behind /demo. Set only by scripts/seed-demo.ts,
  // never by a signup — these rows have no `account` row at all, so nobody
  // can sign in as one. The flag exists because a fake account must not be
  // counted as a real one anywhere: it's excluded from the first-user-becomes
  // -admin check, from community averages, and from the analytics user total.
  isDemo: boolean("is_demo").notNull().default(false),
  // two-factor plugin. Written only by better-auth's enable/disable flow —
  // the column is the single question "does signing in need a code", and the
  // secret itself lives in `two_factor` below
  twoFactorEnabled: boolean("two_factor_enabled").notNull().default(false),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

export const session = pgTable("session", {
  id: text("id").primaryKey(),
  expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
  token: text("token").notNull().unique(),
  ipAddress: text("ip_address"),
  userAgent: text("user_agent"),
  userId: text("user_id")
    .notNull()
    .references(() => user.id, { onDelete: "cascade" }),
  // admin plugin
  impersonatedBy: text("impersonated_by"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

export const account = pgTable("account", {
  id: text("id").primaryKey(),
  accountId: text("account_id").notNull(),
  providerId: text("provider_id").notNull(),
  userId: text("user_id")
    .notNull()
    .references(() => user.id, { onDelete: "cascade" }),
  accessToken: text("access_token"),
  refreshToken: text("refresh_token"),
  idToken: text("id_token"),
  accessTokenExpiresAt: timestamp("access_token_expires_at", { withTimezone: true }),
  refreshTokenExpiresAt: timestamp("refresh_token_expires_at", { withTimezone: true }),
  scope: text("scope"),
  password: text("password"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

/*
 * better-auth's two-factor plugin. One row per account that has ever set 2FA
 * up: the TOTP secret an authenticator app shares, and the single-use backup
 * codes (better-auth stores that column as its own encoded blob, hence one
 * text column rather than a codes table).
 *
 * Property names are the plugin's model fields verbatim — the drizzle adapter
 * looks them up by name, so renaming one here breaks sign-in rather than
 * failing to compile. `failedVerificationCount`/`lockedUntil` are the
 * plugin's own brute-force lock on the code prompt, which is why they're
 * columns rather than something we track.
 */
export const twoFactor = pgTable(
  "two_factor",
  {
    id: text("id").primaryKey(),
    secret: text("secret").notNull(),
    backupCodes: text("backup_codes").notNull(),
    userId: text("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    verified: boolean("verified").notNull().default(true),
    failedVerificationCount: integer("failed_verification_count").notNull().default(0),
    lockedUntil: timestamp("locked_until", { withTimezone: true }),
  },
  // every code prompt looks the row up by user, which is the one path that
  // sits between a correct password and a session
  (t) => [index("two_factor_user_idx").on(t.userId)],
);

// Ours, not better-auth's: its built-in reset flow stores tokens *raw* in
// `verification`, so the recovery routes keep their own table holding only a
// SHA-256 hash — a DB leak can't be replayed as a reset link.
export const passwordResetToken = pgTable("password_reset_token", {
  id: text("id").primaryKey(),
  userId: text("user_id")
    .notNull()
    .references(() => user.id, { onDelete: "cascade" }),
  tokenHash: text("token_hash").notNull().unique(),
  expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const verification = pgTable("verification", {
  id: text("id").primaryKey(),
  identifier: text("identifier").notNull(),
  value: text("value").notNull(),
  expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});
