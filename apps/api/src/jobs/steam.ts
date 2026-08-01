import { and, eq, inArray, isNotNull, isNull } from "drizzle-orm";
import { db, schema } from "../db/index.js";
import { matchTitle, type MatchCandidate, type MatchResult } from "../services/matcher.js";
import { similarity } from "../services/noise-filter.js";
import { upsertGameFromIgdb } from "../services/catalog.js";
import { findIgdbGameBySteamAppId } from "../services/igdb.js";
import { rememberConsoles } from "../services/consoles.js";
import {
  getAppReleaseYear,
  getOwnedGames,
  getPlayerAchievements,
  getSchemaAchievements,
} from "../services/steam.js";
import { getBoss, STEAM_IMPORT_QUEUE, STEAM_SYNC_QUEUE } from "../services/queue.js";

/** Confidence needed to add a Steam game to the library without review. */
const AUTO_ADD_THRESHOLD = 0.85;

// workers are in-process, so live job state can be plain memory
const running = { import: new Set<string>(), sync: new Set<string>() };
export function steamJobRunning(kind: "import" | "sync", userId: string): boolean {
  return running[kind].has(userId);
}

/** Strip Steam-listing noise that hurts IGDB matching. */
function cleanSteamName(name: string): string {
  return name
    .replace(/[™®]/g, "")
    .replace(/\s*[-–:]\s*(game of the year|goty|definitive|complete|enhanced|remastered|anniversary|deluxe|ultimate|gold|legendary)( edition)?$/i, "")
    .replace(/\s+/g, " ")
    .trim();
}

/** Playtest/demo/soundtrack/server tools — never library material. */
function isNoiseApp(name: string): boolean {
  return /\b(playtest|demo|dedicated server|soundtrack|sdk|beta test|test server)\b/i.test(name);
}

/** Store lookups are only worth it for genuine ties; cap them per import. */
const MAX_YEAR_LOOKUPS = 40;

/**
 * Pick between candidates the title can't separate. Several games share a
 * name — "Deadlock" is both a 1996 strategy game and Valve's 2024 shooter —
 * and the matcher scores them identically, so the first one IGDB happens to
 * return wins. Steam knows when the app was released; use that to choose.
 */
async function pickCandidate(
  match: MatchResult,
  appId: number,
  budget: { left: number },
): Promise<MatchCandidate | undefined> {
  const top = match.candidates[0];
  if (!top) return undefined;
  const topScore = similarity(match.query, top.title);
  const tied = match.candidates.filter(
    (c) => Math.abs(similarity(match.query, c.title) - topScore) < 0.05,
  );
  if (tied.length < 2 || budget.left <= 0) return top;

  budget.left--;
  const year = await getAppReleaseYear(appId);
  if (!year) return top;
  // an exact year wins; a year either side covers regional release drift
  return (
    tied.find((c) => c.releaseYear === year) ??
    tied.find((c) => c.releaseYear !== null && Math.abs(c.releaseYear - year) <= 1) ??
    top
  );
}

/**
 * Import the linked account's Steam library.
 * High-confidence matches land directly (with appid + playtime); the
 * stragglers become a normal import job so the review UI is the safety net.
 */
export async function processSteamImport(userId: string): Promise<void> {
  running.import.add(userId);
  try {
    const [account] = await db
      .select()
      .from(schema.steamAccounts)
      .where(eq(schema.steamAccounts.userId, userId));
    if (!account) return;

    const owned = (await getOwnedGames(account.steamId)).filter((g) => !isNoiseApp(g.name));

    // every imported game is a digital Steam copy — file it under the Steam
    // platform rather than the generic PC one, and add Steam to the user's
    // consoles so the platform shows up in their pickers
    const [steamPlatform] = await db
      .select({ id: schema.platforms.id })
      .from(schema.platforms)
      .where(eq(schema.platforms.name, "Steam"));
    if (steamPlatform) await rememberConsoles(userId, [steamPlatform.id]);

    // what's already linked by appid → just refresh playtime
    const appIds = owned.map((g) => g.appid);
    const linked = appIds.length
      ? await db
          .select({ id: schema.games.id, steamAppId: schema.games.steamAppId })
          .from(schema.games)
          .where(inArray(schema.games.steamAppId, appIds))
      : [];
    const gameByAppId = new Map(linked.map((g) => [g.steamAppId!, g.id]));

    // appids already sitting in one of my previous steam review jobs — don't re-queue
    const reviewed = await db
      .select({ steamAppId: schema.importItems.steamAppId })
      .from(schema.importItems)
      .innerJoin(schema.importJobs, eq(schema.importItems.jobId, schema.importJobs.id))
      .where(
        and(eq(schema.importJobs.userId, userId), isNotNull(schema.importItems.steamAppId)),
      );
    const reviewedAppIds = new Set(reviewed.map((r) => r.steamAppId!));

    // per-user overrides: apps to skip entirely, and apps pinned to a game
    const rules = await db
      .select()
      .from(schema.steamImportRules)
      .where(eq(schema.steamImportRules.userId, userId));
    const ruleByApp = new Map(rules.map((r) => [r.steamAppId, r]));

    const leftovers: Array<{ appid: number; name: string }> = [];
    const yearBudget = { left: MAX_YEAR_LOOKUPS };

    for (const steamGame of owned) {
      const rule = ruleByApp.get(steamGame.appid);
      // blocked apps never come back, however they were matched last time
      if (rule?.action === "block") continue;

      let gameId = rule?.action === "map" ? rule.gameId : null;
      if (gameId) {
        // a pinned app owns the appid link, so achievements sync to the game
        // you actually chose
        await db
          .update(schema.games)
          .set({ steamAppId: steamGame.appid })
          .where(and(eq(schema.games.id, gameId), isNull(schema.games.steamAppId)))
          .catch(() => {});
      }
      gameId ??= gameByAppId.get(steamGame.appid) ?? null;

      if (!gameId) {
        if (reviewedAppIds.has(steamGame.appid)) continue;

        // IGDB knows which game an appid belongs to. Ask it first: matching by
        // title can't tell two games with the same name apart, and picking the
        // wrong one is a mistake that repeats on every future import.
        const byAppId = await findIgdbGameBySteamAppId(steamGame.appid);
        let igdbId = byAppId;

        if (!igdbId) {
          const cleaned = cleanSteamName(steamGame.name);
          const match = await matchTitle(cleaned);
          const top = await pickCandidate(match, steamGame.appid, yearBudget);
          if (top?.igdbId && match.confidence >= AUTO_ADD_THRESHOLD) {
            igdbId = top.igdbId;
          } else {
            leftovers.push({ appid: steamGame.appid, name: cleaned });
            continue;
          }
        }

        gameId = await upsertGameFromIgdb(igdbId);
        // remember the appid ↔ game link for achievements sync (never steal
        // an existing link — unique constraint on steam_app_id)
        await db
          .update(schema.games)
          .set({ steamAppId: steamGame.appid })
          .where(and(eq(schema.games.id, gameId), isNull(schema.games.steamAppId)))
          .catch(() => {});
      }

      // upsert library entry + playtime
      const [existing] = await db
        .select({ id: schema.userGames.id })
        .from(schema.userGames)
        .where(and(eq(schema.userGames.userId, userId), eq(schema.userGames.gameId, gameId)));
      let userGameId: string;
      if (existing) {
        userGameId = existing.id;
        await db
          .update(schema.userGames)
          .set({ steamPlaytimeMinutes: steamGame.playtime_forever, updatedAt: new Date() })
          .where(eq(schema.userGames.id, existing.id));
      } else {
        const [inserted] = await db
          .insert(schema.userGames)
          .values({
            userId,
            gameId,
            status: "backlog",
            steamPlaytimeMinutes: steamGame.playtime_forever,
          })
          .returning({ id: schema.userGames.id });
        userGameId = inserted!.id;
      }

      if (steamPlatform) {
        await db
          .insert(schema.userGamePlatforms)
          .values({ userGameId, platformId: steamPlatform.id, format: "digital" })
          .onConflictDoNothing();
      }
    }

    if (leftovers.length > 0) {
      const [job] = await db
        .insert(schema.importJobs)
        .values({ userId, source: "steam" })
        .returning();
      await db.insert(schema.importItems).values(
        leftovers.map((g, i) => ({
          jobId: job!.id,
          position: i,
          rawText: g.name,
          cleanedTitle: g.name,
          steamAppId: g.appid,
        })),
      );
      // run the normal matcher over them so the review UI shows candidates
      for (const item of await db
        .select()
        .from(schema.importItems)
        .where(eq(schema.importItems.jobId, job!.id))) {
        const result = await matchTitle(item.cleanedTitle);
        await db
          .update(schema.importItems)
          .set({
            candidates: result.candidates,
            confidence: result.confidence,
            cleanedTitle: result.query,
            resolution: "pending",
          })
          .where(eq(schema.importItems.id, item.id));
      }
      await db
        .update(schema.importJobs)
        .set({ status: "review", updatedAt: new Date() })
        .where(eq(schema.importJobs.id, job!.id));
    }

    await db
      .update(schema.steamAccounts)
      .set({ lastImportAt: new Date() })
      .where(eq(schema.steamAccounts.userId, userId));
  } finally {
    running.import.delete(userId);
  }
}

/** Sync achievements + unlock state for library games linked to a Steam appid. */
export async function processSteamSync(userId: string): Promise<void> {
  running.sync.add(userId);
  try {
    const [account] = await db
      .select()
      .from(schema.steamAccounts)
      .where(eq(schema.steamAccounts.userId, userId));
    if (!account) return;

    const libraryGames = await db
      .select({ gameId: schema.games.id, steamAppId: schema.games.steamAppId })
      .from(schema.userGames)
      .innerJoin(schema.games, eq(schema.userGames.gameId, schema.games.id))
      .where(and(eq(schema.userGames.userId, userId), isNotNull(schema.games.steamAppId)));

    for (const { gameId, steamAppId } of libraryGames) {
      const defs = await getSchemaAchievements(steamAppId!);
      if (defs.length === 0) continue;

      for (const def of defs) {
        await db
          .insert(schema.achievements)
          .values({
            gameId,
            provider: "steam",
            externalId: def.name,
            name: def.displayName,
            description: def.description ?? null,
            iconUrl: def.icon,
            iconGrayUrl: def.icongray,
          })
          .onConflictDoUpdate({
            target: [
              schema.achievements.gameId,
              schema.achievements.provider,
              schema.achievements.externalId,
            ],
            set: {
              name: def.displayName,
              description: def.description ?? null,
              iconUrl: def.icon,
              iconGrayUrl: def.icongray,
            },
          });
      }

      const unlocks = await getPlayerAchievements(account.steamId, steamAppId!);
      if (!unlocks) continue;
      const unlockedByApiName = new Map(
        unlocks.filter((u) => u.achieved === 1).map((u) => [u.apiname, u.unlocktime]),
      );
      if (unlockedByApiName.size === 0) continue;

      const rows = await db
        .select({ id: schema.achievements.id, externalId: schema.achievements.externalId })
        .from(schema.achievements)
        .where(and(eq(schema.achievements.gameId, gameId), eq(schema.achievements.provider, "steam")));
      for (const row of rows) {
        const unlockTime = unlockedByApiName.get(row.externalId);
        if (unlockTime === undefined) continue;
        await db
          .insert(schema.userAchievements)
          .values({
            userId,
            achievementId: row.id,
            unlockedAt: unlockTime > 0 ? new Date(unlockTime * 1000) : null,
          })
          .onConflictDoNothing();
      }
    }

    await db
      .update(schema.steamAccounts)
      .set({ lastSyncAt: new Date() })
      .where(eq(schema.steamAccounts.userId, userId));
  } finally {
    running.sync.delete(userId);
  }
}

export async function startSteamWorkers(): Promise<void> {
  const boss = await getBoss();
  await boss.work<{ userId: string }>(
    STEAM_IMPORT_QUEUE,
    async (jobs: Array<{ data: { userId: string } }>) => {
      for (const job of jobs) await processSteamImport(job.data.userId);
    },
  );
  await boss.work<{ userId: string }>(
    STEAM_SYNC_QUEUE,
    async (jobs: Array<{ data: { userId: string } }>) => {
      for (const job of jobs) await processSteamSync(job.data.userId);
    },
  );
}
