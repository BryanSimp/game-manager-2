import type { FastifyInstance } from "fastify";
import { and, asc, eq, isNull, ne } from "drizzle-orm";
import { z } from "zod";
import { db, schema } from "../db/index.js";
import { requireUser } from "../plugins/auth.js";
import { getPersonaName, resolveVanityUrl, steamConfigured } from "../services/steam.js";
import { upsertGameFromIgdb } from "../services/catalog.js";
import { enqueueSteamImport, enqueueSteamSync } from "../services/queue.js";
import { steamJobRunning } from "../jobs/steam.js";
import { logEvent } from "../services/analytics.js";

const linkSchema = z.object({ steamId: z.string().min(2).max(100) });

const ruleSchema = z
  .object({
    steamAppId: z.number().int().positive(),
    action: z.enum(["block", "map"]),
    /** for 'map': the game to pin the app to, by catalog id or IGDB id */
    gameId: z.string().uuid().optional(),
    igdbId: z.number().int().positive().optional(),
    appName: z.string().max(300).optional(),
    /** the mis-matched library entry this rule is fixing, to be replaced */
    replaceEntryId: z.string().uuid().optional(),
  })
  .refine((v) => v.action === "block" || v.gameId || v.igdbId, {
    message: "Pinning needs a game to pin the app to",
  });

export function registerSteamRoutes(app: FastifyInstance): void {
  app.get("/api/steam", async (request, reply) => {
    const user = await requireUser(request, reply);
    if (!user) return;
    const [account] = await db
      .select()
      .from(schema.steamAccounts)
      .where(eq(schema.steamAccounts.userId, user.id));
    return {
      configured: await steamConfigured(),
      linked: !!account,
      steamId: account?.steamId ?? null,
      personaName: account?.personaName ?? null,
      lastImportAt: account?.lastImportAt ?? null,
      lastSyncAt: account?.lastSyncAt ?? null,
      importing: steamJobRunning("import", user.id),
      syncing: steamJobRunning("sync", user.id),
    };
  });

  // Link (or relink) a Steam account: accepts a SteamID64 or a vanity name
  app.put("/api/steam", async (request, reply) => {
    const user = await requireUser(request, reply);
    if (!user) return;
    if (!(await steamConfigured())) {
      return reply
        .status(400)
        .send({ message: "Steam API key is not configured — add it in admin Settings" });
    }
    const parsed = linkSchema.safeParse(request.body);
    if (!parsed.success) return reply.status(400).send({ message: "Enter a SteamID or vanity name" });

    let input = parsed.data.steamId.trim();
    // accept full profile URLs too
    const urlMatch = input.match(/steamcommunity\.com\/(?:profiles|id)\/([^/?#]+)/i);
    if (urlMatch) input = urlMatch[1]!;

    let steamId: string;
    if (/^\d{17}$/.test(input)) {
      steamId = input;
    } else {
      const resolved = await resolveVanityUrl(input);
      if (!resolved) {
        return reply.status(400).send({ message: `No Steam account found for "${input}"` });
      }
      steamId = resolved;
    }

    const personaName = await getPersonaName(steamId).catch(() => null);
    await db
      .insert(schema.steamAccounts)
      .values({ userId: user.id, steamId, personaName })
      .onConflictDoUpdate({
        target: schema.steamAccounts.userId,
        set: { steamId, personaName },
      });
    logEvent("steam_link", user.id);
    return { ok: true, steamId, personaName };
  });

  app.delete("/api/steam", async (request, reply) => {
    const user = await requireUser(request, reply);
    if (!user) return;
    await db.delete(schema.steamAccounts).where(eq(schema.steamAccounts.userId, user.id));
    return { ok: true };
  });

  app.post("/api/steam/import", async (request, reply) => {
    const user = await requireUser(request, reply);
    if (!user) return;
    const [account] = await db
      .select({ userId: schema.steamAccounts.userId })
      .from(schema.steamAccounts)
      .where(eq(schema.steamAccounts.userId, user.id));
    if (!account) return reply.status(400).send({ message: "Link a Steam account first" });
    await enqueueSteamImport(user.id);
    reply.status(202);
    return { queued: true };
  });

  app.post("/api/steam/sync", async (request, reply) => {
    const user = await requireUser(request, reply);
    if (!user) return;
    const [account] = await db
      .select({ userId: schema.steamAccounts.userId })
      .from(schema.steamAccounts)
      .where(eq(schema.steamAccounts.userId, user.id));
    if (!account) return reply.status(400).send({ message: "Link a Steam account first" });
    await enqueueSteamSync(user.id);
    reply.status(202);
    return { queued: true };
  });

  /**
   * Import rules: the apps you've told the importer to skip, or pinned to a
   * particular game. Matching by name can't tell two games called "Deadlock"
   * apart, so these are the manual last word.
   */
  app.get("/api/steam/rules", async (request, reply) => {
    const user = await requireUser(request, reply);
    if (!user) return;
    const rows = await db
      .select({
        steamAppId: schema.steamImportRules.steamAppId,
        action: schema.steamImportRules.action,
        appName: schema.steamImportRules.appName,
        gameId: schema.steamImportRules.gameId,
        gameTitle: schema.games.title,
        createdAt: schema.steamImportRules.createdAt,
      })
      .from(schema.steamImportRules)
      .leftJoin(schema.games, eq(schema.steamImportRules.gameId, schema.games.id))
      .where(eq(schema.steamImportRules.userId, user.id))
      .orderBy(asc(schema.steamImportRules.createdAt));
    return rows;
  });

  /**
   * Block an app, or pin it to a game. Pinning also takes over the appid link
   * — achievements should sync to the game you said it was, not the one the
   * matcher guessed — and optionally drops the wrong entry it created.
   */
  app.post("/api/steam/rules", async (request, reply) => {
    const user = await requireUser(request, reply);
    if (!user) return;
    const parsed = ruleSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.status(400).send({ message: parsed.error.issues[0]?.message });
    }
    const { steamAppId, action, igdbId, appName, replaceEntryId } = parsed.data;

    let gameId: string | null = parsed.data.gameId ?? null;
    if (action === "map") {
      if (!gameId && igdbId) gameId = await upsertGameFromIgdb(igdbId);
      if (!gameId) {
        return reply.status(400).send({ message: "Pinning needs a game to pin the app to" });
      }
    }

    await db
      .insert(schema.steamImportRules)
      .values({ userId: user.id, steamAppId, action, gameId, appName })
      .onConflictDoUpdate({
        target: [schema.steamImportRules.userId, schema.steamImportRules.steamAppId],
        set: { gameId, action, appName },
      });

    if (action === "map" && gameId) {
      // the appid belongs to the right game now; free it from the wrong one
      await db
        .update(schema.games)
        .set({ steamAppId: null })
        .where(and(eq(schema.games.steamAppId, steamAppId), ne(schema.games.id, gameId)));
      await db
        .update(schema.games)
        .set({ steamAppId })
        .where(and(eq(schema.games.id, gameId), isNull(schema.games.steamAppId)));
    }

    // swap the mis-matched entry for the right game, keeping your playtime
    let replaced: string | null = null;
    if (replaceEntryId) {
      const [wrong] = await db
        .select()
        .from(schema.userGames)
        .where(and(eq(schema.userGames.id, replaceEntryId), eq(schema.userGames.userId, user.id)));
      if (wrong) {
        if (gameId && wrong.gameId !== gameId) {
          const [created] = await db
            .insert(schema.userGames)
            .values({
              userId: user.id,
              gameId,
              status: wrong.status,
              rating: wrong.rating,
              notes: wrong.notes,
              steamPlaytimeMinutes: wrong.steamPlaytimeMinutes,
            })
            .onConflictDoNothing()
            .returning({ id: schema.userGames.id });
          replaced = created?.id ?? null;
        }
        await db.delete(schema.userGames).where(eq(schema.userGames.id, wrong.id));
      }
    }

    reply.status(201);
    return { ok: true, gameId, replacedWithEntryId: replaced };
  });

  app.delete<{ Params: { steamAppId: string } }>(
    "/api/steam/rules/:steamAppId",
    async (request, reply) => {
      const user = await requireUser(request, reply);
      if (!user) return;
      const appId = Number(request.params.steamAppId);
      if (!Number.isInteger(appId)) return reply.status(400).send({ message: "Bad app id" });
      const deleted = await db
        .delete(schema.steamImportRules)
        .where(
          and(
            eq(schema.steamImportRules.userId, user.id),
            eq(schema.steamImportRules.steamAppId, appId),
          ),
        )
        .returning({ steamAppId: schema.steamImportRules.steamAppId });
      if (deleted.length === 0) return reply.status(404).send({ message: "No such rule" });
      return { ok: true };
    },
  );

  // Achievements for a library entry (definitions + my unlock state)
  app.get<{ Params: { id: string } }>(
    "/api/library/:id/achievements",
    async (request, reply) => {
      const user = await requireUser(request, reply);
      if (!user) return;
      const [entry] = await db
        .select({
          gameId: schema.userGames.gameId,
          steamPlaytimeMinutes: schema.userGames.steamPlaytimeMinutes,
        })
        .from(schema.userGames)
        .where(and(eq(schema.userGames.id, request.params.id), eq(schema.userGames.userId, user.id)));
      if (!entry) return reply.status(404).send({ message: "Entry not found" });

      const rows = await db
        .select({
          id: schema.achievements.id,
          name: schema.achievements.name,
          description: schema.achievements.description,
          iconUrl: schema.achievements.iconUrl,
          iconGrayUrl: schema.achievements.iconGrayUrl,
          unlockedAt: schema.userAchievements.unlockedAt,
          userId: schema.userAchievements.userId,
        })
        .from(schema.achievements)
        .leftJoin(
          schema.userAchievements,
          and(
            eq(schema.userAchievements.achievementId, schema.achievements.id),
            eq(schema.userAchievements.userId, user.id),
          ),
        )
        .where(eq(schema.achievements.gameId, entry.gameId))
        .orderBy(asc(schema.achievements.name));

      const achievements = rows.map((r) => ({
        id: r.id,
        name: r.name,
        description: r.description,
        iconUrl: r.iconUrl,
        iconGrayUrl: r.iconGrayUrl,
        unlockedAt: r.unlockedAt,
        unlocked: r.userId !== null,
      }));
      return {
        total: achievements.length,
        unlocked: achievements.filter((a) => a.unlocked).length,
        achievements,
        steamPlaytimeMinutes: entry.steamPlaytimeMinutes,
      };
    },
  );
}
