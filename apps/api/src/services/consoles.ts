import { and, eq, inArray, isNull } from "drizzle-orm";
import { db, schema } from "../db/index.js";
import { getIgdbPlatform, igdbConfigured, igdbLogoUrl } from "./igdb.js";

/**
 * The consoles a user owns and the platforms their games are filed under are
 * meant to be the same list. Anything that files a game under a platform
 * calls this, so picking "add new console" in a game's platform picker — or a
 * Steam import, or a bulk edit — keeps the consoles page honest.
 */
export async function rememberConsoles(userId: string, platformIds: string[]): Promise<void> {
  const unique = await withParents([...new Set(platformIds)]);
  if (unique.length === 0) return;
  await db
    .insert(schema.userConsoles)
    .values(unique.map((platformId) => ({ userId, platformId })))
    .onConflictDoNothing();
}

/** Platform ids on this user's consoles list. */
export async function ownedConsoleIds(userId: string): Promise<Set<string>> {
  const rows = await db
    .select({ platformId: schema.userConsoles.platformId })
    .from(schema.userConsoles)
    .where(eq(schema.userConsoles.userId, userId));
  return new Set(rows.map((r) => r.platformId));
}

/**
 * Owning a storefront implies owning what it runs on: adding Steam without PC
 * would leave a game filed under Steam invisible to anything that groups by
 * the parent platform.
 */
export async function withParents(platformIds: string[]): Promise<string[]> {
  if (platformIds.length === 0) return [];
  const rows = await db
    .select({ id: schema.platforms.id, parentId: schema.platforms.parentPlatformId })
    .from(schema.platforms)
    .where(inArray(schema.platforms.id, platformIds));
  const out = new Set(platformIds);
  for (const row of rows) if (row.parentId) out.add(row.parentId);
  return [...out];
}

/**
 * Fill in a platform's logo (and summary, where the seed left one blank) from
 * IGDB. `metaFetchedAt` is stamped either way so a platform IGDB doesn't know
 * — the PC storefronts, mostly — is asked about once and then left alone.
 */
export async function ensurePlatformMeta(platformId: string): Promise<void> {
  const [platform] = await db
    .select()
    .from(schema.platforms)
    .where(eq(schema.platforms.id, platformId));
  if (!platform || platform.metaFetchedAt) return;
  if (!(await igdbConfigured())) return; // try again once credentials exist

  const meta = platform.igdbPlatformId ? await getIgdbPlatform(platform.igdbPlatformId) : null;
  await db
    .update(schema.platforms)
    .set({
      metaFetchedAt: new Date(),
      ...(meta?.platform_logo && { logoUrl: igdbLogoUrl(meta.platform_logo.image_id) }),
      // the curated seed summary wins; IGDB only fills a gap
      ...(meta?.summary && !platform.summary && { summary: meta.summary }),
    })
    .where(eq(schema.platforms.id, platform.id));
}

/** Kick off metadata lookups for platforms that have never been tried. */
export async function backfillPlatformMeta(platformIds: string[], limit = 4): Promise<void> {
  if (platformIds.length === 0) return;
  const pending = await db
    .select({ id: schema.platforms.id })
    .from(schema.platforms)
    .where(and(inArray(schema.platforms.id, platformIds), isNull(schema.platforms.metaFetchedAt)))
    .limit(limit);
  for (const p of pending) {
    // fire and forget — the page renders fine without a logo
    void ensurePlatformMeta(p.id).catch(() => {});
  }
}
