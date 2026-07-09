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
  trustedOrigins: [...env.CORS_ORIGINS, "gamemanager://"],
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
