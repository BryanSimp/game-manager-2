import { and, eq, inArray, isNotNull, sql } from "drizzle-orm";
import { normalizeTtb, resolveTtb, type ResolvedTtb, type TtbTriple } from "@gm/shared";
import { db, schema } from "../db/index.js";
import { notDemoUser } from "./demo.js";

/**
 * What everyone else thinks, aggregated.
 *
 * Two numbers the app has never had: what a game scores across all its
 * players, and how long it takes when IGDB has no figure — which is most
 * niche titles, and exactly the games a self-hosted library is full of.
 *
 * Both are computed on read. There's no rollup column to drift, and each of
 * these is one indexed GROUP BY (migration 0020 added the game_id indexes
 * that make them cheap; the existing keys only sort by user).
 */

/**
 * Ratings below this stay hidden.
 *
 * It's a privacy floor, not a quality one. With one or two raters and a
 * friends list, an "average rating" is one identifiable person's opinion.
 */
export const MIN_RATINGS = 3;

export interface CommunityRating {
  average: number;
  count: number;
}

export async function communityRatings(
  gameIds: string[],
): Promise<Map<string, CommunityRating>> {
  if (gameIds.length === 0) return new Map();
  const rows = await db
    .select({
      gameId: schema.userGames.gameId,
      average: sql<number>`avg(${schema.userGames.rating})::float`,
      count: sql<number>`count(${schema.userGames.rating})::int`,
    })
    .from(schema.userGames)
    .where(
      and(
        inArray(schema.userGames.gameId, gameIds),
        isNotNull(schema.userGames.rating),
        // the demo library's scores are invented, so they don't get a say
        notDemoUser(schema.userGames.userId),
      ),
    )
    .groupBy(schema.userGames.gameId)
    .having(sql`count(${schema.userGames.rating}) >= ${MIN_RATINGS}`);

  return new Map(
    rows.map((r) => [
      r.gameId,
      // half-star granularity in, one decimal out
      { average: Math.round(r.average * 10) / 10, count: r.count },
    ]),
  );
}

export type CommunityTime = TtbTriple & { count: number };

/**
 * Average submitted play times per game.
 *
 * One submission is enough to publish, unlike ratings: how long a game takes
 * is a fact someone measured, not an opinion about them, and the UI says how
 * many players it's averaging. Each figure averages independently — someone
 * who only recorded a main-story time shouldn't drag the completionist
 * average toward it — and `normalizeTtb` re-sorts the result, since averaging
 * three columns separately can technically invert them.
 */
export async function communityTimes(gameIds: string[]): Promise<Map<string, CommunityTime>> {
  if (gameIds.length === 0) return new Map();
  const rows = await db
    .select({
      gameId: schema.userTimeToBeat.gameId,
      main: sql<number | null>`avg(${schema.userTimeToBeat.mainSeconds})::float`,
      mainExtra: sql<number | null>`avg(${schema.userTimeToBeat.mainExtraSeconds})::float`,
      completionist: sql<number | null>`avg(${schema.userTimeToBeat.completionistSeconds})::float`,
      count: sql<number>`count(*)::int`,
    })
    .from(schema.userTimeToBeat)
    .where(
      and(
        inArray(schema.userTimeToBeat.gameId, gameIds),
        notDemoUser(schema.userTimeToBeat.userId),
      ),
    )
    .groupBy(schema.userTimeToBeat.gameId);

  const round = (v: number | null) => (v == null ? null : Math.round(v));
  return new Map(
    rows.map((r) => [
      r.gameId,
      {
        ...normalizeTtb({
          ttbMain: round(r.main),
          ttbMainExtra: round(r.mainExtra),
          ttbCompletionist: round(r.completionist),
        }),
        count: r.count,
      },
    ]),
  );
}

type CatalogTtb = TtbTriple & { id: string; ttbSource: string | null };

/**
 * Resolve play times for a batch of catalog rows.
 *
 * Your own submissions are looked up for every game, since one overrides
 * IGDB's figure — that's a single query on the (user, game) primary key.
 * The community average, the expensive half, is only computed for games with
 * neither your figure nor a catalog one, which keeps `GET /api/library` — the
 * app's hottest route — to one grouped query over a usually-small subset.
 */
export async function resolveTtbFor(
  userId: string,
  games: CatalogTtb[],
): Promise<Map<string, ResolvedTtb>> {
  if (games.length === 0) return new Map();
  const own = await ownTimes(
    userId,
    games.map((g) => g.id),
  );
  const blank = (t: TtbTriple) => t.ttbMain == null && t.ttbMainExtra == null && t.ttbCompletionist == null;
  const needCommunity = games
    .filter((g) => blank(g) && !own.has(g.id))
    .map((g) => g.id);
  const community = await communityTimes(needCommunity);

  const resolved = new Map<string, ResolvedTtb>();
  for (const game of games) {
    resolved.set(game.id, resolveTtb(game, own.get(game.id) ?? null, community.get(game.id) ?? null));
  }
  return resolved;
}

/** This user's own submitted play times, for the games asked about. */
export async function ownTimes(
  userId: string,
  gameIds: string[],
): Promise<Map<string, TtbTriple>> {
  if (gameIds.length === 0) return new Map();
  const rows = await db
    .select()
    .from(schema.userTimeToBeat)
    .where(
      and(
        eq(schema.userTimeToBeat.userId, userId),
        inArray(schema.userTimeToBeat.gameId, gameIds),
      ),
    );
  return new Map(
    rows.map((r) => [
      r.gameId,
      {
        ttbMain: r.mainSeconds,
        ttbMainExtra: r.mainExtraSeconds,
        ttbCompletionist: r.completionistSeconds,
      },
    ]),
  );
}
