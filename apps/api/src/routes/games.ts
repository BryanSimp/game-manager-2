import type { FastifyInstance } from "fastify";
import { and, asc, eq, ilike } from "drizzle-orm";
import { alias } from "drizzle-orm/pg-core";
import {
  GAME_LINK_ROLES,
  GAME_LINK_ROLE_META,
  GAME_LINK_SORTS,
  parseSteamAppQuery,
  type CatalogGame,
  type GameLink,
  type GameLinkSection,
  type GameLinkSort,
  type GameLinks,
  type SearchResponse,
  type SearchResult,
} from "@gm/shared";
import { z } from "zod";
import { db, schema } from "../db/index.js";
import { requireUser } from "../plugins/auth.js";
import {
  getIgdbGameBySteamAppId,
  igdbConfigured,
  igdbCoverUrl,
  searchIgdb,
  type IgdbGame,
} from "../services/igdb.js";
import { getStoreAppName } from "../services/steam.js";
import { upsertGameFromIgdb } from "../services/catalog.js";
import { ownedConsoleIds } from "../services/consoles.js";
import { MIN_RATINGS, communityRatings, resolveTtbFor } from "../services/community.js";
import { linkGames } from "../services/game-links.js";
import { replyWithServiceError } from "../services/service-error.js";
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
    const igdb = await igdbConfigured();

    const fromIgdb = (g: IgdbGame): SearchResult => ({
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
    });
    const fromCatalog = (g: typeof schema.games.$inferSelect): SearchResult => ({
      igdbId: g.igdbId,
      gameId: g.id,
      title: g.title,
      releaseYear: g.releaseDate ? Number(g.releaseDate.slice(0, 4)) : null,
      coverSrc: g.coverImageId ? `/api/images/${g.coverImageId}` : g.coverUrl,
      platforms: [],
      summary: g.summary,
      inLibrary: ownedGames.has(g.id),
    });

    /** IGDB when it's configured; the local catalog when it isn't. */
    async function titleSearch(text: string, limit = 20): Promise<SearchResult[]> {
      if (igdb) return ((await searchIgdb(text, limit, year)) ?? []).map(fromIgdb);
      const local = await db
        .select()
        .from(schema.games)
        .where(ilike(schema.games.title, `%${text}%`))
        .limit(limit);
      return local
        .filter((g) => !year || g.releaseDate?.startsWith(String(year)))
        .map(fromCatalog);
    }

    /**
     * The one game a Steam app id belongs to. IGDB's external-id table first,
     * since it's the same answer the Steam import trusts; then the catalog's
     * own `steam_app_id`, which an import or a "Wrong game?" fix wrote.
     */
    async function steamAppGame(appId: number): Promise<SearchResult | null> {
      if (igdb) {
        const game = await getIgdbGameBySteamAppId(appId);
        if (game) return fromIgdb(game);
      }
      const [row] = await db
        .select()
        .from(schema.games)
        .where(eq(schema.games.steamAppId, appId))
        .limit(1);
      return row ? fromCatalog(row) : null;
    }

    const steamQuery = parseSteamAppQuery(q);
    if (!steamQuery) {
      const response: SearchResponse = { igdb, results: await titleSearch(q) };
      return response;
    }

    // Searching by Steam app id — some games only turn up for the exact right
    // spelling, and a store link has none to get wrong. A bare number is a
    // title as well ("1942"), so it's searched as one either way and the app,
    // if there is one, goes on top.
    const { appId, explicit } = steamQuery;
    const [exact, asTitle] = await Promise.all([
      steamAppGame(appId),
      explicit ? Promise.resolve([]) : titleSearch(q),
    ]);
    if (exact) {
      const response: SearchResponse = {
        igdb,
        results: dedupeResults([{ ...exact, steamAppId: appId }, ...asTitle]).slice(0, 20),
        steam: { appId, found: true, storeName: null },
      };
      return response;
    }

    // Nothing links the app to a game, so ask Steam what it's called and
    // search for that — a guess, and the response says so.
    const storeName = await getStoreAppName(appId);
    if (!storeName) {
      // a number nobody knows is only a title search, not a failed lookup
      const response: SearchResponse = explicit
        ? { igdb, results: [], steam: { appId, found: false, storeName: null } }
        : { igdb, results: asTitle };
      return response;
    }
    const byName = await titleSearch(storeName.replace(/[™®©]/g, " "), 10);
    const response: SearchResponse = {
      igdb,
      results: dedupeResults([...byName, ...asTitle]).slice(0, 20),
      steam: { appId, found: false, storeName },
    };
    return response;
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
   * A game's links, one section per role, from this game's point of view.
   *
   * Both ends of every stored row come back, which is the whole trick behind
   * "a link shows on both games": linking Blood and Wine as DLC on The Witcher
   * 3's page writes one row, and Blood and Wine's page reads that same row as
   * its base game. Nothing here cares whether you own either game — a DLC you
   * haven't bought still says what it's for.
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
   * `role` is what the game you're adding is *to this one* — its DLC, its
   * prequel, its sequel, a remake of it, or (from the other side) the base
   * game it's DLC for or the original it remakes. Each role maps to one kind
   * and one end of the row (`GAME_LINK_ROLE_META`), so adding a prequel on
   * Half-Life 2 and a sequel on Half-Life store the same thing, and a pair
   * can't end up recorded twice with the games swapped.
   */
  app.post<{ Params: { gameId: string } }>("/api/games/:gameId/links", async (request, reply) => {
    const user = await requireUser(request, reply);
    if (!user) return;

    const parsed = z
      .object({
        role: z.enum(GAME_LINK_ROLES),
        relatedGameId: z.string().uuid().optional(),
        igdbId: z.number().int().positive().optional(),
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

    try {
      const link = await linkGames(user.id, game.id, relatedId, parsed.data.role);
      reply.status(link.created ? 201 : 200);
      return { ok: true, id: link.id };
    } catch (err) {
      return replyWithServiceError(reply, err);
    }
  });

  /**
   * Put one section of a game's links in the order you want — and switch that
   * section to custom order, since arranging it by hand is the point.
   *
   * Writes whichever position column belongs to this game's end of the rows,
   * so ordering Half-Life 2's prequels leaves Half-Life's sequels alone. Ids
   * not in the section are ignored and any the caller left out keep their
   * place at the end, the same rule the collection order follows — a stale
   * tab can't drop a link made from another one.
   */
  app.put<{ Params: { gameId: string } }>(
    "/api/games/:gameId/links/order",
    async (request, reply) => {
      const user = await requireUser(request, reply);
      if (!user) return;
      const parsed = z
        .object({
          role: z.enum(GAME_LINK_ROLES),
          linkIds: z.array(z.string().uuid()).max(500),
        })
        .safeParse(request.body);
      if (!parsed.success) {
        return reply.status(400).send({ message: parsed.error.issues[0]?.message });
      }

      const gameId = request.params.gameId;
      const role = parsed.data.role;
      const meta = GAME_LINK_ROLE_META[role];
      const ownEnd =
        meta.side === "base" ? schema.userGameLinks.gameId : schema.userGameLinks.relatedGameId;
      const rows = await db
        .select({ id: schema.userGameLinks.id })
        .from(schema.userGameLinks)
        .where(
          and(
            eq(schema.userGameLinks.userId, user.id),
            eq(ownEnd, gameId),
            eq(schema.userGameLinks.kind, meta.kind),
          ),
        )
        .orderBy(
          asc(
            meta.side === "base"
              ? schema.userGameLinks.basePosition
              : schema.userGameLinks.relatedPosition,
          ),
        );
      if (rows.length === 0) {
        return reply.status(404).send({ message: "Nothing is linked there" });
      }

      const known = new Set(rows.map((r) => r.id));
      const ordered = [...new Set(parsed.data.linkIds)].filter((id) => known.has(id));
      const seen = new Set(ordered);
      const rest = rows.map((r) => r.id).filter((id) => !seen.has(id));

      await db.transaction(async (tx) => {
        let position = 0;
        for (const id of [...ordered, ...rest]) {
          position += 1;
          await tx
            .update(schema.userGameLinks)
            .set(meta.side === "base" ? { basePosition: position } : { relatedPosition: position })
            .where(and(eq(schema.userGameLinks.id, id), eq(schema.userGameLinks.userId, user.id)));
        }
        await tx
          .insert(schema.userGameLinkSorts)
          .values({ userId: user.id, gameId, role, sort: "custom" })
          .onConflictDoUpdate({
            target: [
              schema.userGameLinkSorts.userId,
              schema.userGameLinkSorts.gameId,
              schema.userGameLinkSorts.role,
            ],
            set: { sort: "custom" },
          });
      });
      return { ok: true };
    },
  );

  /**
   * Choose how one section of a game's links is ordered: by release date, or
   * the order you set. Remembered per game and per section — a series' sequels
   * might want release order while its DLC wants the order you play them in.
   * Switching to release date keeps your custom order for when you come back.
   */
  app.put<{ Params: { gameId: string } }>(
    "/api/games/:gameId/links/sort",
    async (request, reply) => {
      const user = await requireUser(request, reply);
      if (!user) return;
      const parsed = z
        .object({ role: z.enum(GAME_LINK_ROLES), sort: z.enum(GAME_LINK_SORTS) })
        .safeParse(request.body);
      if (!parsed.success) {
        return reply.status(400).send({ message: parsed.error.issues[0]?.message });
      }

      const gameId = request.params.gameId;
      const [game] = await db
        .select({ id: schema.games.id })
        .from(schema.games)
        .where(eq(schema.games.id, gameId));
      if (!game) return reply.status(404).send({ message: "Game not found" });

      await db
        .insert(schema.userGameLinkSorts)
        .values({ userId: user.id, gameId, role: parsed.data.role, sort: parsed.data.sort })
        .onConflictDoUpdate({
          target: [
            schema.userGameLinkSorts.userId,
            schema.userGameLinkSorts.gameId,
            schema.userGameLinkSorts.role,
          ],
          set: { sort: parsed.data.sort },
        });
      return { ok: true };
    },
  );

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

/** First occurrence wins, so a Steam app's own game keeps its place on top. */
function dedupeResults(results: SearchResult[]): SearchResult[] {
  const seen = new Set<string>();
  return results.filter((r) => {
    const key = r.igdbId !== null ? `igdb:${r.igdbId}` : `game:${r.gameId ?? r.title}`;
    return !seen.has(key) && seen.add(key);
  });
}

/**
 * One game's links as its page shows them: a section per role, each row
 * carrying the game at the *other* end plus your library entry for it (so a
 * row can open your copy, or say it isn't one), each section already in the
 * order you chose for it.
 *
 * Two link queries rather than a union — they select the same columns off
 * opposite join keys, "the rows where I'm the base" and "the rows where I'm
 * the related game" — plus the section sorts. Sorting happens here rather
 * than in SQL because it's per section and the sections are small.
 */
export async function gameLinksFor(userId: string, gameId: string): Promise<GameLinks> {
  const linkRows = (side: "base" | "related") =>
    db
      .select({
        id: schema.userGameLinks.id,
        kind: schema.userGameLinks.kind,
        basePosition: schema.userGameLinks.basePosition,
        relatedPosition: schema.userGameLinks.relatedPosition,
        gameId: schema.games.id,
        igdbId: schema.games.igdbId,
        title: schema.games.title,
        releaseDate: schema.games.releaseDate,
        coverImageId: schema.games.coverImageId,
        coverUrl: schema.games.coverUrl,
        userGameId: schema.userGames.id,
        status: schema.userGames.status,
        customCoverImageId: schema.userGames.customCoverImageId,
      })
      .from(schema.userGameLinks)
      // as the base, the other end is the related game; as the related game,
      // the other end is the base
      .innerJoin(
        schema.games,
        eq(
          schema.games.id,
          side === "base" ? schema.userGameLinks.relatedGameId : schema.userGameLinks.gameId,
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
            side === "base" ? schema.userGameLinks.gameId : schema.userGameLinks.relatedGameId,
            gameId,
          ),
        ),
      );

  const [asBase, asRelated, sorts] = await Promise.all([
    linkRows("base"),
    linkRows("related"),
    db
      .select({ role: schema.userGameLinkSorts.role, sort: schema.userGameLinkSorts.sort })
      .from(schema.userGameLinkSorts)
      .where(
        and(
          eq(schema.userGameLinkSorts.userId, userId),
          eq(schema.userGameLinkSorts.gameId, gameId),
        ),
      ),
  ]);
  type Row = (typeof asBase)[number];

  const sortByRole = new Map(sorts.map((s) => [s.role, s.sort]));
  // unknown release dates sink rather than sorting as the year 0
  const byRelease = (a: Row, b: Row) => {
    if (a.releaseDate !== b.releaseDate) {
      if (!a.releaseDate) return 1;
      if (!b.releaseDate) return -1;
      return a.releaseDate.localeCompare(b.releaseDate);
    }
    return a.title.localeCompare(b.title);
  };

  const sections = GAME_LINK_ROLES.map((role): GameLinkSection => {
    const meta = GAME_LINK_ROLE_META[role];
    const sort: GameLinkSort = sortByRole.get(role) === "custom" ? "custom" : "release";
    const position = (r: Row) => (meta.side === "base" ? r.basePosition : r.relatedPosition);
    const rows = (meta.side === "base" ? asBase : asRelated)
      .filter((r) => r.kind === meta.kind)
      .sort((a, b) => (sort === "custom" ? position(a) - position(b) : 0) || byRelease(a, b));

    return {
      role,
      sort,
      links: rows.map(
        (r): GameLink => ({
          id: r.id,
          kind: meta.kind,
          role,
          game: {
            id: r.gameId,
            igdbId: r.igdbId,
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
        }),
      ),
    };
  });

  return { sections };
}
