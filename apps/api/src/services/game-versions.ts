import { and, eq, inArray } from "drizzle-orm";
import type { CollectionGameVersion } from "@gm/shared";
import { db, schema } from "../db/index.js";
import {
  buildVersionGraph,
  latestVersion,
  versionFamily,
  type Relation,
} from "./version-family.js";

/**
 * The other versions of a game — its original, its remakes and remasters —
 * worked out from the `remake` links a user has made on the Linked tab.
 *
 * A collection graph draws one node per game, and "Resident Evil 4" is at
 * least two games. This is what lets a node say so: hover it for the versions
 * you've linked, or flip the graph to show the newest of each.
 *
 * Everything here is per-user, like the links it reads. Two people can
 * disagree about whether something is a remaster, and each sees their own
 * answer — including on someone else's published collection.
 */

export interface GameVersions {
  /** every other version, oldest first */
  versions: CollectionGameVersion[];
  /** the one in `versions` that is the newest, when it isn't this game */
  latestVersionId: string | null;
}

/**
 * Versions for a set of games, keyed by game id. Games with no remake links
 * are simply absent from the map.
 *
 * Two queries whatever the size of the set: every remake link the user has
 * (there are dozens at most, and the family walk needs links that don't touch
 * the asked-for games directly), then one fetch for every game those families
 * mention.
 */
export async function versionsFor(
  userId: string,
  gameIds: string[],
): Promise<Map<string, GameVersions>> {
  const result = new Map<string, GameVersions>();
  if (gameIds.length === 0) return result;

  const edges = await db
    .select({
      gameId: schema.userGameLinks.gameId,
      relatedGameId: schema.userGameLinks.relatedGameId,
    })
    .from(schema.userGameLinks)
    .where(and(eq(schema.userGameLinks.userId, userId), eq(schema.userGameLinks.kind, "remake")));
  if (edges.length === 0) return result;

  const graph = buildVersionGraph(edges);
  const families = new Map<string, Map<string, Relation>>();
  const needed = new Set<string>();
  for (const gameId of new Set(gameIds)) {
    const family = versionFamily(graph, gameId);
    if (family.size === 0) continue;
    families.set(gameId, family);
    // the game itself too — picking the latest compares its date with theirs
    needed.add(gameId);
    for (const id of family.keys()) needed.add(id);
  }
  if (families.size === 0) return result;

  const rows = await db
    .select({
      id: schema.games.id,
      title: schema.games.title,
      releaseDate: schema.games.releaseDate,
      coverImageId: schema.games.coverImageId,
      coverUrl: schema.games.coverUrl,
      userGameId: schema.userGames.id,
      status: schema.userGames.status,
      customCoverImageId: schema.userGames.customCoverImageId,
    })
    .from(schema.games)
    .leftJoin(
      schema.userGames,
      and(eq(schema.userGames.gameId, schema.games.id), eq(schema.userGames.userId, userId)),
    )
    .where(inArray(schema.games.id, [...needed]));
  const byId = new Map(rows.map((r) => [r.id, r]));
  const releaseDateOf = (id: string) => byId.get(id)?.releaseDate ?? null;

  for (const [gameId, family] of families) {
    const versions: CollectionGameVersion[] = [];
    for (const [id, relation] of family) {
      const row = byId.get(id);
      if (!row) continue;
      versions.push({
        gameId: row.id,
        title: row.title,
        // a user's own cover upload wins over the catalog cover, as everywhere
        coverSrc: row.customCoverImageId
          ? `/api/images/${row.customCoverImageId}`
          : row.coverImageId
            ? `/api/images/${row.coverImageId}`
            : row.coverUrl,
        releaseDate: row.releaseDate,
        userGameId: row.userGameId,
        status: row.status,
        relation,
      });
    }
    // oldest first, unknown dates last — the order the versions came out in
    versions.sort((a, b) => {
      if (a.releaseDate !== b.releaseDate) {
        if (!a.releaseDate) return 1;
        if (!b.releaseDate) return -1;
        return a.releaseDate.localeCompare(b.releaseDate);
      }
      return a.title.localeCompare(b.title);
    });
    result.set(gameId, {
      versions,
      latestVersionId: latestVersion(graph, gameId, family.keys(), releaseDateOf),
    });
  }
  return result;
}
