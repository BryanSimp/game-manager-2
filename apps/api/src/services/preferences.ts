import { eq } from "drizzle-orm";
import type { OwnershipFormat } from "@gm/shared";
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

/**
 * Which platform a newly added game is filed under, when the caller didn't
 * say. Null when the preference is unset — most people add games from several
 * consoles, so there's no sensible fallback to invent here.
 */
export async function defaultPlatformFor(
  userId: string,
): Promise<{ platformId: string; format: OwnershipFormat } | null> {
  const [row] = await db
    .select({
      platformId: schema.userPreferences.defaultPlatformId,
      format: schema.userPreferences.defaultPlatformFormat,
    })
    .from(schema.userPreferences)
    .where(eq(schema.userPreferences.userId, userId));
  if (!row?.platformId) return null;
  return { platformId: row.platformId, format: row.format };
}
