import { and, eq, inArray, sql } from "drizzle-orm";
import { z } from "zod";
import { db, schema } from "../db/index.js";
import { ServiceError } from "./service-error.js";

/**
 * Tags, for the web routes (`routes/tags.ts`) and the MCP write tools
 * (`services/mcp-tools.ts`) alike — one schema and one set of ownership
 * checks, so a tag made by Claude is held to exactly what the Tags page
 * holds one to.
 */

export const tagSchema = z.object({
  name: z.string().min(1).max(60),
  color: z
    .string()
    .regex(/^#[0-9a-fA-F]{6}$/, "Color must be a hex value like #8b5cf6")
    .nullable()
    .optional(),
  groupName: z.string().min(1).max(60).nullable().optional(),
});

export type Tag = typeof schema.tags.$inferSelect;

/**
 * Make a tag. A name the user already has, exactly, is a 409 — the
 * `(user_id, name)` unique index decides, so two racing requests can't both
 * win.
 */
export async function createTag(userId: string, input: unknown): Promise<Tag> {
  const parsed = tagSchema.safeParse(input);
  if (!parsed.success) {
    throw new ServiceError(400, parsed.error.issues[0]?.message ?? "Invalid tag");
  }
  const [created] = await db
    .insert(schema.tags)
    .values({
      userId,
      name: parsed.data.name.trim(),
      color: parsed.data.color ?? null,
      groupName: parsed.data.groupName?.trim() || null,
    })
    .onConflictDoNothing()
    .returning();
  if (!created) throw new ServiceError(409, "You already have a tag with that name");
  return created;
}

/**
 * The user's tag with this name, ignoring case — the exact spelling first,
 * if both "Co-op" and "co-op" exist (the unique index is exact, so they can).
 */
export async function findTagByName(userId: string, name: string): Promise<Tag | null> {
  const wanted = name.trim();
  if (!wanted) return null;
  const rows = await db
    .select()
    .from(schema.tags)
    .where(
      and(eq(schema.tags.userId, userId), sql`lower(${schema.tags.name}) = lower(${wanted})`),
    );
  return rows.find((t) => t.name === wanted) ?? rows[0] ?? null;
}

/** Which of these tag ids are the user's — the only tags that may be attached. */
export async function ownedTagIds(userId: string, tagIds: string[]): Promise<string[]> {
  if (tagIds.length === 0) return [];
  const owned = await db
    .select({ id: schema.tags.id })
    .from(schema.tags)
    .where(and(eq(schema.tags.userId, userId), inArray(schema.tags.id, tagIds)));
  const ids = new Set(owned.map((t) => t.id));
  return tagIds.filter((id) => ids.has(id));
}

/** The tag, if it's the user's; a 404 otherwise. */
async function ownedTag(userId: string, tagId: string): Promise<Tag> {
  const [tag] = await db
    .select()
    .from(schema.tags)
    .where(and(eq(schema.tags.id, tagId), eq(schema.tags.userId, userId)));
  if (!tag) throw new ServiceError(404, "Tag not found");
  return tag;
}

/** Which of these library entry ids are the user's, in the order given. */
async function ownedEntryIds(userId: string, entryIds: string[]): Promise<string[]> {
  if (entryIds.length === 0) return [];
  const rows = await db
    .select({ id: schema.userGames.id })
    .from(schema.userGames)
    .where(and(eq(schema.userGames.userId, userId), inArray(schema.userGames.id, entryIds)));
  const ids = new Set(rows.map((r) => r.id));
  return [...new Set(entryIds)].filter((id) => ids.has(id));
}

/**
 * Put one tag on some library entries, leaving every other tag they have
 * alone. This is deliberately *not* `PUT /api/library/:id/tags`, which
 * replaces an entry's whole set — tagging fifty games "Co-op" mustn't strip
 * their other tags.
 *
 * Entries that aren't the user's are skipped, never touched; the caller
 * decides how to report them.
 */
export async function addTagToEntries(
  userId: string,
  tagId: string,
  entryIds: string[],
): Promise<{ tag: Tag; added: string[]; already: string[] }> {
  const tag = await ownedTag(userId, tagId);
  const entries = await ownedEntryIds(userId, entryIds);
  if (entries.length === 0) return { tag, added: [], already: [] };

  const inserted = await db
    .insert(schema.userGameTags)
    .values(entries.map((userGameId) => ({ userGameId, tagId: tag.id })))
    .onConflictDoNothing()
    .returning({ userGameId: schema.userGameTags.userGameId });
  const added = new Set(inserted.map((r) => r.userGameId));
  return {
    tag,
    added: entries.filter((id) => added.has(id)),
    already: entries.filter((id) => !added.has(id)),
  };
}

/**
 * Take one tag off some library entries. Removes the assignment only — the
 * tag itself, and every other entry's use of it, stays.
 */
export async function removeTagFromEntries(
  userId: string,
  tagId: string,
  entryIds: string[],
): Promise<{ tag: Tag; removed: string[]; notTagged: string[] }> {
  const tag = await ownedTag(userId, tagId);
  const entries = await ownedEntryIds(userId, entryIds);
  if (entries.length === 0) return { tag, removed: [], notTagged: [] };

  const deleted = await db
    .delete(schema.userGameTags)
    .where(
      and(eq(schema.userGameTags.tagId, tag.id), inArray(schema.userGameTags.userGameId, entries)),
    )
    .returning({ userGameId: schema.userGameTags.userGameId });
  const removed = new Set(deleted.map((r) => r.userGameId));
  return {
    tag,
    removed: entries.filter((id) => removed.has(id)),
    notTagged: entries.filter((id) => !removed.has(id)),
  };
}
