import type { FastifyInstance } from "fastify";
import { sql } from "drizzle-orm";
import { requestPasswordResetSchema, resetPasswordSchema } from "@gm/shared";
import { auth } from "../auth.js";
import { db, schema } from "../db/index.js";
import { env } from "../env.js";
import { emailConfigured, sendPasswordResetEmail } from "../services/email.js";
import {
  consumePasswordResetToken,
  createPasswordResetToken,
} from "../services/password-reset.js";

/**
 * Password recovery. These are static routes, so Fastify matches them ahead of
 * the better-auth `/api/auth/*` wildcard — deliberately shadowing better-auth's
 * own reset endpoints, which store tokens unhashed. Ours live in
 * `password_reset_token` as SHA-256 hashes (see services/password-reset.ts).
 *
 * The raw token appears in exactly one place: the emailed link. Neither route
 * logs it, and it travels in POST bodies (which Fastify doesn't log).
 */

/** Where reset links land — the web app's /reset-password page. */
function appOrigin(): string {
  return (env.APP_URL ?? env.CORS_ORIGINS[0] ?? env.BETTER_AUTH_URL).replace(/\/+$/, "");
}

// Sliding-window limiter, in-memory: the API is a single process (pg-boss
// rides in it too), so this is enough without another table.
const WINDOW_MS = 15 * 60 * 1000;
const MAX_PER_WINDOW = 3;
const attempts = new Map<string, number[]>();

function rateLimited(key: string): boolean {
  const now = Date.now();
  const recent = (attempts.get(key) ?? []).filter((t) => now - t < WINDOW_MS);
  if (recent.length >= MAX_PER_WINDOW) {
    attempts.set(key, recent);
    return true;
  }
  recent.push(now);
  attempts.set(key, recent);
  return false;
}

// The one response request-reset gives for found and unknown emails alike.
const REQUEST_RESET_REPLY = {
  ok: true as const,
  message: "If an account exists for that address, a reset link is on its way.",
};

export function registerAuthRecoveryRoutes(app: FastifyInstance): void {
  app.post("/api/auth/request-reset", async (request, reply) => {
    const parsed = requestPasswordResetSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.status(400).send({ message: parsed.error.issues[0]?.message });
    }
    const email = parsed.data.email.trim().toLowerCase();

    if (!(await emailConfigured())) {
      // Config state, not account state — reveals nothing about who exists.
      return reply.status(503).send({
        message:
          "Password reset isn't set up on this server yet — an admin needs to add a Resend key in Settings.",
      });
    }
    if (rateLimited(`ip:${request.ip}`) || rateLimited(`email:${email}`)) {
      return reply
        .status(429)
        .send({ message: "Too many reset requests — try again in a few minutes." });
    }

    const [account] = await db
      .select({ id: schema.user.id, email: schema.user.email })
      .from(schema.user)
      .where(sql`lower(${schema.user.email}) = ${email}`);

    if (account) {
      const token = await createPasswordResetToken(account.id);
      const resetUrl = `${appOrigin()}/reset-password?token=${token}`;
      // Fire-and-forget: awaiting Resend would make "account exists" readable
      // from response timing. Failures are logged without the link.
      void sendPasswordResetEmail(account.email, resetUrl).catch((err) => {
        request.log.error(
          { err: err instanceof Error ? err.message : String(err) },
          "password reset email failed to send",
        );
      });
    }
    return REQUEST_RESET_REPLY;
  });

  app.post("/api/auth/reset-password", async (request, reply) => {
    const parsed = resetPasswordSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.status(400).send({ message: parsed.error.issues[0]?.message });
    }

    const userId = await consumePasswordResetToken(parsed.data.token);
    if (!userId) {
      return reply
        .status(400)
        .send({ message: "This reset link is invalid or has expired. Request a new one." });
    }

    // better-auth's own scrypt hash + adapter, so the credential row stays in
    // exactly the shape signIn.email verifies (mirrors its resetPassword).
    const ctx = await auth.$context;
    const hashed = await ctx.password.hash(parsed.data.password);
    const accounts = await ctx.internalAdapter.findAccounts(userId);
    if (accounts.find((a) => a.providerId === "credential")) {
      await ctx.internalAdapter.updatePassword(userId, hashed);
    } else {
      await ctx.internalAdapter.createAccount({
        userId,
        providerId: "credential",
        accountId: userId,
        password: hashed,
      });
    }
    // A reset means the old password may be compromised — sign out everywhere.
    await ctx.internalAdapter.deleteUserSessions(userId);

    return { ok: true as const };
  });
}
