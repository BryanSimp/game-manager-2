import type { FastifyInstance } from "fastify";
import { and, asc, eq, inArray } from "drizzle-orm";
import { alias } from "drizzle-orm/pg-core";
import { z } from "zod";
import { GAME_STATUSES, OWNERSHIP_FORMATS } from "@gm/shared";
import { db, schema } from "../db/index.js";
import { requireUser } from "../plugins/auth.js";
import { createManualGame, upsertGameFromIgdb } from "../services/catalog.js";

const boxArtImage = alias(schema.images, "box_art_image");

const addSchema = z
  .object({
    igdbId: z.number().int().positive().optional(),
    gameId: z.string().uuid().optional(),
    title: z.string().min(1).max(300).optional(),
    status: z.enum(GAME_STATUSES).default("backlog"),
  })
  .refine((v) => v.igdbId || v.gameId || v.title, {
    message: "Provide igdbId, gameId, or title",
  });

const updateSchema = z.object({
  status: z.enum(GAME_STATUSES).optional(),
  rating: z.number().min(0.5).max(5).multipleOf(0.5).nullable().optional(),
  notes: z.string().max(10_000).nullable().optional(),
  ttbEnabled: z.boolean().optional(),
  completed100: z.boolean().optional(),
});

const bulkUpdateSchema = z
  .object({
    ids: z.array(z.string().uuid()).min(1).max(500),
    status: z.enum(GAME_STATUSES).optional(),
    ttbEnabled: z.boolean().optional(),
    completed100: z.boolean().optional(),
  })
  .refine((v) => v.status !== undefined || v.ttbEnabled !== undefined || v.completed100 !== undefined, {
    message: "Nothing to update",
  });

const platformsSchema = z.object({
  platforms: z
    .array(
      z.object({
        platformId: z.string().uuid(),
        format: z.enum(OWNERSHIP_FORMATS),
      }),
    )
    .max(50),
});

const bulkSchema = z.object({
  items: z
    .array(
      z.object({
        igdbId: z.number().int().positive().optional(),
        title: z.string().min(1).max(300).optional(),
        status: z.enum(GAME_STATUSES).default("backlog"),
      }),
    )
    .min(1)
    .max(200),
  // ownership applied to every imported game ("this whole list is my Switch library")
  platforms: z
    .array(
      z.object({
        platformId: z.string().uuid(),
        format: z.enum(OWNERSHIP_FORMATS),
      }),
    )
    .max(5)
    .optional(),
});

function gameToJson(game: typeof schema.games.$inferSelect) {
  return {
    id: game.id,
    igdbId: game.igdbId,
    title: game.title,
    summary: game.summary,
    releaseDate: game.releaseDate,
    coverSrc: game.coverImageId ? `/api/images/${game.coverImageId}` : game.coverUrl,
    ttbMain: game.ttbMain,
    ttbMainExtra: game.ttbMainExtra,
    ttbCompletionist: game.ttbCompletionist,
    ttbSource: game.ttbSource,
  };
}

async function resolveGameId(input: z.infer<typeof addSchema>): Promise<string> {
  if (input.gameId) return input.gameId;
  if (input.igdbId) return upsertGameFromIgdb(input.igdbId);
  return createManualGame(input.title!);
}

async function entryPlatforms(userGameIds: string[]) {
  if (userGameIds.length === 0) return new Map<string, unknown[]>();
  const rows = await db
    .select({
      userGameId: schema.userGamePlatforms.userGameId,
      platformId: schema.platforms.id,
      name: schema.platforms.name,
      abbreviation: schema.platforms.abbreviation,
      family: schema.platforms.family,
      format: schema.userGamePlatforms.format,
      boxArtImageId: schema.gameBoxArt.imageId,
      boxArtW: boxArtImage.width,
      boxArtH: boxArtImage.height,
    })
    .from(schema.userGamePlatforms)
    .innerJoin(schema.platforms, eq(schema.userGamePlatforms.platformId, schema.platforms.id))
    .innerJoin(schema.userGames, eq(schema.userGamePlatforms.userGameId, schema.userGames.id))
    .leftJoin(
      schema.gameBoxArt,
      and(
        eq(schema.gameBoxArt.gameId, schema.userGames.gameId),
        eq(schema.gameBoxArt.platformId, schema.platforms.id),
      ),
    )
    .leftJoin(boxArtImage, eq(schema.gameBoxArt.imageId, boxArtImage.id))
    .where(inArray(schema.userGamePlatforms.userGameId, userGameIds));
  const map = new Map<string, unknown[]>();
  for (const row of rows) {
    const { userGameId, boxArtImageId, boxArtW, boxArtH, ...rest } = row;
    if (!map.has(userGameId)) map.set(userGameId, []);
    map.get(userGameId)!.push({
      ...rest,
      boxArtSrc: boxArtImageId ? `/api/images/${boxArtImageId}` : null,
      boxArtW,
      boxArtH,
    });
  }
  return map;
}

async function entryTags(userGameIds: string[]) {
  if (userGameIds.length === 0) return new Map<string, unknown[]>();
  const rows = await db
    .select({
      userGameId: schema.userGameTags.userGameId,
      id: schema.tags.id,
      name: schema.tags.name,
      color: schema.tags.color,
      groupName: schema.tags.groupName,
    })
    .from(schema.userGameTags)
    .innerJoin(schema.tags, eq(schema.userGameTags.tagId, schema.tags.id))
    .where(inArray(schema.userGameTags.userGameId, userGameIds));
  const map = new Map<string, unknown[]>();
  for (const row of rows) {
    const { userGameId, ...rest } = row;
    if (!map.has(userGameId)) map.set(userGameId, []);
    map.get(userGameId)!.push(rest);
  }
  return map;
}

function entryToJson(
  entry: typeof schema.userGames.$inferSelect,
  game: typeof schema.games.$inferSelect,
  platforms: unknown[],
  tags: unknown[] = [],
) {
  const gameJson = gameToJson(game);
  // a user-uploaded cover overrides the catalog cover
  if (entry.customCoverImageId) {
    gameJson.coverSrc = `/api/images/${entry.customCoverImageId}`;
  }
  return {
    id: entry.id,
    status: entry.status,
    rating: entry.rating ? Number(entry.rating) : null,
    notes: entry.notes,
    ttbEnabled: entry.ttbEnabled,
    completed100: entry.completed100,
    startedAt: entry.startedAt,
    finishedAt: entry.finishedAt,
    createdAt: entry.createdAt,
    hasCustomCover: entry.customCoverImageId !== null,
    game: gameJson,
    platforms,
    tags,
  };
}

export function registerLibraryRoutes(app: FastifyInstance): void {
  app.get("/api/library", async (request, reply) => {
    const user = await requireUser(request, reply);
    if (!user) return;
    const rows = await db
      .select()
      .from(schema.userGames)
      .innerJoin(schema.games, eq(schema.userGames.gameId, schema.games.id))
      .where(eq(schema.userGames.userId, user.id))
      .orderBy(asc(schema.games.title));
    const ids = rows.map((r) => r.user_games.id);
    const platformMap = await entryPlatforms(ids);
    const tagMap = await entryTags(ids);
    return rows.map((r) =>
      entryToJson(
        r.user_games,
        r.games,
        platformMap.get(r.user_games.id) ?? [],
        tagMap.get(r.user_games.id) ?? [],
      ),
    );
  });

  app.post("/api/library", async (request, reply) => {
    const user = await requireUser(request, reply);
    if (!user) return;
    const parsed = addSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.status(400).send({ message: parsed.error.issues[0]?.message });
    }
    const gameId = await resolveGameId(parsed.data);
    const [created] = await db
      .insert(schema.userGames)
      .values({ userId: user.id, gameId, status: parsed.data.status })
      .onConflictDoNothing()
      .returning({ id: schema.userGames.id });
    if (!created) {
      return reply.status(409).send({ message: "Game is already in your library" });
    }
    reply.status(201);
    return { id: created.id, gameId };
  });

  app.post("/api/library/bulk", async (request, reply) => {
    const user = await requireUser(request, reply);
    if (!user) return;
    const parsed = bulkSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.status(400).send({ message: parsed.error.issues[0]?.message });
    }
    let added = 0;
    let skipped = 0;
    const errors: string[] = [];
    const batchPlatforms = parsed.data.platforms ?? [];
    for (const item of parsed.data.items) {
      try {
        const gameId = item.igdbId
          ? await upsertGameFromIgdb(item.igdbId)
          : await createManualGame(item.title ?? "Untitled");
        const [created] = await db
          .insert(schema.userGames)
          .values({ userId: user.id, gameId, status: item.status })
          .onConflictDoNothing()
          .returning({ id: schema.userGames.id });
        if (created) added++;
        else skipped++;

        if (batchPlatforms.length > 0) {
          // apply ownership to new AND already-owned entries — re-importing a
          // console's library should still tag existing games with it
          let userGameId = created?.id;
          if (!userGameId) {
            const [existing] = await db
              .select({ id: schema.userGames.id })
              .from(schema.userGames)
              .where(and(eq(schema.userGames.userId, user.id), eq(schema.userGames.gameId, gameId)));
            userGameId = existing?.id;
          }
          if (userGameId) {
            await db
              .insert(schema.userGamePlatforms)
              .values(
                batchPlatforms.map((p) => ({
                  userGameId: userGameId!,
                  platformId: p.platformId,
                  format: p.format,
                })),
              )
              .onConflictDoNothing();
          }
        }
      } catch (err) {
        errors.push(
          `${item.title ?? `igdb:${item.igdbId}`}: ${err instanceof Error ? err.message : "failed"}`,
        );
      }
    }
    return { added, skipped, errors };
  });

  app.get<{ Params: { id: string } }>("/api/library/:id", async (request, reply) => {
    const user = await requireUser(request, reply);
    if (!user) return;
    const [row] = await db
      .select()
      .from(schema.userGames)
      .innerJoin(schema.games, eq(schema.userGames.gameId, schema.games.id))
      .where(and(eq(schema.userGames.id, request.params.id), eq(schema.userGames.userId, user.id)));
    if (!row) return reply.status(404).send({ message: "Not found" });
    const platformMap = await entryPlatforms([row.user_games.id]);
    const tagMap = await entryTags([row.user_games.id]);
    return entryToJson(
      row.user_games,
      row.games,
      platformMap.get(row.user_games.id) ?? [],
      tagMap.get(row.user_games.id) ?? [],
    );
  });

  app.patch<{ Params: { id: string } }>("/api/library/:id", async (request, reply) => {
    const user = await requireUser(request, reply);
    if (!user) return;
    const parsed = updateSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.status(400).send({ message: parsed.error.issues[0]?.message });
    }
    const [existing] = await db
      .select()
      .from(schema.userGames)
      .where(and(eq(schema.userGames.id, request.params.id), eq(schema.userGames.userId, user.id)));
    if (!existing) return reply.status(404).send({ message: "Not found" });

    const patch: Partial<typeof schema.userGames.$inferInsert> = { updatedAt: new Date() };
    const { status, rating, notes, ttbEnabled, completed100 } = parsed.data;
    if (status !== undefined) {
      patch.status = status;
      // auto-stamp progress dates on first transition
      if (status === "playing" && !existing.startedAt) patch.startedAt = new Date();
      if (status === "finished" && !existing.finishedAt) patch.finishedAt = new Date();
    }
    if (rating !== undefined) patch.rating = rating === null ? null : String(rating);
    if (notes !== undefined) patch.notes = notes;
    if (ttbEnabled !== undefined) patch.ttbEnabled = ttbEnabled;
    if (completed100 !== undefined) patch.completed100 = completed100;

    await db.update(schema.userGames).set(patch).where(eq(schema.userGames.id, existing.id));
    return { ok: true };
  });

  // Bulk edit: same fields as PATCH minus notes/rating, across many entries
  app.post("/api/library/bulk-update", async (request, reply) => {
    const user = await requireUser(request, reply);
    if (!user) return;
    const parsed = bulkUpdateSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.status(400).send({ message: parsed.error.issues[0]?.message });
    }
    const { ids, status, ttbEnabled, completed100 } = parsed.data;

    const patch: Partial<typeof schema.userGames.$inferInsert> = { updatedAt: new Date() };
    if (status !== undefined) patch.status = status;
    if (ttbEnabled !== undefined) patch.ttbEnabled = ttbEnabled;
    if (completed100 !== undefined) patch.completed100 = completed100;

    const updated = await db
      .update(schema.userGames)
      .set(patch)
      .where(and(inArray(schema.userGames.id, ids), eq(schema.userGames.userId, user.id)))
      .returning({ id: schema.userGames.id, startedAt: schema.userGames.startedAt, finishedAt: schema.userGames.finishedAt });

    // auto-stamp progress dates on first transition, matching single PATCH
    if (status === "playing" || status === "finished") {
      const column = status === "playing" ? "startedAt" : "finishedAt";
      const missing = updated.filter((r) => r[column] === null).map((r) => r.id);
      if (missing.length > 0) {
        await db
          .update(schema.userGames)
          .set(status === "playing" ? { startedAt: new Date() } : { finishedAt: new Date() })
          .where(inArray(schema.userGames.id, missing));
      }
    }
    return { updated: updated.length };
  });

  app.put<{ Params: { id: string } }>("/api/library/:id/platforms", async (request, reply) => {
    const user = await requireUser(request, reply);
    if (!user) return;
    const parsed = platformsSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.status(400).send({ message: parsed.error.issues[0]?.message });
    }
    const [existing] = await db
      .select({ id: schema.userGames.id })
      .from(schema.userGames)
      .where(and(eq(schema.userGames.id, request.params.id), eq(schema.userGames.userId, user.id)));
    if (!existing) return reply.status(404).send({ message: "Not found" });

    await db
      .delete(schema.userGamePlatforms)
      .where(eq(schema.userGamePlatforms.userGameId, existing.id));
    if (parsed.data.platforms.length > 0) {
      await db
        .insert(schema.userGamePlatforms)
        .values(
          parsed.data.platforms.map((p) => ({
            userGameId: existing.id,
            platformId: p.platformId,
            format: p.format,
          })),
        )
        .onConflictDoNothing();
    }
    return { ok: true };
  });

  app.delete<{ Params: { id: string } }>("/api/library/:id", async (request, reply) => {
    const user = await requireUser(request, reply);
    if (!user) return;
    const deleted = await db
      .delete(schema.userGames)
      .where(and(eq(schema.userGames.id, request.params.id), eq(schema.userGames.userId, user.id)))
      .returning({ id: schema.userGames.id });
    if (deleted.length === 0) return reply.status(404).send({ message: "Not found" });
    return { ok: true };
  });
}
