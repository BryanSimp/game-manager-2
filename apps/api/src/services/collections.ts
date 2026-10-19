import { and, asc, eq, inArray, or, sql } from "drizzle-orm";
import { z } from "zod";
import { COLLECTION_NAME_MAX, DEFAULT_COLLECTION_GRAPH_NAME } from "@gm/shared";
import { db, schema } from "../db/index.js";
import { logEvent } from "./analytics.js";
import { inspectAll } from "./content-filter.js";
import { publishModeFor } from "./preferences.js";
import { ServiceError, isUniqueViolation } from "./service-error.js";

/**
 * Making a collection and filling it — shared by the web routes
 * (`routes/collections.ts`) and the MCP write tools, so both run the same
 * schema, the same content filter and the same ownership checks. Also the
 * graph helpers both of those need: every graph of a collection covers all
 * of its games, so anything that adds a game has to place it on each one.
 */

export const collectionSchema = z.object({
  // Trimmed before it's measured: PATCH writes this straight to the row, so
  // without it a rename to "   " was a collection with a blank title, and
  // "Zelda " sat beside "Zelda" as a different name.
  name: z
    .string()
    .trim()
    .min(1, "Give the collection a name")
    .max(COLLECTION_NAME_MAX, `Keep the name to ${COLLECTION_NAME_MAX} characters or fewer`),
  description: z.string().max(2000).nullable().optional(),
  accentColor: z
    .string()
    .regex(/^#[0-9a-fA-F]{6}$/)
    .nullable()
    .optional(),
  isPublic: z.boolean().optional(),
});

export type Collection = typeof schema.collections.$inferSelect;

export async function ownedCollection(userId: string, id: string): Promise<Collection | null> {
  const [row] = await db
    .select()
    .from(schema.collections)
    .where(and(eq(schema.collections.id, id), eq(schema.collections.userId, userId)));
  return row ?? null;
}

/**
 * The user's collection with this name, ignoring case — the exact spelling
 * first, since names are unique exactly and "zelda" may sit beside "Zelda".
 */
export async function findCollectionByName(userId: string, name: string): Promise<Collection | null> {
  const wanted = name.trim();
  if (!wanted) return null;
  const rows = await db
    .select()
    .from(schema.collections)
    .where(
      and(
        eq(schema.collections.userId, userId),
        sql`lower(${schema.collections.name}) = lower(${wanted})`,
      ),
    );
  return rows.find((c) => c.name === wanted) ?? rows[0] ?? null;
}

/**
 * Where the nth game (0-based) lands on a graph nobody has arranged yet: a
 * loose grid, five across, so new nodes don't stack at the origin.
 */
export function gridSlot(n: number): { positionX: number; positionY: number } {
  return { positionX: 80 + (n % 5) * 150, positionY: 80 + Math.floor(n / 5) * 190 };
}

/** A collection's graphs, in tab order. */
export function graphsOf(collectionId: string) {
  return db
    .select()
    .from(schema.collectionGraphs)
    .where(eq(schema.collectionGraphs.collectionId, collectionId))
    .orderBy(asc(schema.collectionGraphs.position), asc(schema.collectionGraphs.createdAt));
}

/**
 * Put a game that has just joined a collection onto every one of its graphs.
 *
 * Each graph is a view of the whole collection, so a new game needs a place on
 * all of them — at the next free grid slot, where you'll see it and can drag
 * it to where it belongs. `n` is how many games the collection held before.
 */
export async function placeOnGraphs(graphIds: string[], gameId: string, n: number): Promise<void> {
  if (graphIds.length === 0) return;
  await db
    .insert(schema.collectionGraphNodes)
    .values(graphIds.map((graphId) => ({ graphId, gameId, ...gridSlot(n) })))
    .onConflictDoNothing();
}

/**
 * Create a collection with its first graph.
 *
 * `visibility` says who decides whether it starts published:
 *  - `"preference"` — the web app's rule. The user's publish mode sets the
 *    default and an explicit `isPublic` in the input wins, except under
 *    `never`, where the mode is the ceiling (see the PATCH route).
 *  - `"private"` — always private, whatever the input or the preference
 *    says. The MCP tools use this: publishing is a deliberate act, and a
 *    model organising your library on your behalf isn't making it.
 *
 * A name the user already has (exactly — that's the unique index) is a 409.
 */
export async function createCollection(
  userId: string,
  input: unknown,
  visibility: "preference" | "private",
): Promise<Collection> {
  const parsed = collectionSchema.safeParse(input);
  if (!parsed.success) {
    throw new ServiceError(400, parsed.error.issues[0]?.message ?? "Invalid collection");
  }
  const issue = inspectAll([parsed.data.name, parsed.data.description]);
  if (issue) {
    logEvent("content_blocked", userId, { surface: "collection", kind: issue.kind });
    throw new ServiceError(400, issue.message);
  }

  let isPublic = false;
  if (visibility === "preference") {
    // Name and description are everything a new collection has, and both just
    // passed the filter, so "publish automatically" has nothing unscanned to
    // expose. An explicit isPublic in the request still wins — the preference
    // decides the default, not the ceiling. Except under 'never', where it is
    // the ceiling: see the PATCH route.
    const mode = await publishModeFor(userId);
    isPublic = mode === "never" ? false : (parsed.data.isPublic ?? mode === "always");
  }

  // the collection and its first graph together, so a collection with no
  // graph tab can't be left behind by a failure between the two
  const created = await db.transaction(async (tx) => {
    const [row] = await tx
      .insert(schema.collections)
      .values({
        userId,
        name: parsed.data.name.trim(),
        description: parsed.data.description ?? null,
        accentColor: parsed.data.accentColor ?? null,
        isPublic,
      })
      .onConflictDoNothing()
      .returning();
    if (!row) return null;
    await tx
      .insert(schema.collectionGraphs)
      .values({ collectionId: row.id, name: DEFAULT_COLLECTION_GRAPH_NAME, position: 1 });
    return row;
  });
  if (!created) throw new ServiceError(409, "You already have a collection with that name");
  logEvent("collection_created", userId, { collectionId: created.id });
  return created;
}

/**
 * Append catalog games to one of the user's collections, in the order given.
 *
 * A collection is a reading list, not an inventory, so the games needn't be
 * in the library — only in the shared catalog. New games go on the end of
 * the flat list and onto every graph; a game already in the collection keeps
 * its place (and its spot on each graph, wherever it was dragged) and comes
 * back in `already`. Repeats within the input count once. `total` is how
 * many games the collection holds afterwards.
 */
export async function addGamesToCollection(
  userId: string,
  collectionId: string,
  gameIds: string[],
): Promise<{ collection: Collection; added: string[]; already: string[]; total: number }> {
  const collection = await ownedCollection(userId, collectionId);
  if (!collection) throw new ServiceError(404, "Collection not found");

  const wanted = [...new Set(gameIds)];
  if (wanted.length > 0) {
    const known = await db
      .select({ id: schema.games.id })
      .from(schema.games)
      .where(inArray(schema.games.id, wanted));
    if (known.length < wanted.length) throw new ServiceError(404, "Game not found");
  }

  const existingRows = await db
    .select({ gameId: schema.collectionGames.gameId })
    .from(schema.collectionGames)
    .where(eq(schema.collectionGames.collectionId, collection.id));
  const present = new Set(existingRows.map((r) => r.gameId));
  let n = existingRows.length;
  const graphIds = (await graphsOf(collection.id)).map((g) => g.id);

  const added: string[] = [];
  const already: string[] = [];
  for (const gameId of wanted) {
    if (present.has(gameId)) {
      already.push(gameId);
      continue;
    }
    const inserted = await db
      .insert(schema.collectionGames)
      // new games land at the end of the flat list
      .values({ collectionId: collection.id, gameId, sortOrder: n + 1 })
      .onConflictDoNothing()
      .returning({ gameId: schema.collectionGames.gameId });
    // only a game that actually joined needs placing — one that raced in
    // from another request already has a spot on every graph
    if (inserted.length === 0) {
      already.push(gameId);
      continue;
    }
    await placeOnGraphs(graphIds, gameId, n);
    present.add(gameId);
    n++;
    added.push(gameId);
  }
  return { collection, added, already, total: n };
}

/**
 * Change a collection's name, description, colour or published state —
 * `PATCH /api/collections/:id`, and the MCP `update_collection` tool (which
 * never passes `isPublic`: publishing is a deliberate act in the app).
 *
 * "Never publish" is a guarantee rather than a default: both apps hide the
 * control, and this refuses anything that asks anyway. Unpublishing is never
 * refused — the setting governs what goes out, not what comes back.
 *
 * Publishing re-checks the whole collection, not just the fields given: a
 * collection written before the filter existed would otherwise walk straight
 * into the public list on an isPublic-only update. Graph names are part of
 * "the whole collection" — they're the tabs a visitor reads.
 */
export async function updateCollection(userId: string, collectionId: string, input: unknown): Promise<Collection> {
  const parsed = collectionSchema.partial().safeParse(input);
  if (!parsed.success) {
    throw new ServiceError(400, parsed.error.issues[0]?.message ?? "Invalid collection");
  }
  const existing = await ownedCollection(userId, collectionId);
  if (!existing) throw new ServiceError(404, "Collection not found");

  if (parsed.data.isPublic === true && (await publishModeFor(userId)) === "never") {
    throw new ServiceError(403, "Publishing is turned off in your preferences");
  }
  const toCheck =
    parsed.data.isPublic === true
      ? [
          parsed.data.name ?? existing.name,
          parsed.data.description ?? existing.description,
          ...(await graphsOf(existing.id)).map((g) => g.name),
        ]
      : [parsed.data.name, parsed.data.description];
  const issue = inspectAll(toCheck);
  if (issue) {
    logEvent("content_blocked", userId, { surface: "collection", kind: issue.kind });
    throw new ServiceError(400, issue.message);
  }
  if (Object.keys(parsed.data).length === 0) return existing;

  try {
    const [updated] = await db
      .update(schema.collections)
      .set(parsed.data)
      .where(and(eq(schema.collections.id, existing.id), eq(schema.collections.userId, userId)))
      .returning();
    if (!updated) throw new ServiceError(404, "Collection not found");
    return updated;
  } catch (err) {
    // (user_id, name) is unique, so renaming onto a name you already use is
    // a 409 like it is on create — not the raw 500 it used to be
    if (isUniqueViolation(err)) throw new ServiceError(409, "You already have a collection with that name");
    throw err;
  }
}

/**
 * Take games out of one of the user's collections: off the flat list, off
 * every graph, and any arrow that touched them. `removed` and `notIn` are
 * catalog ids, so a caller can say which were never there.
 */
export async function removeGamesFromCollection(
  userId: string,
  collectionId: string,
  gameIds: string[],
): Promise<{ collection: Collection; removed: string[]; notIn: string[]; total: number }> {
  const collection = await ownedCollection(userId, collectionId);
  if (!collection) throw new ServiceError(404, "Collection not found");
  const wanted = [...new Set(gameIds)];
  if (wanted.length === 0) {
    const [row] = await db
      .select({ n: sql<number>`count(*)::int` })
      .from(schema.collectionGames)
      .where(eq(schema.collectionGames.collectionId, collection.id));
    return { collection, removed: [], notIn: [], total: row?.n ?? 0 };
  }

  const removed = await db.transaction(async (tx) => {
    const rows = await tx
      .delete(schema.collectionGames)
      .where(and(eq(schema.collectionGames.collectionId, collection.id), inArray(schema.collectionGames.gameId, wanted)))
      .returning({ gameId: schema.collectionGames.gameId });
    const graphIds = (
      await tx
        .select({ id: schema.collectionGraphs.id })
        .from(schema.collectionGraphs)
        .where(eq(schema.collectionGraphs.collectionId, collection.id))
    ).map((g) => g.id);
    if (graphIds.length > 0) {
      await tx
        .delete(schema.collectionGraphNodes)
        .where(
          and(
            inArray(schema.collectionGraphNodes.graphId, graphIds),
            inArray(schema.collectionGraphNodes.gameId, wanted),
          ),
        );
    }
    await tx
      .delete(schema.collectionLinks)
      .where(
        and(
          eq(schema.collectionLinks.collectionId, collection.id),
          or(inArray(schema.collectionLinks.fromGameId, wanted), inArray(schema.collectionLinks.toGameId, wanted)),
        ),
      );
    return rows.map((r) => r.gameId);
  });
  const gone = new Set(removed);
  const [row] = await db
    .select({ n: sql<number>`count(*)::int` })
    .from(schema.collectionGames)
    .where(eq(schema.collectionGames.collectionId, collection.id));
  return { collection, removed, notIn: wanted.filter((id) => !gone.has(id)), total: row?.n ?? 0 };
}

/**
 * Set the flat list order. Independent of the graphs: the list view is for
 * "1, 2, 3…" and a graph is for branches, and people want both.
 *
 * Ids not in the collection are ignored, and anything the caller left out
 * keeps its place after the ones it named, so a stale client can't silently
 * drop a game that was added from another device. `ordered` is how many
 * games the collection holds.
 */
export async function orderCollection(
  userId: string,
  collectionId: string,
  gameIds: string[],
): Promise<{ collection: Collection; ordered: number }> {
  const collection = await ownedCollection(userId, collectionId);
  if (!collection) throw new ServiceError(404, "Collection not found");

  const existing = await db
    .select({ gameId: schema.collectionGames.gameId })
    .from(schema.collectionGames)
    .where(eq(schema.collectionGames.collectionId, collection.id))
    .orderBy(asc(schema.collectionGames.sortOrder));
  const known = new Set(existing.map((e) => e.gameId));
  const ordered = [...new Set(gameIds)].filter((gameId) => known.has(gameId));
  const seen = new Set(ordered);
  const rest = existing.map((e) => e.gameId).filter((gameId) => !seen.has(gameId));

  await db.transaction(async (tx) => {
    let position = 0;
    for (const gameId of [...ordered, ...rest]) {
      position += 1;
      await tx
        .update(schema.collectionGames)
        .set({ sortOrder: position })
        .where(and(eq(schema.collectionGames.collectionId, collection.id), eq(schema.collectionGames.gameId, gameId)));
    }
  });
  return { collection, ordered: existing.length };
}

/**
 * Delete one of the user's collections, with its graphs and arrows. The
 * games stay in the catalog and in the library; copies other people adopted
 * are theirs and stay too (their provenance link is set to null).
 */
export async function deleteCollection(userId: string, collectionId: string): Promise<Collection> {
  const collection = await ownedCollection(userId, collectionId);
  if (!collection) throw new ServiceError(404, "Collection not found");
  await db
    .delete(schema.collections)
    .where(and(eq(schema.collections.id, collection.id), eq(schema.collections.userId, userId)));
  return collection;
}
