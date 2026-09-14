import { eq } from "drizzle-orm";
import { PUBLISH_MODES, type OwnershipFormat, type PublishMode } from "@gm/shared";
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

/**
 * Whether a list or collection this user creates should be published, kept
 * private, or left for them to decide.
 *
 * Falls back to 'manual' when unset *and* when the stored value isn't one we
 * recognise — an unreadable preference must never be the reason something
 * gets published, so the safe end of the range is the fallback.
 */
export async function publishModeFor(userId: string): Promise<PublishMode> {
  const [row] = await db
    .select({ publishMode: schema.userPreferences.publishMode })
    .from(schema.userPreferences)
    .where(eq(schema.userPreferences.userId, userId));
  const mode = row?.publishMode;
  return PUBLISH_MODES.includes(mode as PublishMode) ? (mode as PublishMode) : "manual";
}

/** Should something created right now be public? */
export async function publishOnCreate(userId: string): Promise<boolean> {
  return (await publishModeFor(userId)) === "always";
}
