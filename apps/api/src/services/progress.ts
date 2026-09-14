import { and, asc, eq, sql } from "drizzle-orm";
import { estimateProgress, ttbForBasis, type ProgressBasis, type TtbTriple } from "@gm/shared";
import { db, schema } from "../db/index.js";

export interface MissionCounts {
  total: number;
  done: number;
}

/**
 * Mission-list counts for every game the user tracks, keyed by game id.
 * Computed in one query so a list route doesn't fan out per entry.
 * Where a game has several mission lists the oldest wins, matching
 * GET /api/library/:id/progress.
 *
 * This lives in a service rather than in `routes/library.ts` because the
 * library list and a collection's remaining-time total have to answer "how
 * far through this game are you?" identically — two copies of the
 * oldest-wins rule would drift the first time one of them was touched.
 */
export async function missionCountsByGame(userId: string): Promise<Map<string, MissionCounts>> {
  const rows = await db
    .select({
      gameId: schema.checklistTemplates.gameId,
      createdAt: schema.checklistTemplates.createdAt,
      total: sql<number>`count(${schema.checklistItems.id})::int`,
      done: sql<number>`count(${schema.userChecklistItems.userId})::int`,
    })
    .from(schema.checklistTemplates)
    .leftJoin(
      schema.checklistItems,
      eq(schema.checklistItems.templateId, schema.checklistTemplates.id),
    )
    .leftJoin(
      schema.userChecklistItems,
      and(
        eq(schema.userChecklistItems.itemId, schema.checklistItems.id),
        eq(schema.userChecklistItems.userId, userId),
      ),
    )
    .where(
      and(
        eq(schema.checklistTemplates.authorUserId, userId),
        eq(schema.checklistTemplates.kind, "missions"),
      ),
    )
    .groupBy(
      schema.checklistTemplates.id,
      schema.checklistTemplates.gameId,
      schema.checklistTemplates.createdAt,
    )
    .orderBy(asc(schema.checklistTemplates.createdAt));

  const map = new Map<string, MissionCounts>();
  for (const row of rows) {
    // oldest first, so the first one seen for a game is the one that counts
    if (!map.has(row.gameId)) map.set(row.gameId, { total: row.total, done: row.done });
  }
  return map;
}

/** What one game contributes to a "how long is this list of games?" total. */
export interface GameTime {
  /** the full play time for the chosen basis, in seconds — null when unknown */
  totalSeconds: number | null;
  /**
   * What is left of it. Zero for a game you've finished, a pro-rated figure
   * when a mission list has progress on it, and the full length otherwise.
   * Null when the length is unknown, which is *not* the same as zero.
   */
  remainingSeconds: number | null;
  /** counted as done: finished, or marked 100% */
  finished: boolean;
  /**
   * Marked "endless" (`user_games.ttb_enabled = false`) — a multiplayer or
   * roguelike game with no end to reach. The dashboard's backlog total already
   * leaves these out; a collection total has to as well, or one Rocket League
   * makes the number meaningless.
   */
  endless: boolean;
}

/**
 * How much of one game is left to play.
 *
 * Three cases, in order:
 *  1. finished (or 100%-ed) — nothing left, whatever the mission list says.
 *     A list you never finished ticking off shouldn't keep charging you for a
 *     game you've put down as beaten.
 *  2. a mission list with entries — the same pro-rated estimate the library
 *     card and the Progress tab show, so the three never disagree.
 *  3. everything else — the whole length, including games you haven't started
 *     and games you're "playing" without a mission list to measure against.
 */
export function gameTime({
  ttb,
  basis,
  status,
  completed100,
  ttbEnabled = true,
  missions,
}: {
  ttb: TtbTriple;
  basis: ProgressBasis;
  status: string | null;
  completed100: boolean;
  ttbEnabled?: boolean;
  missions?: MissionCounts;
}): GameTime {
  const totalSeconds = ttbForBasis(ttb, basis);
  const finished = status === "finished" || completed100;
  const endless = !ttbEnabled;
  const base = { totalSeconds, finished, endless };
  if (endless) return { ...base, remainingSeconds: null };
  if (finished) return { ...base, remainingSeconds: totalSeconds === null ? null : 0 };
  if (missions && missions.total > 0) {
    const estimate = estimateProgress({
      total: missions.total,
      done: missions.done,
      totalSeconds,
    });
    return { ...base, remainingSeconds: estimate.remainingSeconds };
  }
  return { ...base, remainingSeconds: totalSeconds };
}

/** A collection's play time, rolled up. */
export interface CollectionTime {
  /** every counted length added together, finished games included */
  totalSeconds: number;
  /** what's left: finished games drop out, part-played ones are pro-rated */
  remainingSeconds: number;
  /** games whose length went into the totals */
  counted: number;
  /** games with no length anywhere — the totals are short by these */
  unknown: number;
  /** games marked endless, left out of both totals on purpose */
  endless: number;
  /** games you've finished or 100%-ed */
  finished: number;
}

export function emptyCollectionTime(): CollectionTime {
  return {
    totalSeconds: 0,
    remainingSeconds: 0,
    counted: 0,
    unknown: 0,
    endless: 0,
    finished: 0,
  };
}

/** Add one game's contribution into a running collection total. */
export function addGameTime(into: CollectionTime, time: GameTime): CollectionTime {
  if (time.finished) into.finished++;
  if (time.endless) {
    into.endless++;
    return into;
  }
  if (time.totalSeconds === null) {
    into.unknown++;
    return into;
  }
  into.counted++;
  into.totalSeconds += time.totalSeconds;
  into.remainingSeconds += time.remainingSeconds ?? time.totalSeconds;
  return into;
}
