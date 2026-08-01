import { randomInt } from "node:crypto";
import { eq, or, and } from "drizzle-orm";
import { db, schema } from "../db/index.js";

/**
 * Friend codes.
 *
 * Codes are read off a screen and typed into another device, so the alphabet
 * drops the characters people confuse: O/0, I/1/L, S/5, B/8. 28 symbols over
 * 8 characters is ~38 bits, far too sparse to guess at, and a wrong guess
 * only ever produces a *request* the other person still has to accept.
 */
const ALPHABET = "ACDEFGHJKMNPQRTUVWXYZ2346789";
const GROUP = 4;
const GROUPS = 2;

function randomCode(): string {
  const parts: string[] = [];
  for (let g = 0; g < GROUPS; g++) {
    let part = "";
    for (let i = 0; i < GROUP; i++) part += ALPHABET[randomInt(ALPHABET.length)];
    parts.push(part);
  }
  return `GM-${parts.join("-")}`;
}

/**
 * Normalise what someone typed: case, spaces, dashes, and an optional "GM-"
 * prefix. Returns "" when the result isn't a well-formed code.
 *
 * Deliberately does not "correct" lookalike characters. The excluded ones
 * (O/0, I/L/1, S/5, B) have no unambiguous target — mapping them would risk
 * silently turning one valid code into another. A typo should fail to match,
 * not match something else.
 */
export function normalizeFriendCode(input: string): string {
  const code = input
    .trim()
    .toUpperCase()
    .replace(/[\s-]/g, "")
    .replace(/^GM/, "");
  if (code.length !== GROUP * GROUPS) return "";
  if (![...code].every((c) => ALPHABET.includes(c))) return "";
  return `GM-${code.slice(0, GROUP)}-${code.slice(GROUP)}`;
}

/**
 * The user's friend code, generated on first request. Doing it lazily means
 * existing accounts need no backfill and codes only exist for people who
 * actually opened the friends page.
 */
export async function ensureFriendCode(userId: string): Promise<string> {
  const [existing] = await db
    .select({ friendCode: schema.user.friendCode })
    .from(schema.user)
    .where(eq(schema.user.id, userId));
  if (existing?.friendCode) return existing.friendCode;

  // the column is unique; on the astronomically unlikely collision, retry
  for (let attempt = 0; attempt < 5; attempt++) {
    const code = randomCode();
    try {
      await db.update(schema.user).set({ friendCode: code }).where(eq(schema.user.id, userId));
      return code;
    } catch {
      continue;
    }
  }
  throw new Error("Could not allocate a friend code");
}

/** Accepted friendship between two users, in either direction. */
export async function areFriends(a: string, b: string): Promise<boolean> {
  const [row] = await db
    .select({ id: schema.friendships.id })
    .from(schema.friendships)
    .where(
      and(
        eq(schema.friendships.status, "accepted"),
        or(
          and(eq(schema.friendships.requesterId, a), eq(schema.friendships.addresseeId, b)),
          and(eq(schema.friendships.requesterId, b), eq(schema.friendships.addresseeId, a)),
        ),
      ),
    );
  return !!row;
}
