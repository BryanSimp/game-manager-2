import type { FastifyInstance } from "fastify";
import { and, count, desc, eq } from "drizzle-orm";
import { db, schema } from "../db/index.js";
import { requireUser } from "../plugins/auth.js";
import { resolveTtbFor } from "../services/community.js";

export function registerDashboardRoutes(app: FastifyInstance): void {
  app.get("/api/dashboard", async (request, reply) => {
    const user = await requireUser(request, reply);
    if (!user) return;

    const statusRows = await db
      .select({ status: schema.userGames.status, n: count() })
      .from(schema.userGames)
      .where(eq(schema.userGames.userId, user.id))
      .groupBy(schema.userGames.status);

    const platformRows = await db
      .select({
        name: schema.platforms.name,
        abbreviation: schema.platforms.abbreviation,
        family: schema.platforms.family,
        n: count(),
      })
      .from(schema.userGamePlatforms)
      .innerJoin(schema.userGames, eq(schema.userGamePlatforms.userGameId, schema.userGames.id))
      .innerJoin(schema.platforms, eq(schema.userGamePlatforms.platformId, schema.platforms.id))
      .where(eq(schema.userGames.userId, user.id))
      .groupBy(schema.platforms.name, schema.platforms.abbreviation, schema.platforms.family)
      .orderBy(desc(count()));

    /*
     * Backlog hours resolve play times through the same helper a game's own
     * page uses, rather than reading games.ttb_main directly. Since play times
     * went per-user, a game IGDB knows nothing about takes its length from
     * your submission and then from the community average — and a total that
     * disagreed with the games it was adding up would be worse than no total.
     */
    const backlogGames = await db
      .select({ game: schema.games })
      .from(schema.userGames)
      .innerJoin(schema.games, eq(schema.userGames.gameId, schema.games.id))
      .where(
        and(
          eq(schema.userGames.userId, user.id),
          eq(schema.userGames.status, "backlog"),
          eq(schema.userGames.ttbEnabled, true),
        ),
      );
    const backlogTtb = await resolveTtbFor(
      user.id,
      backlogGames.map((r) => r.game),
    );
    const backlog = {
      seconds: backlogGames.reduce(
        (total, r) => total + (backlogTtb.get(r.game.id)?.ttbMain ?? 0),
        0,
      ),
    };

    const recentlyFinished = await db
      .select({
        id: schema.userGames.id,
        title: schema.games.title,
        finishedAt: schema.userGames.finishedAt,
        rating: schema.userGames.rating,
        coverImageId: schema.games.coverImageId,
        coverUrl: schema.games.coverUrl,
        customCoverImageId: schema.userGames.customCoverImageId,
      })
      .from(schema.userGames)
      .innerJoin(schema.games, eq(schema.userGames.gameId, schema.games.id))
      .where(and(eq(schema.userGames.userId, user.id), eq(schema.userGames.status, "finished")))
      .orderBy(desc(schema.userGames.finishedAt))
      .limit(6);

    const statusCounts = Object.fromEntries(statusRows.map((r) => [r.status, r.n]));
    const total = statusRows.reduce((acc, r) => acc + r.n, 0);

    return {
      total,
      statusCounts,
      platformCounts: platformRows.map((r) => ({
        name: r.name,
        abbreviation: r.abbreviation,
        family: r.family,
        count: r.n,
      })),
      backlogSeconds: backlog?.seconds ? Number(backlog.seconds) : 0,
      recentlyFinished: recentlyFinished.map((r) => ({
        id: r.id,
        title: r.title,
        finishedAt: r.finishedAt,
        rating: r.rating ? Number(r.rating) : null,
        coverSrc: r.customCoverImageId
          ? `/api/images/${r.customCoverImageId}`
          : r.coverImageId
            ? `/api/images/${r.coverImageId}`
            : r.coverUrl,
      })),
    };
  });
}
