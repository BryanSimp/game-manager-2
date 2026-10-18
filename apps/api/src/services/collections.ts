import { and, asc, eq, inArray, sql } from "drizzle-orm";
import { z } from "zod";
import { COLLECTION_NAME_MAX, DEFAULT_COLLECTION_GRAPH_NAME } from "@gm/shared";
import { db, schema } from "../db/index.js";
import { logEvent } from "./analytics.js";
import { inspectAll } from "./content-filter.js";
import { publishModeFor } from "./preferences.js";
import { ServiceError } from "./service-error.js";

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
