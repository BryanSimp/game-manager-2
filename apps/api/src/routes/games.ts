import type { FastifyInstance } from "fastify";
import { and, asc, eq, ilike } from "drizzle-orm";
import { alias } from "drizzle-orm/pg-core";
import { GAME_LINK_KINDS, type CatalogGame, type GameLink, type GameLinks } from "@gm/shared";
import { z } from "zod";
import { db, schema } from "../db/index.js";
import { requireUser } from "../plugins/auth.js";
import { igdbConfigured, igdbCoverUrl, searchIgdb } from "../services/igdb.js";
import { upsertGameFromIgdb } from "../services/catalog.js";
import { ownedConsoleIds } from "../services/consoles.js";
import { MIN_RATINGS, communityRatings, resolveTtbFor } from "../services/community.js";
import { gameToJson } from "./library.js";

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

  /**
   * One game from the shared catalog, for someone who may not own it.
   *
   * This is what a collection row links to when the game isn't in your
   * library. It used to link to the add-game search with the title pre-typed,
   * which asked you to find a game the app had already identified — so this
   * returns the game itself, plus the entry id when you *do* own it, letting
   * the page redirect to your copy rather than showing a stranger's view of
   * a game you have.
   */
  app.get<{ Params: { gameId: string } }>("/api/games/:gameId", async (request, reply) => {
    const user = await requireUser(request, reply);
    if (!user) return;
    const gameId = request.params.gameId;
    const [game] = await db.select().from(schema.games).where(eq(schema.games.id, gameId));
    if (!game) return reply.status(404).send({ message: "Game not found" });

    const [entry] = await db
      .select({ id: schema.userGames.id })
      .from(schema.userGames)
      .where(and(eq(schema.userGames.userId, user.id), eq(schema.userGames.gameId, gameId)));

    const [ttbMap, ratings] = await Promise.all([
      resolveTtbFor(user.id, [game]),
      communityRatings([gameId]),
    ]);

    const payload: CatalogGame = {
      game: gameToJson(game, ttbMap.get(gameId)),
      userGameId: entry?.id ?? null,
      communityRating: ratings.get(gameId) ?? null,
      minRatings: MIN_RATINGS,
    };
    return payload;
  });


  /**
   * How this game relates to others in your library: what hangs off it, and
   * what it hangs off.
   *
   * Both directions come back from one request because a game's page shows
   * both — "DLC & add-ons" underneath it, and a "DLC for The Witcher 3"
   * breadcrumb above. Splitting them into two routes would mean two round
   * trips to draw one panel.
   *
   * Links are per-user (see `user_game_links`), so this resolves against
   * whoever is asking and never leaks anyone else's arrangement.
   */
  app.get<{ Params: { gameId: string } }>("/api/games/:gameId/links", async (request, reply) => {
    const user = await requireUser(request, reply);
    if (!user) return;
    const links = await gameLinksFor(user.id, request.params.gameId);
    return links;
  });

  /**
   * Link another game to this one.
   *
   * `direction` decides which end is the base, so the same control works from
   * either side: standing on The Witcher 3 you add its DLC (`child`), and
   * standing on Blood and Wine you say what it belongs to (`parent`). Storing
   * one direction and flipping the input is what keeps a link from existing
   * twice with the two games swapped.
   */
  app.post<{ Params: { gameId: string } }>("/api/games/:gameId/links", async (request, reply) => {
    const user = await requireUser(request, reply);
    if (!user) return;

    const parsed = z
      .object({
        kind: z.enum(GAME_LINK_KINDS),
        relatedGameId: z.string().uuid().optional(),
        igdbId: z.number().int().positive().optional(),
        direction: z.enum(["child", "parent"]).default("child"),
      })
      .refine((v) => v.relatedGameId || v.igdbId, {
        message: "relatedGameId or igdbId required",
      })
      .safeParse(request.body);
    if (!parsed.success) {
      return reply.status(400).send({ message: parsed.error.issues[0]?.message });
    }

    const [game] = await db
      .select({ id: schema.games.id })
      .from(schema.games)
      .where(eq(schema.games.id, request.params.gameId));
    if (!game) return reply.status(404).send({ message: "Game not found" });

    // a game you don't own can be linked, the same way a collection can list
    // one — noting that a DLC exists is useful before you buy it
    let relatedId = parsed.data.relatedGameId ?? null;
    if (!relatedId && parsed.data.igdbId) {
      try {
        relatedId = await upsertGameFromIgdb(parsed.data.igdbId);
      } catch (err) {
        return reply
          .status(502)
          .send({ message: err instanceof Error ? err.message : "IGDB lookup failed" });
      }
    }
    if (!relatedId) return reply.status(400).send({ message: "relatedGameId or igdbId required" });
    if (relatedId === game.id) {
      return reply.status(400).send({ message: "A game can't be linked to itself" });
    }

    // `direction` is an input convenience; storage is always base → related
    const base = parsed.data.direction === "parent" ? relatedId : game.id;
    const related = parsed.data.direction === "parent" ? game.id : relatedId;

    // The opposite link would make the pair its own parent and child, which
    // renders as a game listing itself. Refused rather than silently ignored
    // so the UI can say why.
    const [inverse] = await db
      .select({ id: schema.userGameLinks.id })
      .from(schema.userGameLinks)
      .where(
        and(
          eq(schema.userGameLinks.userId, user.id),
          eq(schema.userGameLinks.gameId, related),
          eq(schema.userGameLinks.relatedGameId, base),
        ),
      );
    if (inverse) {
      return reply
        .status(409)
        .send({ message: "These two are already linked the other way round" });
    }

    const [created] = await db
      .insert(schema.userGameLinks)
      .values({ userId: user.id, gameId: base, relatedGameId: related, kind: parsed.data.kind })
      .onConflictDoNothing()
      .returning({ id: schema.userGameLinks.id });
    reply.status(created ? 201 : 200);
    return { ok: true, id: created?.id ?? null };
  });

  /** Unlink. Works from either end — the row is found by id, not by side. */
  app.delete<{ Params: { gameId: string; linkId: string } }>(
    "/api/games/:gameId/links/:linkId",
    async (request, reply) => {
      const user = await requireUser(request, reply);
      if (!user) return;
      const deleted = await db
        .delete(schema.userGameLinks)
        .where(
          and(
            eq(schema.userGameLinks.id, request.params.linkId),
            eq(schema.userGameLinks.userId, user.id),
          ),
        )
        .returning({ id: schema.userGameLinks.id });
      if (deleted.length === 0) return reply.status(404).send({ message: "Link not found" });
      return { ok: true };
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

/**
 * Both ends of one game's links, each row carrying the game at the *other*
 * end plus your library entry for it (so a row can open your copy, or say it
 * isn't one).
 *
 * Two queries rather than a union: they select the same columns off opposite
 * join keys, and a union of two differently-joined selects reads far worse
 * than saying "the ones below me" and "the ones above me" separately.
 */
export async function gameLinksFor(userId: string, gameId: string): Promise<GameLinks> {
  const select = {
    id: schema.userGameLinks.id,
    kind: schema.userGameLinks.kind,
    createdAt: schema.userGameLinks.createdAt,
    gameId: schema.games.id,
    title: schema.games.title,
    releaseDate: schema.games.releaseDate,
    coverImageId: schema.games.coverImageId,
    coverUrl: schema.games.coverUrl,
    userGameId: schema.userGames.id,
    status: schema.userGames.status,
    customCoverImageId: schema.userGames.customCoverImageId,
  };

  const rows = await Promise.all(
    (["children", "parents"] as const).map((side) =>
      db
        .select(select)
        .from(schema.userGameLinks)
        // children: this game is the base, so join the *related* game.
        // parents: this game is the related one, so join the base.
        .innerJoin(
          schema.games,
          eq(
            schema.games.id,
            side === "children"
              ? schema.userGameLinks.relatedGameId
              : schema.userGameLinks.gameId,
          ),
        )
        .leftJoin(
          schema.userGames,
          and(eq(schema.userGames.gameId, schema.games.id), eq(schema.userGames.userId, userId)),
        )
        .where(
          and(
            eq(schema.userGameLinks.userId, userId),
            eq(
              side === "children" ? schema.userGameLinks.gameId : schema.userGameLinks.relatedGameId,
              gameId,
            ),
          ),
        )
        .orderBy(asc(schema.games.releaseDate), asc(schema.games.title)),
    ),
  );

  const toLink = (r: (typeof rows)[number][number]): GameLink => ({
    id: r.id,
    kind: r.kind as GameLink["kind"],
    game: {
      id: r.gameId,
      title: r.title,
      releaseDate: r.releaseDate,
      // a user's own cover upload wins over the catalog cover, as everywhere
      coverSrc: r.customCoverImageId
        ? `/api/images/${r.customCoverImageId}`
        : r.coverImageId
          ? `/api/images/${r.coverImageId}`
          : r.coverUrl,
      userGameId: r.userGameId,
      status: r.status,
    },
  });

  return { children: rows[0]!.map(toLink), parents: rows[1]!.map(toLink) };
}
