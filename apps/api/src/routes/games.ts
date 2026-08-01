import type { FastifyInstance } from "fastify";
import { eq, ilike } from "drizzle-orm";
import { alias } from "drizzle-orm/pg-core";
import { db, schema } from "../db/index.js";
import { requireUser } from "../plugins/auth.js";
import { igdbConfigured, igdbCoverUrl, searchIgdb } from "../services/igdb.js";
import { ownedConsoleIds } from "../services/consoles.js";

export function registerGameRoutes(app: FastifyInstance): void {
  app.get<{ Querystring: { q?: string; year?: string } }>(
    "/api/games/search",
    async (request, reply) => {
    const user = await requireUser(request, reply);
    if (!user) return;
    const q = (request.query.q ?? "").trim();
    if (q.length < 2) return { igdb: false, results: [] };
    const parsedYear = Number(request.query.year);
    const year =
      Number.isInteger(parsedYear) && parsedYear >= 1950 && parsedYear <= 2100 ? parsedYear : null;

    // which igdb ids / game ids are already in this user's library
    const owned = await db
      .select({ gameId: schema.userGames.gameId, igdbId: schema.games.igdbId })
      .from(schema.userGames)
      .innerJoin(schema.games, eq(schema.userGames.gameId, schema.games.id))
      .where(eq(schema.userGames.userId, user.id));
    const ownedIgdb = new Set(owned.map((o) => o.igdbId).filter((v) => v !== null));
    const ownedGames = new Set(owned.map((o) => o.gameId));

    if (await igdbConfigured()) {
      const igdbResults = (await searchIgdb(q, 20, year)) ?? [];
      return {
        igdb: true,
        results: igdbResults.map((g) => ({
          igdbId: g.id,
          gameId: null,
          title: g.name,
          releaseYear: g.first_release_date
            ? new Date(g.first_release_date * 1000).getFullYear()
            : null,
          coverSrc: g.cover ? igdbCoverUrl(g.cover.image_id) : null,
          platforms: g.platforms?.map((p) => p.name) ?? [],
          summary: g.summary ?? null,
          inLibrary: ownedIgdb.has(g.id),
        })),
      };
    }

    // fallback: local catalog search when IGDB isn't configured
    const local = await db
      .select()
      .from(schema.games)
      .where(ilike(schema.games.title, `%${q}%`))
      .limit(20);
    return {
      igdb: false,
      results: local
        .filter((g) => !year || g.releaseDate?.startsWith(String(year)))
        .map((g) => ({
          igdbId: g.igdbId,
          gameId: g.id,
          title: g.title,
          releaseYear: g.releaseDate ? Number(g.releaseDate.slice(0, 4)) : null,
          coverSrc: g.coverImageId ? `/api/images/${g.coverImageId}` : g.coverUrl,
          platforms: [],
          summary: g.summary,
          inLibrary: ownedGames.has(g.id),
        })),
    };
    },
  );

  /** Every platform, flagged with whether it's on your consoles list. */
  app.get("/api/platforms", async (request, reply) => {
    const user = await requireUser(request, reply);
    if (!user) return;
    const owned = await ownedConsoleIds(user.id);
    const parentPlatform = alias(schema.platforms, "parent_platform");
    const rows = await db
      .select({
        id: schema.platforms.id,
        name: schema.platforms.name,
        abbreviation: schema.platforms.abbreviation,
        family: schema.platforms.family,
        sortOrder: schema.platforms.sortOrder,
        releaseDate: schema.platforms.releaseDate,
        summary: schema.platforms.summary,
        logoUrl: schema.platforms.logoUrl,
        parentPlatformId: schema.platforms.parentPlatformId,
        parentName: parentPlatform.name,
      })
      .from(schema.platforms)
      .leftJoin(parentPlatform, eq(schema.platforms.parentPlatformId, parentPlatform.id))
      .orderBy(schema.platforms.sortOrder);
    return rows.map((p) => ({ ...p, owned: owned.has(p.id) }));
  });
}
