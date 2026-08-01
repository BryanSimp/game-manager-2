import type { FastifyInstance } from "fastify";
import { and, asc, desc, eq, inArray } from "drizzle-orm";
import { z } from "zod";
import { db, schema } from "../db/index.js";
import { requireUser } from "../plugins/auth.js";
import { backfillPlatformMeta, rememberConsoles } from "../services/consoles.js";

const addSchema = z.object({ platformId: z.string().uuid() });

/** How many covers each console card previews. */
const PREVIEW_LIMIT = 8;

export function registerConsoleRoutes(app: FastifyInstance): void {
  /** The consoles you own, each with a slice of your library on it. */
  app.get("/api/consoles", async (request, reply) => {
    const user = await requireUser(request, reply);
    if (!user) return;

    const consoles = await db
      .select({
        addedAt: schema.userConsoles.addedAt,
        id: schema.platforms.id,
        name: schema.platforms.name,
        abbreviation: schema.platforms.abbreviation,
        family: schema.platforms.family,
        sortOrder: schema.platforms.sortOrder,
        releaseDate: schema.platforms.releaseDate,
        summary: schema.platforms.summary,
        logoUrl: schema.platforms.logoUrl,
      })
      .from(schema.userConsoles)
      .innerJoin(schema.platforms, eq(schema.userConsoles.platformId, schema.platforms.id))
      .where(eq(schema.userConsoles.userId, user.id))
      .orderBy(asc(schema.platforms.sortOrder));

    // every owned game, with which platform(s) it sits on. Small enough to
    // group in memory, and it keeps the counts and previews in one query.
    const owned = await db
      .select({
        platformId: schema.userGamePlatforms.platformId,
        format: schema.userGamePlatforms.format,
        entryId: schema.userGames.id,
        status: schema.userGames.status,
        createdAt: schema.userGames.createdAt,
        title: schema.games.title,
        customCoverImageId: schema.userGames.customCoverImageId,
        coverImageId: schema.games.coverImageId,
        coverUrl: schema.games.coverUrl,
      })
      .from(schema.userGamePlatforms)
      .innerJoin(schema.userGames, eq(schema.userGamePlatforms.userGameId, schema.userGames.id))
      .innerJoin(schema.games, eq(schema.userGames.gameId, schema.games.id))
      .where(eq(schema.userGames.userId, user.id))
      .orderBy(desc(schema.userGames.createdAt));

    const byPlatform = new Map<
      string,
      {
        entries: Map<string, { entryId: string; title: string; coverSrc: string | null; status: string }>;
        physical: Set<string>;
        digital: Set<string>;
      }
    >();
    for (const row of owned) {
      let bucket = byPlatform.get(row.platformId);
      if (!bucket) {
        bucket = { entries: new Map(), physical: new Set(), digital: new Set() };
        byPlatform.set(row.platformId, bucket);
      }
      // a game owned both physically and digitally is still one game
      bucket.entries.set(row.entryId, {
        entryId: row.entryId,
        title: row.title,
        coverSrc: row.customCoverImageId
          ? `/api/images/${row.customCoverImageId}`
          : row.coverImageId
            ? `/api/images/${row.coverImageId}`
            : row.coverUrl,
        status: row.status,
      });
      (row.format === "physical" ? bucket.physical : bucket.digital).add(row.entryId);
    }

    void backfillPlatformMeta(consoles.map((c) => c.id));

    return consoles.map((c) => {
      const bucket = byPlatform.get(c.id);
      const entries = [...(bucket?.entries.values() ?? [])];
      return {
        platform: {
          id: c.id,
          name: c.name,
          abbreviation: c.abbreviation,
          family: c.family,
          sortOrder: c.sortOrder,
          releaseDate: c.releaseDate,
          summary: c.summary,
          logoUrl: c.logoUrl,
          owned: true,
        },
        addedAt: c.addedAt,
        gameCount: entries.length,
        physicalCount: bucket?.physical.size ?? 0,
        digitalCount: bucket?.digital.size ?? 0,
        preview: entries.slice(0, PREVIEW_LIMIT),
      };
    });
  });

  app.post("/api/consoles", async (request, reply) => {
    const user = await requireUser(request, reply);
    if (!user) return;
    const parsed = addSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.status(400).send({ message: parsed.error.issues[0]?.message });
    }
    const [platform] = await db
      .select({ id: schema.platforms.id })
      .from(schema.platforms)
      .where(eq(schema.platforms.id, parsed.data.platformId));
    if (!platform) return reply.status(404).send({ message: "Unknown console" });

    await rememberConsoles(user.id, [platform.id]);
    void backfillPlatformMeta([platform.id]);
    reply.status(201);
    return { ok: true };
  });

  /**
   * Drop a console. Any games filed under it lose that platform too —
   * ownership that points at a console you don't have would be exactly the
   * drift this list exists to prevent. The count comes back so the UI can
   * say what it cost.
   */
  app.delete<{ Params: { platformId: string } }>(
    "/api/consoles/:platformId",
    async (request, reply) => {
      const user = await requireUser(request, reply);
      if (!user) return;

      const deleted = await db
        .delete(schema.userConsoles)
        .where(
          and(
            eq(schema.userConsoles.userId, user.id),
            eq(schema.userConsoles.platformId, request.params.platformId),
          ),
        )
        .returning({ platformId: schema.userConsoles.platformId });
      if (deleted.length === 0) return reply.status(404).send({ message: "Not on your list" });

      // scoped to this user's entries — the platform is shared, the
      // ownership rows hanging off it are not
      const mine = db
        .select({ id: schema.userGames.id })
        .from(schema.userGames)
        .where(eq(schema.userGames.userId, user.id));
      const removed = await db
        .delete(schema.userGamePlatforms)
        .where(
          and(
            eq(schema.userGamePlatforms.platformId, request.params.platformId),
            inArray(schema.userGamePlatforms.userGameId, mine),
          ),
        )
        .returning({ userGameId: schema.userGamePlatforms.userGameId });

      // both formats of the same game count once
      const affected = new Set(removed.map((r) => r.userGameId));
      return { ok: true, removedFromGames: affected.size };
    },
  );
}
