import type { FastifyInstance } from "fastify";
import { and, asc, count, eq, inArray, sql } from "drizzle-orm";
import { z } from "zod";
import {
  COLLECTION_GRAPH_NAME_MAX,
  DEFAULT_COLLECTION_GRAPH_NAME,
  MAX_COLLECTION_GRAPHS,
  OWNERSHIP_FORMATS,
  type CollectionGraph,
} from "@gm/shared";
import { db, schema } from "../db/index.js";
import { requireUser } from "../plugins/auth.js";
import { upsertGameFromIgdb } from "../services/catalog.js";
import { logEvent } from "../services/analytics.js";
import { isValidCategory } from "../services/categories.js";
import { resolveTtbFor } from "../services/community.js";
import { rememberConsoles } from "../services/consoles.js";
import { inspectAll } from "../services/content-filter.js";
import { versionsFor } from "../services/game-versions.js";
import { matchTitle } from "../services/matcher.js";
import { extractTitles } from "../services/noise-filter.js";
import { publishModeFor } from "../services/preferences.js";
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

const graphNameSchema = z
  .string()
  .trim()
  .min(1, "Give the graph a name")
  .max(COLLECTION_GRAPH_NAME_MAX, `Keep the name to ${COLLECTION_GRAPH_NAME_MAX} characters or fewer`);

const GRAPH_NAME_TAKEN = "This collection already has a graph with that name";

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

/**
 * Where the nth game (0-based) lands on a graph nobody has arranged yet: a
 * loose grid, five across, so new nodes don't stack at the origin.
 */
function gridSlot(n: number): { positionX: number; positionY: number } {
  return { positionX: 80 + (n % 5) * 150, positionY: 80 + Math.floor(n / 5) * 190 };
}

/** A collection's graphs, in tab order. */
function graphsOf(collectionId: string) {
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
async function placeOnGraphs(graphIds: string[], gameId: string, n: number): Promise<void> {
  if (graphIds.length === 0) return;
  await db
    .insert(schema.collectionGraphNodes)
    .values(graphIds.map((graphId) => ({ graphId, gameId, ...gridSlot(n) })))
    .onConflictDoNothing();
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
      progressCustomSeconds: schema.userGames.progressCustomSeconds,
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
      customSeconds: row.progressCustomSeconds,
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
        // A copy starts private — publishing someone else's list is their
        // call. "Publish automatically" does not reach this: it governs what
        // you make, and a copy is not something you made.
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
          sortOrder: g.sortOrder,
        })),
      );
    }

    // every graph comes across, names and all — "Timeline" and "Release date"
    // are as much the author's work as the list is. Each needs a new id, so
    // its nodes and arrows are re-pointed through `graphIdFor`.
    const sourceGraphs = await graphsOf(source.id);
    const graphIdFor = new Map<string, string>();
    for (const graph of sourceGraphs) {
      const [created] = await db
        .insert(schema.collectionGraphs)
        .values({ collectionId: copy.id, name: graph.name, position: graph.position })
        .returning({ id: schema.collectionGraphs.id });
      if (created) graphIdFor.set(graph.id, created.id);
    }
    if (graphIdFor.size === 0) {
      // can't happen through the API, which never lets a collection reach zero
      // graphs — but a copy must not be the one collection without a tab
      await db
        .insert(schema.collectionGraphs)
        .values({ collectionId: copy.id, name: DEFAULT_COLLECTION_GRAPH_NAME, position: 1 });
    } else {
      const sourceGraphIds = [...graphIdFor.keys()];
      const nodes = await db
        .select()
        .from(schema.collectionGraphNodes)
        .where(inArray(schema.collectionGraphNodes.graphId, sourceGraphIds));
      if (nodes.length > 0) {
        await db.insert(schema.collectionGraphNodes).values(
          nodes.map((n) => ({
            graphId: graphIdFor.get(n.graphId)!,
            gameId: n.gameId,
            positionX: n.positionX,
            positionY: n.positionY,
          })),
        );
      }

      const links = await db
        .select()
        .from(schema.collectionLinks)
        .where(inArray(schema.collectionLinks.graphId, sourceGraphIds));
      if (links.length > 0) {
        await db.insert(schema.collectionLinks).values(
          links.map((l) => ({
            collectionId: copy.id,
            graphId: graphIdFor.get(l.graphId)!,
            fromGameId: l.fromGameId,
            toGameId: l.toGameId,
            label: l.label,
          })),
        );
      }
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
    // Name and description are everything a new collection has, and both just
    // passed the filter, so "publish automatically" has nothing unscanned to
    // expose. An explicit isPublic in the request still wins — the preference
    // decides the default, not the ceiling. Except under 'never', where it is
    // the ceiling: see the PATCH below.
    const mode = await publishModeFor(user.id);
    const isPublic =
      mode === "never" ? false : (parsed.data.isPublic ?? mode === "always");
    // the collection and its first graph together, so a collection with no
    // graph tab can't be left behind by a failure between the two
    const created = await db.transaction(async (tx) => {
      const [row] = await tx
        .insert(schema.collections)
        .values({
          userId: user.id,
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

    // "Never publish" is a guarantee rather than a default: both apps hide the
    // control, and the API refuses anything that asks anyway. Unpublishing is
    // never refused — the setting governs what goes out, not what comes back.
    if (parsed.data.isPublic === true && (await publishModeFor(user.id)) === "never") {
      return reply.status(403).send({ message: "Publishing is turned off in your preferences" });
    }

    // Publishing re-checks the whole collection, not just the fields in this
    // request: a collection written before the filter existed would otherwise
    // walk straight into the public list on an isPublic-only PATCH. Graph
    // names are part of "the whole collection" — they're the tabs a visitor
    // reads.
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
        sortOrder: schema.collectionGames.sortOrder,
        userGameId: schema.userGames.id,
        status: schema.userGames.status,
        completed100: schema.userGames.completed100,
        progressBasis: schema.userGames.progressBasis,
        progressCustomSeconds: schema.userGames.progressCustomSeconds,
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
        customSeconds: n.progressCustomSeconds,
        status: n.status,
        completed100: n.completed100 ?? false,
        ttbEnabled: n.ttbEnabled ?? true,
        missions: missions.get(n.game.id),
      });
      nodeTimes.set(n.game.id, t);
      addGameTime(time, t);
    }

    /*
     * The graphs: one named arrangement each, all over the same games. A
     * node's place is stored per graph; a game with no stored place on one
     * (nothing writes that state, but a read shouldn't depend on it) falls
     * back to a grid slot in list order rather than piling up at the origin.
     */
    const graphRows = await graphsOf(collection.id);
    const graphIds = graphRows.map((g) => g.id);
    const placed =
      graphIds.length > 0
        ? await db
            .select()
            .from(schema.collectionGraphNodes)
            .where(inArray(schema.collectionGraphNodes.graphId, graphIds))
        : [];
    const links =
      graphIds.length > 0
        ? await db
            .select()
            .from(schema.collectionLinks)
            .where(inArray(schema.collectionLinks.graphId, graphIds))
        : [];
    const inListOrder = [...nodes].sort(
      (a, b) => a.sortOrder - b.sortOrder || a.game.title.localeCompare(b.game.title),
    );
    const graphs: CollectionGraph[] = graphRows.map((graph) => {
      const at = new Map(
        placed.filter((p) => p.graphId === graph.id).map((p) => [p.gameId, p] as const),
      );
      return {
        id: graph.id,
        name: graph.name,
        nodes: inListOrder.map((n, i) => {
          const spot = at.get(n.game.id) ?? gridSlot(i);
          return { gameId: n.game.id, x: spot.positionX, y: spot.positionY };
        }),
        links: links
          .filter((l) => l.graphId === graph.id)
          .map((l) => ({
            id: l.id,
            fromGameId: l.fromGameId,
            toGameId: l.toGameId,
            label: l.label,
          })),
      };
    });

    // remakes, remasters and originals you've linked to any of these games —
    // yours even on someone else's collection, like every other per-user field
    const versions = await versionsFor(
      user.id,
      nodes.map((n) => n.game.id),
    );

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
        versions: versions.get(n.game.id)?.versions ?? [],
        latestVersionId: versions.get(n.game.id)?.latestVersionId ?? null,
      })),
      graphs,
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

    const [countRow] = await db
      .select({ n: count() })
      .from(schema.collectionGames)
      .where(eq(schema.collectionGames.collectionId, collection.id));
    const n = countRow?.n ?? 0;
    const added = await db
      .insert(schema.collectionGames)
      .values({
        collectionId: collection.id,
        gameId,
        // new games land at the end of the flat list
        sortOrder: n + 1,
      })
      .onConflictDoNothing()
      .returning({ gameId: schema.collectionGames.gameId });
    // only a game that actually joined needs placing — one that was already
    // here has a spot on every graph, and it's wherever you dragged it
    if (added.length > 0) {
      const graphs = await graphsOf(collection.id);
      await placeOnGraphs(
        graphs.map((g) => g.id),
        gameId,
        n,
      );
    }
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
      const graphIds = (await graphsOf(collection.id)).map((g) => g.id);

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
            // pasted order is the play order — that's the whole point of
            // pasting a list rather than adding twenty games by search
            sortOrder: n + 1,
          })
          .onConflictDoNothing();
        // the same loose grid single adds use, so every graph opens legible
        await placeOnGraphs(graphIds, gameId, n);
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
      // off every graph too: its node, and any arrow that touched it
      const graphIds = (await graphsOf(collection.id)).map((g) => g.id);
      if (graphIds.length > 0) {
        await db
          .delete(schema.collectionGraphNodes)
          .where(
            and(
              inArray(schema.collectionGraphNodes.graphId, graphIds),
              eq(schema.collectionGraphNodes.gameId, request.params.gameId),
            ),
          );
      }
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
   *
   * `gameIds` narrows it to some of them — the three you picked, or just the
   * ones you don't have yet. It can only narrow: an id that isn't in the
   * collection is ignored, so this can't be used to add arbitrary games.
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
          gameIds: z.array(z.string().uuid()).min(1).max(500).optional(),
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
        .where(
          and(
            eq(schema.collectionGames.collectionId, collection.id),
            parsed.data.gameIds
              ? inArray(schema.collectionGames.gameId, parsed.data.gameIds)
              : undefined,
          ),
        )
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

  // ---- graphs ----
  //
  // A collection's graphs are named arrangements of the same games: "Play
  // order", "Timeline", "Release date". They're created, renamed and deleted
  // here; which games are *in* the collection is still the collection's
  // business, and every graph covers all of them.

  /**
   * Add a graph to a collection.
   *
   * It starts either as a fresh grid in list order, or — with
   * `copyFromGraphId` — as a copy of another graph's layout and arrows, since
   * a timeline is usually the play order with a few games moved.
   */
  app.post<{ Params: { id: string } }>("/api/collections/:id/graphs", async (request, reply) => {
    const user = await requireUser(request, reply);
    if (!user) return;
    const collection = await ownedCollection(user.id, request.params.id);
    if (!collection) return reply.status(404).send({ message: "Collection not found" });

    const parsed = z
      .object({ name: graphNameSchema, copyFromGraphId: z.string().uuid().optional() })
      .safeParse(request.body);
    if (!parsed.success) {
      return reply.status(400).send({ message: parsed.error.issues[0]?.message });
    }
    const name = parsed.data.name;
    // a graph's name is a tab on a collection that may be published, so it's
    // filtered like the collection's own name
    const issue = inspectAll([name]);
    if (issue) {
      logEvent("content_blocked", user.id, { surface: "collection", kind: issue.kind });
      return reply.status(400).send({ message: issue.message });
    }

    const existing = await graphsOf(collection.id);
    if (existing.length >= MAX_COLLECTION_GRAPHS) {
      return reply
        .status(409)
        .send({ message: `A collection can hold up to ${MAX_COLLECTION_GRAPHS} graphs` });
    }
    // the database's unique index is exact; two tabs differing only by case
    // are just as hard to tell apart
    if (existing.some((g) => g.name.toLowerCase() === name.toLowerCase())) {
      return reply.status(409).send({ message: GRAPH_NAME_TAKEN });
    }
    const source = parsed.data.copyFromGraphId
      ? existing.find((g) => g.id === parsed.data.copyFromGraphId)
      : null;
    if (parsed.data.copyFromGraphId && !source) {
      return reply.status(404).send({ message: "That graph isn't in this collection" });
    }

    const members = await db
      .select({ gameId: schema.collectionGames.gameId })
      .from(schema.collectionGames)
      .innerJoin(schema.games, eq(schema.games.id, schema.collectionGames.gameId))
      .where(eq(schema.collectionGames.collectionId, collection.id))
      .orderBy(asc(schema.collectionGames.sortOrder), asc(schema.games.title));
    const memberIds = new Set(members.map((m) => m.gameId));

    const sourceNodes = source
      ? await db
          .select()
          .from(schema.collectionGraphNodes)
          .where(eq(schema.collectionGraphNodes.graphId, source.id))
      : [];
    const sourceLinks = source
      ? await db
          .select()
          .from(schema.collectionLinks)
          .where(eq(schema.collectionLinks.graphId, source.id))
      : [];
    const copied = new Map(sourceNodes.map((n) => [n.gameId, n] as const));

    let created;
    try {
      created = await db.transaction(async (tx) => {
        const [graph] = await tx
          .insert(schema.collectionGraphs)
          .values({
            collectionId: collection.id,
            name,
            position: Math.max(0, ...existing.map((g) => g.position)) + 1,
          })
          .returning();
        if (!graph) return null;

        if (members.length > 0) {
          await tx.insert(schema.collectionGraphNodes).values(
            members.map((m, i) => {
              const from = copied.get(m.gameId);
              return {
                graphId: graph.id,
                gameId: m.gameId,
                ...(from ? { positionX: from.positionX, positionY: from.positionY } : gridSlot(i)),
              };
            }),
          );
        }
        const links = sourceLinks.filter(
          (l) => memberIds.has(l.fromGameId) && memberIds.has(l.toGameId),
        );
        if (links.length > 0) {
          await tx.insert(schema.collectionLinks).values(
            links.map((l) => ({
              collectionId: collection.id,
              graphId: graph.id,
              fromGameId: l.fromGameId,
              toGameId: l.toGameId,
              label: l.label,
            })),
          );
        }
        return graph;
      });
    } catch (err) {
      // two tabs racing to create the same name
      if (isUniqueViolation(err)) return reply.status(409).send({ message: GRAPH_NAME_TAKEN });
      throw err;
    }
    if (!created) return reply.status(500).send({ message: "Couldn't create that graph" });
    reply.status(201);
    return { id: created.id, name: created.name };
  });

  /** Rename a graph. The name is all a graph has besides its layout. */
  app.patch<{ Params: { id: string; graphId: string } }>(
    "/api/collections/:id/graphs/:graphId",
    async (request, reply) => {
      const user = await requireUser(request, reply);
      if (!user) return;
      const collection = await ownedCollection(user.id, request.params.id);
      if (!collection) return reply.status(404).send({ message: "Collection not found" });

      const parsed = z.object({ name: graphNameSchema }).safeParse(request.body);
      if (!parsed.success) {
        return reply.status(400).send({ message: parsed.error.issues[0]?.message });
      }
      const name = parsed.data.name;

      const graphs = await graphsOf(collection.id);
      const graph = graphs.find((g) => g.id === request.params.graphId);
      if (!graph) return reply.status(404).send({ message: "Graph not found" });

      const issue = inspectAll([name]);
      if (issue) {
        logEvent("content_blocked", user.id, { surface: "collection", kind: issue.kind });
        return reply.status(400).send({ message: issue.message });
      }
      if (graphs.some((g) => g.id !== graph.id && g.name.toLowerCase() === name.toLowerCase())) {
        return reply.status(409).send({ message: GRAPH_NAME_TAKEN });
      }

      try {
        await db
          .update(schema.collectionGraphs)
          .set({ name })
          .where(eq(schema.collectionGraphs.id, graph.id));
      } catch (err) {
        if (isUniqueViolation(err)) return reply.status(409).send({ message: GRAPH_NAME_TAKEN });
        throw err;
      }
      return { id: graph.id, name };
    },
  );

  /**
   * Delete a graph — its layout and arrows go with it; the games stay in the
   * collection and on every other graph.
   *
   * The last one can't be deleted. A collection always has a graph to open,
   * which is what lets both apps draw a tab without first asking whether
   * there's anything behind it.
   */
  app.delete<{ Params: { id: string; graphId: string } }>(
    "/api/collections/:id/graphs/:graphId",
    async (request, reply) => {
      const user = await requireUser(request, reply);
      if (!user) return;
      const collection = await ownedCollection(user.id, request.params.id);
      if (!collection) return reply.status(404).send({ message: "Collection not found" });

      const graphs = await graphsOf(collection.id);
      const graph = graphs.find((g) => g.id === request.params.graphId);
      if (!graph) return reply.status(404).send({ message: "Graph not found" });
      if (graphs.length <= 1) {
        return reply.status(409).send({
          message: "A collection keeps at least one graph — rename this one instead",
        });
      }
      await db.delete(schema.collectionGraphs).where(eq(schema.collectionGraphs.id, graph.id));
      return { ok: true };
    },
  );

  /** Replace one graph's node positions + edges in one shot (called on graph edits). */
  app.put<{ Params: { id: string; graphId: string } }>(
    "/api/collections/:id/graphs/:graphId/layout",
    async (request, reply) => {
      const user = await requireUser(request, reply);
      if (!user) return;
      const collection = await ownedCollection(user.id, request.params.id);
      if (!collection) return reply.status(404).send({ message: "Collection not found" });
      const graph = (await graphsOf(collection.id)).find((g) => g.id === request.params.graphId);
      if (!graph) return reply.status(404).send({ message: "Graph not found" });
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

      // one row per game: an upsert can't touch the same row twice in a
      // statement, and a doubled node in the payload shouldn't be a 500
      const nodes = new Map<string, { x: number; y: number }>();
      for (const node of parsed.data.nodes) {
        if (memberIds.has(node.gameId)) nodes.set(node.gameId, { x: node.x, y: node.y });
      }
      const links = new Map<string, (typeof parsed.data.links)[number]>();
      for (const link of parsed.data.links) {
        if (
          memberIds.has(link.fromGameId) &&
          memberIds.has(link.toGameId) &&
          link.fromGameId !== link.toGameId
        ) {
          links.set(`${link.fromGameId}>${link.toGameId}`, link);
        }
      }

      // together or not at all — the arrows are deleted and rewritten, and a
      // failure between the two would leave a graph with none
      await db.transaction(async (tx) => {
        if (nodes.size > 0) {
          await tx
            .insert(schema.collectionGraphNodes)
            .values(
              [...nodes].map(([gameId, at]) => ({
                graphId: graph.id,
                gameId,
                positionX: at.x,
                positionY: at.y,
              })),
            )
            .onConflictDoUpdate({
              target: [schema.collectionGraphNodes.graphId, schema.collectionGraphNodes.gameId],
              set: {
                positionX: sql`excluded.position_x`,
                positionY: sql`excluded.position_y`,
              },
            });
        }
        await tx
          .delete(schema.collectionLinks)
          .where(eq(schema.collectionLinks.graphId, graph.id));
        if (links.size > 0) {
          await tx.insert(schema.collectionLinks).values(
            [...links.values()].map((l) => ({
              collectionId: collection.id,
              graphId: graph.id,
              fromGameId: l.fromGameId,
              toGameId: l.toGameId,
              label: l.label ?? null,
            })),
          );
        }
      });
      return { ok: true };
    },
  );
}
