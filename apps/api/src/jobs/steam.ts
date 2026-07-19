import { and, eq, inArray, isNotNull, isNull } from "drizzle-orm";
import { db, schema } from "../db/index.js";
import { matchTitle } from "../services/matcher.js";
import { upsertGameFromIgdb } from "../services/catalog.js";
import {
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

    // every Steam game is a digital PC copy — mark ownership automatically
    const [pcPlatform] = await db
      .select({ id: schema.platforms.id })
      .from(schema.platforms)
      .where(eq(schema.platforms.igdbPlatformId, 6));

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

    const leftovers: Array<{ appid: number; name: string }> = [];

    for (const steamGame of owned) {
      let gameId = gameByAppId.get(steamGame.appid) ?? null;

      if (!gameId) {
        if (reviewedAppIds.has(steamGame.appid)) continue;
        const cleaned = cleanSteamName(steamGame.name);
        const match = await matchTitle(cleaned);
        const top = match.candidates[0];
        if (top?.igdbId && match.confidence >= AUTO_ADD_THRESHOLD) {
          gameId = await upsertGameFromIgdb(top.igdbId);
          // remember the appid ↔ game link for achievements sync (never steal
          // an existing link — unique constraint on steam_app_id)
          await db
            .update(schema.games)
            .set({ steamAppId: steamGame.appid })
            .where(and(eq(schema.games.id, gameId), isNull(schema.games.steamAppId)))
            .catch(() => {});
        } else {
          leftovers.push({ appid: steamGame.appid, name: cleaned });
          continue;
        }
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

      if (pcPlatform) {
        await db
          .insert(schema.userGamePlatforms)
          .values({ userGameId, platformId: pcPlatform.id, format: "digital" })
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
