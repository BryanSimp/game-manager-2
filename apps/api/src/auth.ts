import { betterAuth } from "better-auth";
import { drizzleAdapter } from "better-auth/adapters/drizzle";
import { admin, bearer, twoFactor } from "better-auth/plugins";
import { expo } from "@better-auth/expo";
import { count, eq } from "drizzle-orm";
import { db, schema } from "./db/index.js";
import { env } from "./env.js";
import { logEvent } from "./services/analytics.js";

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
    },
  }),
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
