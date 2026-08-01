import { eq } from "drizzle-orm";
import { db, schema } from "../db/index.js";
import { isValidCategory } from "./categories.js";

/**
 * Which category a newly added game lands in. Falls back to 'backlog' when
 * unset, and also when the stored default points at a category that no
 * longer exists — a stale preference shouldn't block adding a game.
 */
export async function defaultStatusFor(userId: string): Promise<string> {
  const [row] = await db
    .select({ defaultStatus: schema.userPreferences.defaultStatus })
    .from(schema.userPreferences)
    .where(eq(schema.userPreferences.userId, userId));
  const key = row?.defaultStatus;
  if (!key) return "backlog";
  return (await isValidCategory(userId, key)) ? key : "backlog";
}
