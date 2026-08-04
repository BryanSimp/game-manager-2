import type { FastifyInstance } from "fastify";
import { and, asc, count, eq, inArray, sql } from "drizzle-orm";
import { z } from "zod";
import { OWNERSHIP_FORMATS } from "@gm/shared";
import { db, schema } from "../db/index.js";
import { requireUser } from "../plugins/auth.js";
import { upsertGameFromIgdb } from "../services/catalog.js";
import { logEvent } from "../services/analytics.js";
import { isValidCategory } from "../services/categories.js";
import { rememberConsoles } from "../services/consoles.js";
import { inspectAll } from "../services/content-filter.js";

const collectionSchema = z.object({
  name: z.string().min(1).max(100),
  description: z.string().max(2000).nullable().optional(),
  accentColor: z
    .string()
    .regex(/^#[0-9a-fA-F]{6}$/)
    .nullable()
    .optional(),
  isPublic: z.boolean().optional(),
});

/** A handful of covers for a collection card, in play-order-ish layout order. */
const PREVIEW_LIMIT = 5;

const layoutSchema = z.object({
  nodes: z
    .array(
      z.object({
        gameId: z.string().uuid(),
        x: z.number().min(-10_000).max(10_000),
        y: z.number().min(-10_000).max(10_000),
      }),
    )
    .max(200),
  links: z
    .array(
      z.object({
        fromGameId: z.string().uuid(),
        toGameId: z.string().uuid(),
        label: z.string().max(60).nullable().optional(),
      }),
    )
    .max(400),
});

/** Postgres unique-violation, however deeply drizzle has wrapped it. */
function isUniqueViolation(err: unknown): boolean {
  for (let e = err; e instanceof Error; e = (e as { cause?: unknown }).cause) {
    if ((e as { code?: string }).code === "23505") return true;
  }
  return false;
}

async function ownedCollection(userId: string, id: string) {
  const [row] = await db
    .select()
    .from(schema.collections)
    .where(and(eq(schema.collections.id, id), eq(schema.collections.userId, userId)));
  return row ?? null;
}

function gameCover(game: {
  coverImageId: string | null;
  coverUrl: string | null;
  customCoverImageId?: string | null;
}): string | null {
  return game.coverImageId ? `/api/images/${game.coverImageId}` : game.coverUrl;
}

/** Cover previews for a set of collections, keyed by collection id. */
async function previewsFor(
  collectionIds: string[],
): Promise<Map<string, Array<{ gameId: string; title: string; coverSrc: string | null }>>> {
  const byCollection = new Map<
    string,
    Array<{ gameId: string; title: string; coverSrc: string | null }>
  >();
  if (collectionIds.length === 0) return byCollection;

  const rows = await db
    .select({
      collectionId: schema.collectionGames.collectionId,
      gameId: schema.games.id,
      title: schema.games.title,
      coverImageId: schema.games.coverImageId,
      coverUrl: schema.games.coverUrl,
      sortOrder: schema.collectionGames.sortOrder,
    })
    .from(schema.collectionGames)
    .innerJoin(schema.games, eq(schema.games.id, schema.collectionGames.gameId))
    .where(inArray(schema.collectionGames.collectionId, collectionIds))
    .orderBy(asc(schema.collectionGames.sortOrder));

  for (const row of rows) {
    const list = byCollection.get(row.collectionId) ?? [];
    if (list.length < PREVIEW_LIMIT) {
      list.push({ gameId: row.gameId, title: row.title, coverSrc: gameCover(row) });
    }
    byCollection.set(row.collectionId, list);
  }
  return byCollection;
}

export function registerCollectionRoutes(app: FastifyInstance): void {
  app.get("/api/collections", async (request, reply) => {
    const user = await requireUser(request, reply);
    if (!user) return;
    const rows = await db
      .select()
      .from(schema.collections)
      .where(eq(schema.collections.userId, user.id))
      .orderBy(asc(schema.collections.name));

    // roll-up stats: total games + user's finished count per collection
    const stats = await db
      .select({
        collectionId: schema.collectionGames.collectionId,
        total: count(),
        finished: sql<number>`count(*) filter (where ${schema.userGames.status} = 'finished')`,
      })
      .from(schema.collectionGames)
      .leftJoin(
        schema.userGames,
        and(
          eq(schema.userGames.gameId, schema.collectionGames.gameId),
          eq(schema.userGames.userId, user.id),
        ),
      )
      .groupBy(schema.collectionGames.collectionId);
    const statMap = new Map(stats.map((s) => [s.collectionId, s]));
    const previews = await previewsFor(rows.map((c) => c.id));

    return rows.map((c) => ({
      id: c.id,
      name: c.name,
      description: c.description,
      accentColor: c.accentColor,
      isPublic: c.isPublic,
      adoptedFromId: c.adoptedFromId,
      total: statMap.get(c.id)?.total ?? 0,
      finished: Number(statMap.get(c.id)?.finished ?? 0),
      preview: previews.get(c.id) ?? [],
    }));
  });

  /**
   * Every published collection, anyone's. Ordered newest first so a freshly
   * shared one is findable; yours are included and flagged rather than hidden,
   * so you can see what other people see.
   */
  app.get("/api/collections/public", async (request, reply) => {
    const user = await requireUser(request, reply);
    if (!user) return;

    const rows = await db
      .select({
        id: schema.collections.id,
        name: schema.collections.name,
        description: schema.collections.description,
        accentColor: schema.collections.accentColor,
        userId: schema.collections.userId,
        authorName: schema.user.name,
        createdAt: schema.collections.createdAt,
      })
      .from(schema.collections)
      .innerJoin(schema.user, eq(schema.user.id, schema.collections.userId))
      .where(eq(schema.collections.isPublic, true))
      .orderBy(sql`${schema.collections.createdAt} desc`);

    if (rows.length === 0) return [];

    const totals = await db
      .select({ collectionId: schema.collectionGames.collectionId, total: count() })
      .from(schema.collectionGames)
      .where(
        inArray(
          schema.collectionGames.collectionId,
          rows.map((r) => r.id),
        ),
      )
      .groupBy(schema.collectionGames.collectionId);
    const totalMap = new Map(totals.map((t) => [t.collectionId, t.total]));

    // which of these you've already taken a copy of
    const mine = await db
      .select({ adoptedFromId: schema.collections.adoptedFromId })
      .from(schema.collections)
      .where(eq(schema.collections.userId, user.id));
    const adopted = new Set(mine.map((m) => m.adoptedFromId).filter(Boolean) as string[]);

    const previews = await previewsFor(rows.map((r) => r.id));

    return rows.map((r) => ({
      id: r.id,
      name: r.name,
      description: r.description,
      accentColor: r.accentColor,
      authorName: r.authorName,
      total: totalMap.get(r.id) ?? 0,
      adopted: adopted.has(r.id),
      mine: r.userId === user.id,
      preview: previews.get(r.id) ?? [],
    }));
  });

  /**
   * Take a private copy of a public collection — games, positions and play
   * order included.
   *
   * A copy rather than a live reference, same as adopting a checklist: your
   * edits mustn't reach the original, and the author rearranging their play
   * order mustn't rearrange a marathon you're halfway through.
   */
  app.post<{ Params: { id: string } }>("/api/collections/:id/adopt", async (request, reply) => {
    const user = await requireUser(request, reply);
    if (!user) return;

    const [source] = await db
      .select()
      .from(schema.collections)
      .where(and(eq(schema.collections.id, request.params.id), eq(schema.collections.isPublic, true)));
    if (!source) return reply.status(404).send({ message: "Collection not found" });
    if (source.userId === user.id) {
      return reply.status(400).send({ message: "That's already your collection" });
    }

    // the (user, name) unique constraint means a second copy needs a new name
    const existing = await db
      .select({ name: schema.collections.name })
      .from(schema.collections)
      .where(eq(schema.collections.userId, user.id));
    const taken = new Set(existing.map((e) => e.name));
    let name = source.name;
    for (let n = 2; taken.has(name); n += 1) name = `${source.name} (${n})`;

    const [copy] = await db
      .insert(schema.collections)
      .values({
        userId: user.id,
        name,
        description: source.description,
        accentColor: source.accentColor,
        // a copy starts private — publishing someone else's list is their call
        isPublic: false,
        adoptedFromId: source.id,
      })
      .returning();
    if (!copy) return reply.status(500).send({ message: "Couldn't copy that collection" });

    const games = await db
      .select()
      .from(schema.collectionGames)
      .where(eq(schema.collectionGames.collectionId, source.id));
    if (games.length > 0) {
      await db.insert(schema.collectionGames).values(
        games.map((g) => ({
          collectionId: copy.id,
          gameId: g.gameId,
          positionX: g.positionX,
          positionY: g.positionY,
          sortOrder: g.sortOrder,
        })),
      );
    }

    const links = await db
      .select()
      .from(schema.collectionLinks)
      .where(eq(schema.collectionLinks.collectionId, source.id));
    if (links.length > 0) {
      await db.insert(schema.collectionLinks).values(
        links.map((l) => ({
          collectionId: copy.id,
          fromGameId: l.fromGameId,
          toGameId: l.toGameId,
          label: l.label,
        })),
      );
    }

    logEvent("collection_created", user.id, { collectionId: copy.id, adopted: true });
    reply.status(201);
    return { id: copy.id, name: copy.name };
  });

  app.post("/api/collections", async (request, reply) => {
    const user = await requireUser(request, reply);
    if (!user) return;
    const parsed = collectionSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.status(400).send({ message: parsed.error.issues[0]?.message });
    }
    const issue = inspectAll([parsed.data.name, parsed.data.description]);
    if (issue) {
      logEvent("content_blocked", user.id, { surface: "collection", kind: issue.kind });
      return reply.status(400).send({ message: issue.message });
    }
    const [created] = await db
      .insert(schema.collections)
      .values({
        userId: user.id,
        name: parsed.data.name.trim(),
        description: parsed.data.description ?? null,
        accentColor: parsed.data.accentColor ?? null,
      })
      .onConflictDoNothing()
      .returning();
    if (!created) {
      return reply.status(409).send({ message: "You already have a collection with that name" });
    }
    logEvent("collection_created", user.id, { collectionId: created.id });
    reply.status(201);
    return created;
  });

  app.patch<{ Params: { id: string } }>("/api/collections/:id", async (request, reply) => {
    const user = await requireUser(request, reply);
    if (!user) return;
    const parsed = collectionSchema.partial().safeParse(request.body);
    if (!parsed.success) {
      return reply.status(400).send({ message: parsed.error.issues[0]?.message });
    }
    const existing = await ownedCollection(user.id, request.params.id);
    if (!existing) return reply.status(404).send({ message: "Collection not found" });

    // Publishing re-checks the whole collection, not just the fields in this
    // request: a collection written before the filter existed would otherwise
    // walk straight into the public list on an isPublic-only PATCH.
    const toCheck =
      parsed.data.isPublic === true
        ? [parsed.data.name ?? existing.name, parsed.data.description ?? existing.description]
        : [parsed.data.name, parsed.data.description];
    const issue = inspectAll(toCheck);
    if (issue) {
      logEvent("content_blocked", user.id, { surface: "collection", kind: issue.kind });
      return reply.status(400).send({ message: issue.message });
    }

    let updated;
    try {
      updated = await db
        .update(schema.collections)
        .set(parsed.data)
        .where(
          and(eq(schema.collections.id, request.params.id), eq(schema.collections.userId, user.id)),
        )
        .returning();
    } catch (err) {
      // (user_id, name) is unique, so renaming onto a name you already use is
      // a 409 like it is on create — not the raw 500 it used to be
      if (isUniqueViolation(err)) {
        return reply.status(409).send({ message: "You already have a collection with that name" });
      }
      throw err;
    }
    if (updated.length === 0) return reply.status(404).send({ message: "Collection not found" });
    return updated[0];
  });

  app.delete<{ Params: { id: string } }>("/api/collections/:id", async (request, reply) => {
    const user = await requireUser(request, reply);
    if (!user) return;
    const deleted = await db
      .delete(schema.collections)
      .where(and(eq(schema.collections.id, request.params.id), eq(schema.collections.userId, user.id)))
      .returning({ id: schema.collections.id });
    if (deleted.length === 0) return reply.status(404).send({ message: "Collection not found" });
    return { ok: true };
  });

  app.get<{ Params: { id: string } }>("/api/collections/:id", async (request, reply) => {
    const user = await requireUser(request, reply);
    if (!user) return;
    const collection = await ownedCollection(user.id, request.params.id);
    if (!collection) return reply.status(404).send({ message: "Collection not found" });

    const nodes = await db
      .select({
        gameId: schema.collectionGames.gameId,
        x: schema.collectionGames.positionX,
        y: schema.collectionGames.positionY,
        sortOrder: schema.collectionGames.sortOrder,
        title: schema.games.title,
        releaseDate: schema.games.releaseDate,
        ttbMain: schema.games.ttbMain,
        coverImageId: schema.games.coverImageId,
        coverUrl: schema.games.coverUrl,
        userGameId: schema.userGames.id,
        status: schema.userGames.status,
      })
      .from(schema.collectionGames)
      .innerJoin(schema.games, eq(schema.collectionGames.gameId, schema.games.id))
      .leftJoin(
        schema.userGames,
        and(
          eq(schema.userGames.gameId, schema.collectionGames.gameId),
          eq(schema.userGames.userId, user.id),
        ),
      )
      .where(eq(schema.collectionGames.collectionId, collection.id));

    const links = await db
      .select()
      .from(schema.collectionLinks)
      .where(eq(schema.collectionLinks.collectionId, collection.id));

    return {
      id: collection.id,
      name: collection.name,
      description: collection.description,
      accentColor: collection.accentColor,
      isPublic: collection.isPublic,
      adoptedFromId: collection.adoptedFromId,
      games: nodes.map((n) => ({
        gameId: n.gameId,
        title: n.title,
        coverSrc: gameCover(n),
        x: n.x,
        y: n.y,
        sortOrder: n.sortOrder,
        releaseDate: n.releaseDate,
        ttbMain: n.ttbMain,
        userGameId: n.userGameId,
        status: n.status,
      })),
      links: links.map((l) => ({
        id: l.id,
        fromGameId: l.fromGameId,
        toGameId: l.toGameId,
        label: l.label,
      })),
    };
  });

  app.post<{ Params: { id: string } }>("/api/collections/:id/games", async (request, reply) => {
    const user = await requireUser(request, reply);
    if (!user) return;
    const collection = await ownedCollection(user.id, request.params.id);
    if (!collection) return reply.status(404).send({ message: "Collection not found" });

    // A collection is a reading list, not an inventory: "the Zelda games in
    // order" makes sense whether or not you own all of them. `igdbId` pulls a
    // game into the shared catalog without touching your library.
    const parsed = z
      .object({
        gameId: z.string().uuid().optional(),
        igdbId: z.number().int().positive().optional(),
      })
      .refine((v) => v.gameId || v.igdbId, { message: "gameId or igdbId required" })
      .safeParse(request.body);
    if (!parsed.success) {
      return reply.status(400).send({ message: parsed.error.issues[0]?.message });
    }

    let gameId = parsed.data.gameId ?? null;
    if (!gameId && parsed.data.igdbId) {
      try {
        gameId = await upsertGameFromIgdb(parsed.data.igdbId);
      } catch (err) {
        return reply
          .status(502)
          .send({ message: err instanceof Error ? err.message : "IGDB lookup failed" });
      }
    }
    if (!gameId) return reply.status(400).send({ message: "gameId or igdbId required" });

    // place new nodes in a loose grid so they don't stack at the origin
    const [countRow] = await db
      .select({ n: count() })
      .from(schema.collectionGames)
      .where(eq(schema.collectionGames.collectionId, collection.id));
    const n = countRow?.n ?? 0;
    await db
      .insert(schema.collectionGames)
      .values({
        collectionId: collection.id,
        gameId,
        positionX: 80 + (n % 5) * 150,
        positionY: 80 + Math.floor(n / 5) * 190,
        // new games land at the end of the flat list
        sortOrder: n + 1,
      })
      .onConflictDoNothing();
    return { ok: true, gameId };
  });

  app.delete<{ Params: { id: string; gameId: string } }>(
    "/api/collections/:id/games/:gameId",
    async (request, reply) => {
      const user = await requireUser(request, reply);
      if (!user) return;
      const collection = await ownedCollection(user.id, request.params.id);
      if (!collection) return reply.status(404).send({ message: "Collection not found" });
      await db
        .delete(schema.collectionGames)
        .where(
          and(
            eq(schema.collectionGames.collectionId, collection.id),
            eq(schema.collectionGames.gameId, request.params.gameId),
          ),
        );
      await db
        .delete(schema.collectionLinks)
        .where(
          and(
            eq(schema.collectionLinks.collectionId, collection.id),
            sql`(${schema.collectionLinks.fromGameId} = ${request.params.gameId} or ${schema.collectionLinks.toGameId} = ${request.params.gameId})`,
          ),
        );
      return { ok: true };
    },
  );

  /**
   * Set the flat list order. Independent of the graph: the list view is for
   * "1, 2, 3…" and the graph is for branches, and people want both.
   *
   * Ids not in the collection are ignored, and anything the caller left out
   * keeps its place at the end, so a stale client can't silently drop a game
   * that was added from another device.
   */
  app.put<{ Params: { id: string } }>("/api/collections/:id/order", async (request, reply) => {
    const user = await requireUser(request, reply);
    if (!user) return;
    const collection = await ownedCollection(user.id, request.params.id);
    if (!collection) return reply.status(404).send({ message: "Collection not found" });

    const parsed = z
      .object({ gameIds: z.array(z.string().uuid()).max(500) })
      .safeParse(request.body);
    if (!parsed.success) return reply.status(400).send({ message: "gameIds required" });

    const existing = await db
      .select({ gameId: schema.collectionGames.gameId })
      .from(schema.collectionGames)
      .where(eq(schema.collectionGames.collectionId, collection.id));
    const known = new Set(existing.map((e) => e.gameId));

    const ordered = parsed.data.gameIds.filter((gameId) => known.has(gameId));
    const seen = new Set(ordered);
    const rest = existing.map((e) => e.gameId).filter((gameId) => !seen.has(gameId));

    let position = 0;
    for (const gameId of [...ordered, ...rest]) {
      position += 1;
      await db
        .update(schema.collectionGames)
        .set({ sortOrder: position })
        .where(
          and(
            eq(schema.collectionGames.collectionId, collection.id),
            eq(schema.collectionGames.gameId, gameId),
          ),
        );
    }
    return { ok: true, ordered: position };
  });

  /**
   * Add every game in a collection to your library at once — the reason to
   * browse someone else's in the first place.
   *
   * Works on any collection you can see (yours, or a public one). Games you
   * already own are counted as skipped rather than re-filed, but the chosen
   * platform is applied to them too: "I own this marathon on Switch" is true
   * of the ones you already had.
   */
  app.post<{ Params: { id: string } }>(
    "/api/collections/:id/add-to-library",
    async (request, reply) => {
      const user = await requireUser(request, reply);
      if (!user) return;

      const [collection] = await db
        .select()
        .from(schema.collections)
        .where(eq(schema.collections.id, request.params.id));
      if (!collection || (collection.userId !== user.id && !collection.isPublic)) {
        return reply.status(404).send({ message: "Collection not found" });
      }

      const parsed = z
        .object({
          status: z.string().min(1),
          platforms: z
            .array(
              z.object({
                platformId: z.string().uuid(),
                format: z.enum(OWNERSHIP_FORMATS),
              }),
            )
            .max(10)
            .optional(),
        })
        .safeParse(request.body);
      if (!parsed.success) {
        return reply.status(400).send({ message: parsed.error.issues[0]?.message });
      }
      if (!(await isValidCategory(user.id, parsed.data.status))) {
        return reply.status(400).send({ message: "Unknown category" });
      }

      const rows = await db
        .select({ gameId: schema.collectionGames.gameId, title: schema.games.title })
        .from(schema.collectionGames)
        .innerJoin(schema.games, eq(schema.games.id, schema.collectionGames.gameId))
        .where(eq(schema.collectionGames.collectionId, collection.id))
        .orderBy(asc(schema.collectionGames.sortOrder));

      const platforms = parsed.data.platforms ?? [];
      let added = 0;
      let skipped = 0;
      const errors: string[] = [];

      for (const row of rows) {
        try {
          const [created] = await db
            .insert(schema.userGames)
            .values({ userId: user.id, gameId: row.gameId, status: parsed.data.status })
            .onConflictDoNothing()
            .returning({ id: schema.userGames.id });
          if (created) added += 1;
          else skipped += 1;

          if (platforms.length > 0) {
            let userGameId = created?.id;
            if (!userGameId) {
              const [existing] = await db
                .select({ id: schema.userGames.id })
                .from(schema.userGames)
                .where(
                  and(
                    eq(schema.userGames.userId, user.id),
                    eq(schema.userGames.gameId, row.gameId),
                  ),
                );
              userGameId = existing?.id;
            }
            if (userGameId) {
              await db
                .insert(schema.userGamePlatforms)
                .values(
                  platforms.map((p) => ({
                    userGameId: userGameId!,
                    platformId: p.platformId,
                    format: p.format,
                  })),
                )
                .onConflictDoNothing();
            }
          }
        } catch (err) {
          errors.push(`${row.title}: ${err instanceof Error ? err.message : "failed"}`);
        }
      }

      if (platforms.length > 0) {
        // filing games under a console adds it to your consoles list
        await rememberConsoles(user.id, platforms.map((p) => p.platformId));
      }
      if (added > 0) logEvent("game_added", user.id, { count: added, bulk: true });
      return { added, skipped, errors };
    },
  );

  /** Replace node positions + edges in one shot (called on graph edits). */
  app.put<{ Params: { id: string } }>("/api/collections/:id/layout", async (request, reply) => {
    const user = await requireUser(request, reply);
    if (!user) return;
    const collection = await ownedCollection(user.id, request.params.id);
    if (!collection) return reply.status(404).send({ message: "Collection not found" });
    const parsed = layoutSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.status(400).send({ message: parsed.error.issues[0]?.message });
    }

    // only games actually in the collection
    const members = await db
      .select({ gameId: schema.collectionGames.gameId })
      .from(schema.collectionGames)
      .where(eq(schema.collectionGames.collectionId, collection.id));
    const memberIds = new Set(members.map((m) => m.gameId));

    for (const node of parsed.data.nodes) {
      if (!memberIds.has(node.gameId)) continue;
      await db
        .update(schema.collectionGames)
        .set({ positionX: node.x, positionY: node.y })
        .where(
          and(
            eq(schema.collectionGames.collectionId, collection.id),
            eq(schema.collectionGames.gameId, node.gameId),
          ),
        );
    }

    await db
      .delete(schema.collectionLinks)
      .where(eq(schema.collectionLinks.collectionId, collection.id));
    const validLinks = parsed.data.links.filter(
      (l) => memberIds.has(l.fromGameId) && memberIds.has(l.toGameId) && l.fromGameId !== l.toGameId,
    );
    if (validLinks.length > 0) {
      await db.insert(schema.collectionLinks).values(
        validLinks.map((l) => ({
          collectionId: collection.id,
          fromGameId: l.fromGameId,
          toGameId: l.toGameId,
          label: l.label ?? null,
        })),
      );
    }
    return { ok: true };
  });
}
