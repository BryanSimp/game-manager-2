import { boolean, index, integer, jsonb, pgTable, text, timestamp } from "drizzle-orm/pg-core";

// Tables owned by better-auth (email/password + admin + bearer + two-factor
// + api-key + oauth-provider plugins).
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

/*
 * better-auth's API key plugin (`@better-auth/api-key`): personal keys for
 * the read-only MCP endpoint, so Claude Code can read your library without a
 * browser session.
 *
 * `key` is a SHA-256 hash, never the key itself — the plaintext is returned
 * once, by the create call, and is unrecoverable after that. `start` is the
 * first few characters in the clear, which is what the API keys card shows
 * so you can tell two keys apart. `referenceId` is the owning user.
 *
 * Property names are the plugin's model fields verbatim, for the same reason
 * as `twoFactor` above. Most of the counters (`requestCount`, `remaining`,
 * the refill pair) back the plugin's own quota system, which is switched off
 * in `auth.ts` — `/api/mcp` is rate-limited per key by @fastify/rate-limit
 * instead — but the plugin writes every column, so they all have to exist.
 */
export const apikey = pgTable(
  "api_key",
  {
    id: text("id").primaryKey(),
    configId: text("config_id").notNull().default("default"),
    name: text("name"),
    start: text("start"),
    prefix: text("prefix"),
    key: text("key").notNull(),
    referenceId: text("reference_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    refillInterval: integer("refill_interval"),
    refillAmount: integer("refill_amount"),
    lastRefillAt: timestamp("last_refill_at", { withTimezone: true }),
    enabled: boolean("enabled").notNull().default(true),
    rateLimitEnabled: boolean("rate_limit_enabled").notNull().default(true),
    rateLimitTimeWindow: integer("rate_limit_time_window"),
    rateLimitMax: integer("rate_limit_max"),
    requestCount: integer("request_count").notNull().default(0),
    remaining: integer("remaining"),
    lastRequest: timestamp("last_request", { withTimezone: true }),
    expiresAt: timestamp("expires_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
    permissions: text("permissions"),
    metadata: text("metadata"),
  },
  (t) => [
    // every MCP request looks its key up by hash; the card lists by owner
    index("api_key_key_idx").on(t.key),
    index("api_key_reference_idx").on(t.referenceId),
  ],
);

/*
 * better-auth's OAuth 2.1 provider (`@better-auth/oauth-provider`), which is
 * how claude.ai's custom connectors sign in: they register themselves
 * (dynamic client registration), send you through the normal login and a
 * consent screen, and get an access token for `/api/mcp`.
 *
 * Property names are the plugin's model fields verbatim, as above; the
 * plugin's `string[]` fields are real `text[]` columns, because the drizzle
 * adapter reports array support for Postgres. Tokens are stored hashed —
 * `storeTokens` in `auth.ts` hands the plugin `hashOAuthToken`, which is also
 * what `/api/mcp` looks a presented token up by. Clients are referenced by
 * their public `client_id`, not their row id, because that's the key the
 * plugin joins on.
 */
export const oauthClient = pgTable("oauth_client", {
  id: text("id").primaryKey(),
  clientId: text("client_id").notNull().unique(),
  clientSecret: text("client_secret"),
  disabled: boolean("disabled").default(false),
  skipConsent: boolean("skip_consent"),
  enableEndSession: boolean("enable_end_session"),
  subjectType: text("subject_type"),
  scopes: text("scopes").array(),
  // set when a signed-in user registered the client; dynamic registration
  // from claude.ai is unauthenticated, so it's usually null
  userId: text("user_id").references(() => user.id, { onDelete: "cascade" }),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow(),
  name: text("name"),
  uri: text("uri"),
  icon: text("icon"),
  contacts: text("contacts").array(),
  tos: text("tos"),
  policy: text("policy"),
  softwareId: text("software_id"),
  softwareVersion: text("software_version"),
  softwareStatement: text("software_statement"),
  redirectUris: text("redirect_uris").array().notNull(),
  postLogoutRedirectUris: text("post_logout_redirect_uris").array(),
  tokenEndpointAuthMethod: text("token_endpoint_auth_method"),
  grantTypes: text("grant_types").array(),
  responseTypes: text("response_types").array(),
  public: boolean("public"),
  type: text("type"),
  requirePKCE: boolean("require_pkce"),
  referenceId: text("reference_id"),
  metadata: jsonb("metadata"),
});

export const oauthRefreshToken = pgTable(
  "oauth_refresh_token",
  {
    id: text("id").primaryKey(),
    token: text("token").notNull().unique(),
    clientId: text("client_id")
      .notNull()
      .references(() => oauthClient.clientId, { onDelete: "cascade" }),
    sessionId: text("session_id").references(() => session.id, { onDelete: "set null" }),
    userId: text("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    referenceId: text("reference_id"),
    expiresAt: timestamp("expires_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow(),
    revoked: timestamp("revoked", { withTimezone: true }),
    authTime: timestamp("auth_time", { withTimezone: true }),
    scopes: text("scopes").array().notNull(),
  },
  (t) => [
    index("oauth_refresh_token_client_idx").on(t.clientId),
    index("oauth_refresh_token_user_idx").on(t.userId),
  ],
);

export const oauthAccessToken = pgTable(
  "oauth_access_token",
  {
    id: text("id").primaryKey(),
    // the hash; every /api/mcp request with an OAuth token looks this up
    token: text("token").unique(),
    clientId: text("client_id")
      .notNull()
      .references(() => oauthClient.clientId, { onDelete: "cascade" }),
    sessionId: text("session_id").references(() => session.id, { onDelete: "set null" }),
    userId: text("user_id").references(() => user.id, { onDelete: "cascade" }),
    referenceId: text("reference_id"),
    refreshId: text("refresh_id").references(() => oauthRefreshToken.id, { onDelete: "cascade" }),
    expiresAt: timestamp("expires_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow(),
    scopes: text("scopes").array().notNull(),
  },
  (t) => [
    index("oauth_access_token_client_idx").on(t.clientId),
    index("oauth_access_token_user_idx").on(t.userId),
  ],
);

/** "You said yes to this app, for these scopes." Deleting it is disconnecting. */
export const oauthConsent = pgTable(
  "oauth_consent",
  {
    id: text("id").primaryKey(),
    clientId: text("client_id")
      .notNull()
      .references(() => oauthClient.clientId, { onDelete: "cascade" }),
    userId: text("user_id").references(() => user.id, { onDelete: "cascade" }),
    referenceId: text("reference_id"),
    scopes: text("scopes").array().notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow(),
  },
  (t) => [
    index("oauth_consent_client_idx").on(t.clientId),
    index("oauth_consent_user_idx").on(t.userId),
  ],
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
