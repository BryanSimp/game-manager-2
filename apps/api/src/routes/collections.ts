import type { FastifyInstance } from "fastify";
import { and, asc, count, eq, inArray, sql } from "drizzle-orm";
import { z } from "zod";
import { OWNERSHIP_FORMATS } from "@gm/shared";
import { db, schema } from "../db/index.js";
import { requireUser } from "../plugins/auth.js";
import { upsertGameFromIgdb } from "../services/catalog.js";
import { logEvent } from "../services/analytics.js";
import { isValidCategory } from "../services/categories.js";
import { resolveTtbFor } from "../services/community.js";
import { rememberConsoles } from "../services/consoles.js";
import { inspectAll } from "../services/content-filter.js";
import { matchTitle } from "../services/matcher.js";
import { extractTitles } from "../services/noise-filter.js";
import {
  addGameTime,
  emptyCollectionTime,
  gameTime,
  missionCountsByGame,
  type CollectionTime,
  type GameTime,
} from "../services/progress.js";
import {
  NO_VOTES,
  castCollectionVote,
  collectionVoteCounts,
  voteSchema,
} from "../services/votes.js";
import { importRateLimit, voteRateLimit } from "../plugins/rate-limits.js";

/**
 * How many lines one pasted list may add. Well under the import page's 200:
 * every line that isn't already in the catalog is a throttled IGDB search
 * (~3/s) inside a request nobody is watching a spinner for beyond a few
 * seconds.
 */
const LIST_IMPORT_MAX = 50;

/**
 * How close a title has to be before it's filed without asking. Lower than
 * the Steam importer's 0.85 because a pasted list is typed by a person rather
 * than read off a screenshot, and because a wrong row in a collection is one
 * click to remove rather than a wrong game in a library. Every line's score
 * comes back in the response either way, so a marginal match is visible
 * rather than silent.
 */
const LIST_IMPORT_MIN_CONFIDENCE = 0.55;

type ListImportResult = {
  input: string;
  matched: { gameId: string; title: string; coverSrc: string | null } | null;
  confidence: number;
  status: "added" | "duplicate" | "unmatched" | "failed";
};

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

/**
 * Browsing the public list. `q` matches collection names *and* the titles of
 * the games inside them; `gameId` is the exact-match form the game detail page
 * uses to ask "who has put this in a collection?".
 */
const publicQuerySchema = z.object({
  q: z.string().trim().min(1).max(100).optional(),
  gameId: z.string().uuid().optional(),
  sort: z.enum(["top", "new"]).default("top"),
  limit: z.coerce.number().int().min(1).max(60).default(30),
  offset: z.coerce.number().int().min(0).max(10_000).default(0),
});
type PublicQuery = z.input<typeof publicQuerySchema>;

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

/**
 * Play times for a set of collections: how long the whole run is, and how
 * much of it is left.
 *
 * Everything here goes through `resolveTtbFor`, not `games.ttb_main` — play
 * times have been per-user since phase 16, and a collection total that read
 * the catalog column directly would quietly disagree with the figure shown on
 * each of the games it was adding up.
 *
 * Remaining follows the same three rules `gameTime` documents: a finished game
 * drops out entirely, a part-ticked mission list is pro-rated, and everything
 * else counts in full. Games you don't own count in full too — a collection is
 * a reading list, and "how long to play all of this" includes the ones you
 * haven't bought yet.
 */
async function collectionTimes(
  userId: string,
  collectionIds: string[],
): Promise<Map<string, CollectionTime>> {
  const totals = new Map<string, CollectionTime>();
  if (collectionIds.length === 0) return totals;
  for (const id of collectionIds) totals.set(id, emptyCollectionTime());

  const rows = await db
    .select({
      collectionId: schema.collectionGames.collectionId,
      game: schema.games,
      status: schema.userGames.status,
      completed100: schema.userGames.completed100,
      progressBasis: schema.userGames.progressBasis,
      ttbEnabled: schema.userGames.ttbEnabled,
    })
    .from(schema.collectionGames)
    .innerJoin(schema.games, eq(schema.games.id, schema.collectionGames.gameId))
    .leftJoin(
      schema.userGames,
      and(
        eq(schema.userGames.gameId, schema.collectionGames.gameId),
        eq(schema.userGames.userId, userId),
      ),
    )
    .where(inArray(schema.collectionGames.collectionId, collectionIds));
  if (rows.length === 0) return totals;

  // one resolve and one mission-count query for every collection at once,
  // rather than a pair per collection
  const distinct = new Map(rows.map((r) => [r.game.id, r.game]));
  const [ttb, missions] = await Promise.all([
    resolveTtbFor(userId, [...distinct.values()]),
    missionCountsByGame(userId),
  ]);

  for (const row of rows) {
    const time = gameTime({
      ttb: ttb.get(row.game.id) ?? row.game,
      basis: row.progressBasis ?? "main",
      status: row.status,
      completed100: row.completed100 ?? false,
      ttbEnabled: row.ttbEnabled ?? true,
      missions: missions.get(row.game.id),
    });
    addGameTime(totals.get(row.collectionId)!, time);
  }
  return totals;
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
  app.get<{ Querystring: { gameId?: string } }>("/api/collections", async (request, reply) => {
    const user = await requireUser(request, reply);
    if (!user) return;
    // `gameId` is the "which of my collections is this game already in?"
    // form the game card's add-to-collection control uses. Asked for here
    // rather than as its own route so the picker gets names and counts in the
    // same payload it would have fetched anyway.
    const asked = z.object({ gameId: z.string().uuid().optional() }).safeParse(request.query);
    if (!asked.success) return reply.status(400).send({ message: "Invalid gameId" });
    const gameId = asked.data.gameId;

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
    const times = await collectionTimes(
      user.id,
      rows.map((c) => c.id),
    );

    // membership, when one was asked about: one query for every collection
    // rather than one per row
    let holding = new Set<string>();
    if (gameId && rows.length > 0) {
      const found = await db
        .select({ collectionId: schema.collectionGames.collectionId })
        .from(schema.collectionGames)
        .where(
          and(
            eq(schema.collectionGames.gameId, gameId),
            inArray(
              schema.collectionGames.collectionId,
              rows.map((c) => c.id),
            ),
          ),
        );
      holding = new Set(found.map((f) => f.collectionId));
    }

    return rows.map((c) => ({
      id: c.id,
      name: c.name,
      description: c.description,
      accentColor: c.accentColor,
      isPublic: c.isPublic,
      adoptedFromId: c.adoptedFromId,
      total: statMap.get(c.id)?.total ?? 0,
      finished: Number(statMap.get(c.id)?.finished ?? 0),
      time: times.get(c.id) ?? emptyCollectionTime(),
      preview: previews.get(c.id) ?? [],
      // absent unless a game was named, so "false" always means "asked, and no"
      ...(gameId ? { containsGame: holding.has(c.id) } : {}),
    }));
  });

  /**
   * Every published collection, anyone's. Ordered newest first so a freshly
   * shared one is findable; yours are included and flagged rather than hidden,
   * so you can see what other people see.
   */
  app.get<{ Querystring: PublicQuery }>("/api/collections/public", async (request, reply) => {
    const user = await requireUser(request, reply);
    if (!user) return;
    const query = publicQuerySchema.safeParse(request.query);
    if (!query.success) return reply.status(400).send({ message: "Invalid search" });
    const { q, gameId, sort, limit, offset } = query.data;

    const filters = [eq(schema.collections.isPublic, true)];
    if (gameId) {
      filters.push(
        sql`exists (select 1 from ${schema.collectionGames}
                    where ${schema.collectionGames.collectionId} = ${schema.collections.id}
                      and ${schema.collectionGames.gameId} = ${gameId})`,
      );
    }
    if (q) {
      // Matching a *game title* as well as the collection's own name is what
      // makes this browse-by-game rather than browse-by-whatever-they-called-it:
      // nobody searching for a Zelda marathon knows it's filed as "Hyrule run".
      const like = `%${q}%`;
      filters.push(
        sql`(${schema.collections.name} ilike ${like}
             or ${schema.collections.description} ilike ${like}
             or exists (select 1 from ${schema.collectionGames}
                          join ${schema.games} on ${schema.games.id} = ${schema.collectionGames.gameId}
                         where ${schema.collectionGames.collectionId} = ${schema.collections.id}
                           and ${schema.games.title} ilike ${like}))`,
      );
    }

    // score as a scalar subquery, so "best first" sorts and paginates in the
    // database rather than over whatever one page happened to contain
    const score = sql<number>`coalesce((select sum(${schema.collectionVotes.value})
                                          from ${schema.collectionVotes}
                                         where ${schema.collectionVotes.collectionId} = ${schema.collections.id}), 0)::int`;

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
      .where(and(...filters))
      .orderBy(
        ...(sort === "top"
          ? [sql`${score} desc`, sql`${schema.collections.createdAt} desc`]
          : [sql`${schema.collections.createdAt} desc`]),
      )
      // one extra row is the cheapest possible "is there another page"
      .limit(limit + 1)
      .offset(offset);

    const hasMore = rows.length > limit;
    if (hasMore) rows.pop();
    if (rows.length === 0) return { items: [], hasMore: false };

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
    const votes = await collectionVoteCounts(
      rows.map((r) => r.id),
      user.id,
    );
    // how long someone else's marathon actually is, which is most of what
    // anyone wants to know before copying it. Resolved against *your* times
    // and progress, like everything else on this route.
    const times = await collectionTimes(
      user.id,
      rows.map((r) => r.id),
    );

    return {
      items: rows.map((r) => ({
        id: r.id,
        name: r.name,
        description: r.description,
        accentColor: r.accentColor,
        authorName: r.authorName,
        total: totalMap.get(r.id) ?? 0,
        adopted: adopted.has(r.id),
        mine: r.userId === user.id,
        votes: votes.get(r.id) ?? NO_VOTES,
        time: times.get(r.id) ?? emptyCollectionTime(),
        preview: previews.get(r.id) ?? [],
      })),
      hasMore,
    };
  });

  /** Thumb a published collection. Public only, and never your own. */
  app.put<{ Params: { id: string } }>(
    "/api/collections/:id/vote",
    { config: voteRateLimit },
    async (request, reply) => {
      const user = await requireUser(request, reply);
      if (!user) return;
      const [collection] = await db
        .select({ id: schema.collections.id, userId: schema.collections.userId })
        .from(schema.collections)
        .where(
          and(eq(schema.collections.id, request.params.id), eq(schema.collections.isPublic, true)),
        );
      if (!collection) return reply.status(404).send({ message: "Collection not found" });
      if (collection.userId === user.id) {
        return reply.status(400).send({ message: "You can't rate your own collection" });
      }
      const parsed = voteSchema.safeParse(request.body);
      if (!parsed.success) return reply.status(400).send({ message: "Invalid vote" });
      await castCollectionVote(collection.id, user.id, parsed.data.value);
      const counts = await collectionVoteCounts([collection.id], user.id);
      return counts.get(collection.id) ?? NO_VOTES;
    },
  );

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

  /**
   * One collection in full.
   *
   * Readable if it's yours *or* it's published — browsing the public list is
   * pointless if you can't look inside before taking a copy. The per-game
   * `userGameId`/`status` are resolved against whoever is asking, so a visitor
   * sees which of the games they own rather than which the author owns.
   */
  app.get<{ Params: { id: string } }>("/api/collections/:id", async (request, reply) => {
    const user = await requireUser(request, reply);
    if (!user) return;
    const [collection] = await db
      .select()
      .from(schema.collections)
      .where(eq(schema.collections.id, request.params.id));
    if (!collection || (collection.userId !== user.id && !collection.isPublic)) {
      return reply.status(404).send({ message: "Collection not found" });
    }
    const isOwner = collection.userId === user.id;
    const [author] = isOwner
      ? []
      : await db
          .select({ name: schema.user.name })
          .from(schema.user)
          .where(eq(schema.user.id, collection.userId));

    const nodes = await db
      .select({
        game: schema.games,
        x: schema.collectionGames.positionX,
        y: schema.collectionGames.positionY,
        sortOrder: schema.collectionGames.sortOrder,
        userGameId: schema.userGames.id,
        status: schema.userGames.status,
        completed100: schema.userGames.completed100,
        progressBasis: schema.userGames.progressBasis,
        ttbEnabled: schema.userGames.ttbEnabled,
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

    /*
     * Per-game play times, resolved for whoever is asking — so a visitor
     * browsing someone else's published collection sees their own progress
     * against it, the same rule `userGameId`/`status` already follow. The
     * roll-up is summed from these rather than fetched separately, so the
     * header total can never disagree with the rows under it.
     */
    const ttb = await resolveTtbFor(
      user.id,
      nodes.map((n) => n.game),
    );
    const missions = await missionCountsByGame(user.id);
    const time = emptyCollectionTime();
    const nodeTimes = new Map<string, GameTime>();
    for (const n of nodes) {
      const t = gameTime({
        ttb: ttb.get(n.game.id) ?? n.game,
        basis: n.progressBasis ?? "main",
        status: n.status,
        completed100: n.completed100 ?? false,
        ttbEnabled: n.ttbEnabled ?? true,
        missions: missions.get(n.game.id),
      });
      nodeTimes.set(n.game.id, t);
      addGameTime(time, t);
    }

    const links = await db
      .select()
      .from(schema.collectionLinks)
      .where(eq(schema.collectionLinks.collectionId, collection.id));

    const votes = await collectionVoteCounts([collection.id], user.id);

    return {
      id: collection.id,
      name: collection.name,
      description: collection.description,
      accentColor: collection.accentColor,
      isPublic: collection.isPublic,
      adoptedFromId: collection.adoptedFromId,
      isOwner,
      authorName: author?.name ?? null,
      votes: votes.get(collection.id) ?? NO_VOTES,
      time,
      games: nodes.map((n) => ({
        gameId: n.game.id,
        title: n.game.title,
        coverSrc: gameCover(n.game),
        x: n.x,
        y: n.y,
        sortOrder: n.sortOrder,
        releaseDate: n.game.releaseDate,
        // the resolved figure, not games.ttb_main — see collectionTimes
        ttbMain: ttb.get(n.game.id)?.ttbMain ?? n.game.ttbMain,
        ttbSeconds: nodeTimes.get(n.game.id)?.totalSeconds ?? null,
        remainingSeconds: nodeTimes.get(n.game.id)?.remainingSeconds ?? null,
        finished: nodeTimes.get(n.game.id)?.finished ?? false,
        endless: nodeTimes.get(n.game.id)?.endless ?? false,
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

  /**
   * Fill a collection from a pasted list of titles.
   *
   * The same affordance the import page gives a library — paste a list, get
   * it matched — pointed at a collection instead. "The Zelda games in order"
   * is twenty lines of typing you already have somewhere, and adding them one
   * search at a time was the reason collections stayed empty.
   *
   * Three differences from the library's import, all deliberate:
   *
   *  - It runs in the request rather than through a pg-boss job. There is no
   *    OCR stage to wait on, and a collection has to *exist* with games in it
   *    before the page it redirects to is worth opening. That's also why the
   *    cap is 50 rather than the import's 200: each unmatched line is one
   *    throttled IGDB round trip (~3/s), so 50 is a few seconds and 200 would
   *    be a minute of a held connection.
   *  - There is no review step. Every line comes back in the response saying
   *    what it matched and how confidently, and a wrong one is removed from
   *    the collection in one click — a collection is a list of titles, so the
   *    cost of a bad row is nothing like adding a wrong game to a library.
   *  - Matching skips the OCR-damage retries: a typed list has no icon junk
   *    to strip, and each retry is another IGDB call.
   *
   * Games are pulled into the shared catalog but deliberately NOT into your
   * library, exactly like adding one by hand.
   */
  app.post<{ Params: { id: string } }>(
    "/api/collections/:id/games/from-list",
    { config: importRateLimit },
    async (request, reply) => {
      const user = await requireUser(request, reply);
      if (!user) return;
      const collection = await ownedCollection(user.id, request.params.id);
      if (!collection) return reply.status(404).send({ message: "Collection not found" });

      const parsed = z
        .object({ text: z.string().min(1).max(20_000) })
        .safeParse(request.body);
      if (!parsed.success) {
        return reply.status(400).send({ message: parsed.error.issues[0]?.message });
      }

      const titles = extractTitles(parsed.data.text, LIST_IMPORT_MAX);
      if (titles.length === 0) {
        return reply.status(400).send({ message: "No game titles found in that list" });
      }

      // what's already in here, so a re-paste doesn't double anything up and
      // the sort order keeps counting from the right place
      const existingRows = await db
        .select({ gameId: schema.collectionGames.gameId })
        .from(schema.collectionGames)
        .where(eq(schema.collectionGames.collectionId, collection.id));
      const present = new Set(existingRows.map((r) => r.gameId));
      let n = existingRows.length;

      const results: ListImportResult[] = [];
      for (const title of titles) {
        let match;
        try {
          match = await matchTitle(title, { ocrVariants: false });
        } catch {
          results.push({ input: title, matched: null, confidence: 0, status: "failed" });
          continue;
        }
        const top = match.candidates[0];
        if (!top || match.confidence < LIST_IMPORT_MIN_CONFIDENCE) {
          results.push({ input: title, matched: null, confidence: match.confidence, status: "unmatched" });
          continue;
        }

        let gameId = top.gameId;
        if (!gameId && top.igdbId) {
          try {
            gameId = await upsertGameFromIgdb(top.igdbId);
          } catch {
            results.push({ input: title, matched: null, confidence: match.confidence, status: "failed" });
            continue;
          }
        }
        if (!gameId) {
          results.push({ input: title, matched: null, confidence: match.confidence, status: "unmatched" });
          continue;
        }

        if (present.has(gameId)) {
          results.push({
            input: title,
            matched: { gameId, title: top.title, coverSrc: top.coverSrc },
            confidence: match.confidence,
            status: "duplicate",
          });
          continue;
        }

        await db
          .insert(schema.collectionGames)
          .values({
            collectionId: collection.id,
            gameId,
            // the same loose grid single adds use, so the graph opens legible
            positionX: 80 + (n % 5) * 150,
            positionY: 80 + Math.floor(n / 5) * 190,
            // pasted order is the play order — that's the whole point of
            // pasting a list rather than adding twenty games by search
            sortOrder: n + 1,
          })
          .onConflictDoNothing();
        present.add(gameId);
        n++;
        results.push({
          input: title,
          matched: { gameId, title: top.title, coverSrc: top.coverSrc },
          confidence: match.confidence,
          status: "added",
        });
      }

      return {
        added: results.filter((r) => r.status === "added").length,
        duplicates: results.filter((r) => r.status === "duplicate").length,
        unmatched: results.filter((r) => r.status !== "added" && r.status !== "duplicate").length,
        results,
      };
    },
  );

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
