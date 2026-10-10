/**
 * Which games are versions of which, from a set of remake links.
 *
 * Pure graph work with no database behind it — `services/game-versions.ts`
 * does the querying and hands the links to this — so it runs standalone:
 * `pnpm --filter @gm/api check:versions`.
 */
import type { CollectionGameVersion } from "@gm/shared";

export type Relation = CollectionGameVersion["relation"];

/** One stored `remake` link: `relatedGameId` remakes or remasters `gameId`. */
export interface RemakeEdge {
  gameId: string;
  relatedGameId: string;
}

export interface VersionGraph {
  /** a game → the games that remake it */
  remakes: Map<string, Set<string>>;
  /** a game → the games it remakes */
  originals: Map<string, Set<string>>;
}

export function buildVersionGraph(edges: RemakeEdge[]): VersionGraph {
  const remakes = new Map<string, Set<string>>();
  const originals = new Map<string, Set<string>>();
  const add = (map: Map<string, Set<string>>, from: string, to: string) => {
    if (!map.has(from)) map.set(from, new Set());
    map.get(from)!.add(to);
  };
  for (const edge of edges) {
    add(remakes, edge.gameId, edge.relatedGameId);
    add(originals, edge.relatedGameId, edge.gameId);
  }
  return { remakes, originals };
}

/** Everything reachable from `start` by following `steps`, not counting `start`. */
function reach(start: string, ...steps: Array<Map<string, Set<string>>>): Set<string> {
  const seen = new Set<string>([start]);
  const queue = [start];
  while (queue.length > 0) {
    const at = queue.pop()!;
    for (const step of steps) {
      for (const next of step.get(at) ?? []) {
        // the visited set is what makes a cycle harmless: the API refuses a
        // pair linked both ways round but doesn't walk for longer loops
        if (!seen.has(next)) {
          seen.add(next);
          queue.push(next);
        }
      }
    }
  }
  seen.delete(start);
  return seen;
}

/**
 * Every other version of one game, and what each is to it.
 *
 * The family is everything connected by remake links in either direction, so
 * two remasters of the same original find each other even though no link joins
 * them directly. Anything this game remakes — through however long a chain —
 * is its `original`; anything that remakes it is a `remake`; what's left
 * shares an ancestor and is a `sibling`.
 */
export function versionFamily(graph: VersionGraph, gameId: string): Map<string, Relation> {
  const family = new Map<string, Relation>();
  const everyone = reach(gameId, graph.remakes, graph.originals);
  if (everyone.size === 0) return family;
  const later = reach(gameId, graph.remakes);
  const earlier = reach(gameId, graph.originals);
  for (const id of everyone) {
    family.set(id, later.has(id) ? "remake" : earlier.has(id) ? "original" : "sibling");
  }
  return family;
}

/**
 * The most recent version in a game's family, or null when this game already
 * is it.
 *
 * "Most recent" starts from the links rather than the dates: a version nothing
 * remakes is the end of its line, and those are the only candidates — a
 * remaster with no release date on file is still newer than the game it
 * remasters, because you said so. Dates only break ties between ends.
 *
 * A game that is itself an end is harder to displace: only another end with a
 * known date *later than its own known date* counts. Without that, the 2021
 * remaster of a game would be swapped for the 2011 one whenever IGDB happened
 * to be missing the 2021 date.
 */
export function latestVersion(
  graph: VersionGraph,
  gameId: string,
  family: Iterable<string>,
  releaseDateOf: (gameId: string) => string | null,
): string | null {
  const members = [gameId, ...family];
  const ends = members.filter((id) => !graph.remakes.get(id)?.size);
  // no ends means the links loop; fall back to the whole family and the dates
  const pool = ends.length > 0 ? ends : members;

  // ISO dates compare as strings; unknown dates sort last, ids keep it stable
  const newestFirst = (a: string, b: string) => {
    const da = releaseDateOf(a);
    const dbb = releaseDateOf(b);
    if (da !== dbb) {
      if (!da) return 1;
      if (!dbb) return -1;
      return dbb.localeCompare(da);
    }
    return a.localeCompare(b);
  };

  if (pool.includes(gameId)) {
    const own = releaseDateOf(gameId);
    if (!own) return null;
    const newer = pool.filter((id) => {
      const date = releaseDateOf(id);
      return id !== gameId && date !== null && date > own;
    });
    return newer.sort(newestFirst)[0] ?? null;
  }
  return [...pool].sort(newestFirst)[0] ?? null;
}
