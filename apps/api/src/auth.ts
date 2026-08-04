import { betterAuth } from "better-auth";
import { drizzleAdapter } from "better-auth/adapters/drizzle";
import { admin, bearer } from "better-auth/plugins";
import { expo } from "@better-auth/expo";
import { count } from "drizzle-orm";
import { db, schema } from "./db/index.js";
import { env } from "./env.js";

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
  plugins: [admin(), bearer(), expo()],
  databaseHooks: {
    user: {
      create: {
        before: async (userData) => {
          // First account ever created becomes the admin.
          const [row] = await db.select({ n: count() }).from(schema.user);
          const isFirst = (row?.n ?? 0) === 0;
          return { data: { ...userData, role: isFirst ? "admin" : "user" } };
        },
      },
    },
  },
});
