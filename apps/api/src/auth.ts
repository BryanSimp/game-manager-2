import { betterAuth } from "better-auth";
import { drizzleAdapter } from "better-auth/adapters/drizzle";
import { admin, bearer, twoFactor } from "better-auth/plugins";
import { expo } from "@better-auth/expo";
import { apiKey } from "@better-auth/api-key";
import { oauthProvider } from "@better-auth/oauth-provider";
import { APIError, createAuthMiddleware } from "better-auth/api";
import { count, eq } from "drizzle-orm";
import { API_KEY_NAME_MAX, API_KEY_PREFIX, MCP_SCOPE, MCP_WRITE_SCOPE } from "@gm/shared";
import { db, schema } from "./db/index.js";
import { env } from "./env.js";
import { logEvent } from "./services/analytics.js";
import {
  ADVERTISED_SCOPES,
  MCP_RESOURCE,
  OAUTH_ACCESS_TOKEN_PREFIX,
  OAUTH_REFRESH_TOKEN_PREFIX,
  hashOAuthToken,
  isAllowedRedirectUri,
} from "./services/oauth.js";

/**
 * Plugin endpoints nobody may call over HTTP. `auth.api.*` calls are
 * in-process and unaffected — better-auth only checks this list in its router.
 *
 *  - The api-key plugin's own endpoints: `routes/api-keys.ts` makes and
 *    revokes keys with the owner and the fields decided server-side, so a
 *    browser can't pick its own prefix, expiry or quota.
 *  - The oauth-provider's client and consent management. Any signed-in user
 *    could otherwise create an OAuth client with whatever redirect URI they
 *    liked — skipping the allowlist registration enforces below — and point
 *    other people at its consent screen. Disconnecting an app is
 *    `routes/oauth-connections.ts`, scoped to your own consents.
 */
const DISABLED_PATHS = [
  "/api-key/create",
  "/api-key/get",
  "/api-key/update",
  "/api-key/delete",
  "/api-key/list",
  "/oauth2/create-client",
  "/oauth2/update-client",
  "/oauth2/delete-client",
  "/oauth2/get-client",
  "/oauth2/get-clients",
  "/oauth2/client/rotate-secret",
  "/oauth2/get-consent",
  "/oauth2/get-consents",
  "/oauth2/update-consent",
  "/oauth2/delete-consent",
  "/oauth2/public-client-prelogin",
  "/admin/oauth2/create-client",
  "/admin/oauth2/update-client",
];

/** Every scope the authorization server knows — advertised or not. */
const OAUTH_SCOPES = [MCP_SCOPE, MCP_WRITE_SCOPE, "offline_access", "openid", "profile", "email"];

export const auth = betterAuth({
  secret: env.BETTER_AUTH_SECRET,
  baseURL: env.BETTER_AUTH_URL,
  basePath: "/api/auth",
  database: drizzleAdapter(db, {
    provider: "pg",
    schema: {
      user: schema.user,
      session: schema.session,
      account: schema.account,
      verification: schema.verification,
      // key must be the plugin's model name — the adapter resolves tables by it
      twoFactor: schema.twoFactor,
      apikey: schema.apikey,
      oauthClient: schema.oauthClient,
      oauthRefreshToken: schema.oauthRefreshToken,
      oauthAccessToken: schema.oauthAccessToken,
      oauthConsent: schema.oauthConsent,
    },
  }),
  disabledPaths: DISABLED_PATHS,
  hooks: {
    /*
     * Dynamic client registration is open to anyone (claude.ai registers
     * itself, unauthenticated, the first time someone adds the connector),
     * so this is where it's fenced: a client may only register redirect URIs
     * on the allowlist — Claude's callbacks, loopback, and whatever the
     * operator added. See `isAllowedRedirectUri`.
     */
    before: createAuthMiddleware(async (ctx) => {
      if (ctx.path !== "/oauth2/register") return;
      const uris: unknown = (ctx.body as { redirect_uris?: unknown } | undefined)?.redirect_uris;
      const ok =
        Array.isArray(uris) &&
        uris.length > 0 &&
        uris.every((u) => typeof u === "string" && isAllowedRedirectUri(u));
      if (!ok) {
        throw new APIError("BAD_REQUEST", {
          error: "invalid_redirect_uri",
          error_description:
            "This server only accepts redirect URIs for Claude, loopback addresses, or ones its operator has allowed.",
        });
      }
    }),
  },
  emailAndPassword: {
    enabled: true,
    requireEmailVerification: false,
    disableSignUp: !env.ALLOW_REGISTRATION,
  },
  user: {
    additionalFields: {
      // rides along on session.user for both clients; input:false keeps it
      // out of the signup surface — only server-side code can grant premium
      isPremium: { type: "boolean", defaultValue: false, input: false },
    },
  },
  // exp:// covers Expo Go sessions — a supported client in production too
  // (the server-hosted Metro bundler serves the app to Expo Go, which then
  // signs in against this API), so it stays trusted in every environment
  trustedOrigins: [...env.CORS_ORIGINS, "gamemanager://", "exp://"],
  // Brute-force protection on the credential endpoints. get-session traffic
  // is chatty (every page load), so the general ceiling stays high and only
  // the guessable routes are tight. In-memory storage is fine: one process.
  rateLimit: {
    enabled: true,
    window: 60,
    max: 300,
    customRules: {
      "/sign-in/email": { window: 60, max: 5 },
      "/sign-up/email": { window: 3600, max: 5 },
    },
  },
  plugins: [
    admin(),
    bearer(),
    /*
     * Two-factor sign-in, TOTP only.
     *
     * TOTP rather than emailed codes on purpose: the reset flow already
     * showed that email here is the weakest link — Resend's default sender
     * only delivers to the account owner, so an instance with no verified
     * domain would have 2FA that locks its own admin out. An authenticator
     * app needs no configuration and no third party at sign-in time.
     *
     * `skipVerificationOnEnable` is left off: enabling asks for a code from
     * the app first, so nobody can arm 2FA against a secret they mistyped
     * into their authenticator and lock themselves out on the next sign-in.
     *
     * The 30-day trusted-device cookie is what makes this "only on a new
     * device" rather than "every single sign-in".
     */
    twoFactor({
      // shown as the account name in Google Authenticator / 1Password / Aegis
      issuer: "Game Manager",
      totpOptions: { digits: 6, period: 30 },
      // 30 days, and the reason this feature reads as "a new device" rather
      // than "every sign-in". Stated rather than left to the default because
      // it's the number the Preferences copy promises the user.
      trustDeviceMaxAge: 30 * 24 * 60 * 60,
      // one prompt is one guess in a million; ten tries then a cool-off is
      // generous to a fat-fingered code and useless to a script
      accountLockout: { enabled: true, maxFailedAttempts: 10, durationSeconds: 15 * 60 },
    }),
    /*
     * Personal API keys for the MCP endpoint (`routes/mcp.ts`).
     *
     * Deliberately *not* a way into the rest of the API:
     * `enableSessionForAPIKeys` stays off, so a key presented anywhere but
     * `/api/mcp` is just an unrecognised header, and every write route still
     * needs a real session. What a key can change is therefore exactly what
     * the MCP write tools do, and only when the key was made with "Allow
     * changes" on — recorded in the plugin's server-only `permissions`.
     *
     * The plugin's own HTTP endpoints aren't reachable either (see
     * `DISABLED_PATHS`): `routes/api-keys.ts` calls them server-side with the
     * session's user id, a name and one of two fixed grants. The fixed prefix
     * is how `/api/mcp` tells a key from an OAuth access token at a glance.
     *
     * The plugin's per-key quota is off: its default is ten requests a
     * *day*. `/api/mcp` is rate-limited per caller by @fastify/rate-limit,
     * like every other route that needs it.
     */
    apiKey({
      defaultPrefix: API_KEY_PREFIX,
      requireName: true,
      maximumNameLength: API_KEY_NAME_MAX,
      rateLimit: { enabled: false },
    }),
    /*
     * OAuth 2.1 for claude.ai's custom connectors: dynamic client
     * registration, the normal login (two-factor included — the flow resumes
     * only once a session exists, which for a 2FA account means after the
     * code), a consent screen at /oauth/consent, and an access token for
     * /api/mcp. Replaces the older `mcp` plugin, which better-auth is
     * retiring in favour of this one.
     *
     * - **Opaque tokens, no JWT plugin.** This process is also the resource
     *   server, so it looks tokens up in the table they were written to:
     *   no signing keys to manage, and disconnecting an app is immediate.
     * - **`storeTokens` is our hash**, so `/api/mcp` verifies with the same
     *   function the plugin stored with (`services/oauth.ts`).
     * - **Scopes**: `library:read` is the only one that opens `/api/mcp`;
     *   `library:write` adds the write tools on top of it, and only reaches a
     *   token when the person ticks "Allow changes" on the consent screen
     *   (see `ADVERTISED_SCOPES`). `offline_access` buys a refresh token so
     *   the connector stays connected. The OpenID three are accepted (not
     *   advertised) so a client that asks for them out of habit can still
     *   register.
     * - **No client_credentials grant**: a token must belong to a person,
     *   because every tool answers for one person's library.
     */
    oauthProvider({
      loginPage: "/login",
      consentPage: "/oauth/consent",
      scopes: OAUTH_SCOPES,
      advertisedMetadata: { scopes_supported: ADVERTISED_SCOPES },
      // what a client gets when it registers without naming scopes…
      clientRegistrationDefaultScopes: ADVERTISED_SCOPES,
      // …and what it may name; without this the plugin narrows registration
      // to the defaults and a client asking for `openid` is refused
      clientRegistrationAllowedScopes: OAUTH_SCOPES,
      grantTypes: ["authorization_code", "refresh_token"],
      // the `resource` a client may ask a token for (RFC 8707)
      validAudiences: [MCP_RESOURCE, `${MCP_RESOURCE}/`],
      allowDynamicClientRegistration: true,
      allowUnauthenticatedClientRegistration: true,
      disableJwtPlugin: true,
      storeTokens: { hash: async (token) => hashOAuthToken(token) },
      prefix: {
        opaqueAccessToken: OAUTH_ACCESS_TOKEN_PREFIX,
        refreshToken: OAUTH_REFRESH_TOKEN_PREFIX,
      },
    }),
    expo(),
  ],
  databaseHooks: {
    user: {
      create: {
        before: async (userData) => {
          // First account ever created becomes the admin. Seeded demo
          // accounts don't count — a fresh install that ran the demo seed
          // first would otherwise hand its owner a plain user account with
          // no way to reach Settings.
          const [row] = await db
            .select({ n: count() })
            .from(schema.user)
            .where(eq(schema.user.isDemo, false));
          const isFirst = (row?.n ?? 0) === 0;
          return { data: { ...userData, role: isFirst ? "admin" : "user" } };
        },
        after: async (createdUser) => {
          logEvent("sign_up", createdUser.id);
        },
      },
    },
  },
});
