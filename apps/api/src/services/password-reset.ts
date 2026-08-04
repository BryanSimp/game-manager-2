import { createHash, randomBytes, randomUUID } from "node:crypto";
import { eq, lt } from "drizzle-orm";
import { db, schema } from "../db/index.js";

/**
 * Password-reset tokens, kept apart from better-auth's `verification` table
 * because better-auth stores its reset tokens raw. Only the SHA-256 hash ever
 * touches the database; the raw token exists in the reset email and nowhere
 * else — never in logs.
 */

export const RESET_TOKEN_TTL_MINUTES = 15;

function hashToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

/** Mint a fresh token for the user, replacing any outstanding one. */
export async function createPasswordResetToken(userId: string): Promise<string> {
  const token = randomBytes(32).toString("base64url");
  await db.transaction(async (tx) => {
    // One live token per user; also sweep anything already expired.
    await tx.delete(schema.passwordResetToken).where(eq(schema.passwordResetToken.userId, userId));
    await tx
      .delete(schema.passwordResetToken)
      .where(lt(schema.passwordResetToken.expiresAt, new Date()));
    await tx.insert(schema.passwordResetToken).values({
      id: randomUUID(),
      userId,
      tokenHash: hashToken(token),
      expiresAt: new Date(Date.now() + RESET_TOKEN_TTL_MINUTES * 60 * 1000),
    });
  });
  return token;
}

/**
 * Redeem a raw token: deletes the row (single-use) and returns the user it
 * belonged to, or null if it was unknown or expired.
 */
export async function consumePasswordResetToken(token: string): Promise<string | null> {
  const [row] = await db
    .delete(schema.passwordResetToken)
    .where(eq(schema.passwordResetToken.tokenHash, hashToken(token)))
    .returning({
      userId: schema.passwordResetToken.userId,
      expiresAt: schema.passwordResetToken.expiresAt,
    });
  if (!row || row.expiresAt < new Date()) return null;
  return row.userId;
}
