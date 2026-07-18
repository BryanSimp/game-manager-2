import type { FastifyInstance } from "fastify";
import { and, asc, eq } from "drizzle-orm";
import { z } from "zod";
import { db, schema } from "../db/index.js";
import { requireUser } from "../plugins/auth.js";
import { getPersonaName, resolveVanityUrl, steamConfigured } from "../services/steam.js";
import { enqueueSteamImport, enqueueSteamSync } from "../services/queue.js";
import { steamJobRunning } from "../jobs/steam.js";

const linkSchema = z.object({ steamId: z.string().min(2).max(100) });

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
