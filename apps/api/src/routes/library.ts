import type { FastifyInstance, FastifyReply } from "fastify";
import { and, asc, eq, inArray, sql } from "drizzle-orm";
import { alias } from "drizzle-orm/pg-core";
import { z } from "zod";
import {
  OWNERSHIP_FORMATS,
  PROGRESS_BASES,
  estimateProgress,
  normalizeTtb,
  resolveTtb,
  ttbForBasis,
  type ResolvedTtb,
  type TtbTriple,
} from "@gm/shared";
import { db, schema } from "../db/index.js";
import { requireUser } from "../plugins/auth.js";
import { createManualGame, upsertGameFromIgdb } from "../services/catalog.js";
import { isValidCategory } from "../services/categories.js";
import {
  MIN_RATINGS,
  communityRatings,
  communityTimes,
  ownTimes,
  resolveTtbFor,
} from "../services/community.js";
import { rememberConsoles } from "../services/consoles.js";
import { defaultPlatformFor, defaultStatusFor } from "../services/preferences.js";
import { missionCountsByGame, type MissionCounts } from "../services/progress.js";
import { logEvent } from "../services/analytics.js";

/** A category key: a built-in, or the id of one of the user's custom ones. */
const categoryKey = z.string().min(1).max(64);

/** 400 unless the category is one this user may actually file games under. */
async function assertCategory(userId: string, key: string, reply: FastifyReply) {
  if (await isValidCategory(userId, key)) return true;
  reply.status(400).send({ message: "Unknown category" });
  return false;
}

const ownership = z.object({
  platformId: z.string().uuid(),
  format: z.enum(OWNERSHIP_FORMATS),
});

const addSchema = z
  .object({
    igdbId: z.number().int().positive().optional(),
    gameId: z.string().uuid().optional(),
    title: z.string().min(1).max(300).optional(),
    status: categoryKey.optional(),
    // omitted = fall back to the default-platform preference; [] = none
    platforms: z.array(ownership).max(50).optional(),
  })
  .refine((v) => v.igdbId || v.gameId || v.title, {
    message: "Provide igdbId, gameId, or title",
  });

const updateSchema = z.object({
  status: categoryKey.optional(),
  rating: z.number().min(0.5).max(5).multipleOf(0.5).nullable().optional(),
  notes: z.string().max(10_000).nullable().optional(),
  ttbEnabled: z.boolean().optional(),
  completed100: z.boolean().optional(),
  progressBasis: z.enum(PROGRESS_BASES).optional(),
});

const bulkUpdateSchema = z
  .object({
    ids: z.array(z.string().uuid()).min(1).max(500),
    status: categoryKey.optional(),
    ttbEnabled: z.boolean().optional(),
    completed100: z.boolean().optional(),
    platforms: z.array(ownership).max(50).optional(),
    platformMode: z.enum(["add", "replace", "remove"]).default("add"),
  })
  .refine(
    (v) =>
      v.status !== undefined ||
      v.ttbEnabled !== undefined ||
      v.completed100 !== undefined ||
      v.platforms !== undefined,
    { message: "Nothing to update" },
  );

const platformsSchema = z.object({
  platforms: z.array(ownership).max(50),
});

const bulkSchema = z.object({
  items: z
    .array(
      z.object({
        igdbId: z.number().int().positive().optional(),
        title: z.string().min(1).max(300).optional(),
        status: categoryKey.optional(),
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

/**
 * The catalog fields a client sees.
 *
 * Play times come from `resolveTtb` rather than straight off the row: the
 * catalog columns only hold IGDB's figures (and manual values written before
 * play times went per-user), so a game IGDB has never heard of falls back to
 * your own submission and then to the average of everyone's. Callers that
 * have a resolved triple pass it; the rest get the raw row, which
 * `resolveTtb` reports as-is.
 */
export function gameToJson(game: typeof schema.games.$inferSelect, ttb?: ResolvedTtb) {
  const times = ttb ?? resolveTtb(game, null, null);
  return {
    id: game.id,
    igdbId: game.igdbId,
    // set when a Steam import linked this game — the "wrong match?" fix needs it
    steamAppId: game.steamAppId,
    title: game.title,
    summary: game.summary,
    releaseDate: game.releaseDate,
    coverSrc: game.coverImageId ? `/api/images/${game.coverImageId}` : game.coverUrl,
    ttbMain: times.ttbMain,
    ttbMainExtra: times.ttbMainExtra,
    ttbCompletionist: times.ttbCompletionist,
    ttbSource: times.ttbSource,
    /** how many players the community figure averages, when that's the source */
    ttbCount: times.ttbCount ?? null,
  };
}

async function resolveGameId(input: z.infer<typeof addSchema>): Promise<string> {
  if (input.gameId) return input.gameId;
  if (input.igdbId) return upsertGameFromIgdb(input.igdbId);
  return createManualGame(input.title!);
}

async function entryPlatforms(userGameIds: string[]) {
  if (userGameIds.length === 0) return new Map<string, unknown[]>();
  const parentPlatform = alias(schema.platforms, "parent_platform");
  const rows = await db
    .select({
      userGameId: schema.userGamePlatforms.userGameId,
      platformId: schema.platforms.id,
      name: schema.platforms.name,
      abbreviation: schema.platforms.abbreviation,
      family: schema.platforms.family,
      // set when this is a storefront: the platform it's a store for
      parentPlatformId: schema.platforms.parentPlatformId,
      parentName: parentPlatform.name,
      format: schema.userGamePlatforms.format,
    })
    .from(schema.userGamePlatforms)
    .innerJoin(schema.platforms, eq(schema.userGamePlatforms.platformId, schema.platforms.id))
    .innerJoin(schema.userGames, eq(schema.userGamePlatforms.userGameId, schema.userGames.id))
    .leftJoin(parentPlatform, eq(schema.platforms.parentPlatformId, parentPlatform.id))
    .where(inArray(schema.userGamePlatforms.userGameId, userGameIds));
  const map = new Map<string, unknown[]>();
  for (const row of rows) {
    const { userGameId, ...rest } = row;
    if (!map.has(userGameId)) map.set(userGameId, []);
    map.get(userGameId)!.push(rest);
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
  missions?: MissionCounts,
  ttb?: ResolvedTtb,
) {
  const gameJson = gameToJson(game, ttb);
  // a user-uploaded cover overrides the catalog cover
  if (entry.customCoverImageId) {
    gameJson.coverSrc = `/api/images/${entry.customCoverImageId}`;
  }
  const estimate = estimateProgress({
    total: missions?.total ?? 0,
    done: missions?.done ?? 0,
    // the estimate divides whatever figure we're actually showing, so a
    // community-supplied length drives it exactly like an IGDB one
    totalSeconds: ttbForBasis(ttb ?? game, entry.progressBasis),
  });
  return {
    id: entry.id,
    status: entry.status,
    rating: entry.rating ? Number(entry.rating) : null,
    notes: entry.notes,
    ttbEnabled: entry.ttbEnabled,
    completed100: entry.completed100,
    progressBasis: entry.progressBasis,
    estimatedRemainingSeconds: estimate.remainingSeconds,
    missionsTotal: estimate.total,
    missionsDone: estimate.done,
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
    const missionMap = await missionCountsByGame(user.id);
    const ttbMap = await resolveTtbFor(
      user.id,
      rows.map((r) => r.games),
    );
    return rows.map((r) =>
      entryToJson(
        r.user_games,
        r.games,
        platformMap.get(r.user_games.id) ?? [],
        tagMap.get(r.user_games.id) ?? [],
        missionMap.get(r.games.id),
        ttbMap.get(r.games.id),
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
    // omitted status falls back to the user's configured default category
    const status = parsed.data.status ?? (await defaultStatusFor(user.id));
    if (!(await assertCategory(user.id, status, reply))) return;

    const gameId = await resolveGameId(parsed.data);
    const [created] = await db
      .insert(schema.userGames)
      .values({ userId: user.id, gameId, status })
      .onConflictDoNothing()
      .returning({ id: schema.userGames.id });
    if (!created) {
      return reply.status(409).send({ message: "Game is already in your library" });
    }

    // an explicit list wins; without one the default-platform preference
    // applies, so quick-adding a pile of games doesn't leave them platformless
    const ownership =
      parsed.data.platforms ??
      [await defaultPlatformFor(user.id)].filter((p) => p !== null);
    if (ownership.length > 0) {
      await db
        .insert(schema.userGamePlatforms)
        .values(
          ownership.map((p) => ({
            userGameId: created.id,
            platformId: p.platformId,
            format: p.format,
          })),
        )
        .onConflictDoNothing();
      await rememberConsoles(user.id, ownership.map((p) => p.platformId));
    }

    logEvent("game_added", user.id, { gameId });
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
    if (batchPlatforms.length > 0) {
      await rememberConsoles(user.id, batchPlatforms.map((p) => p.platformId));
    }
    if (added > 0) logEvent("game_added", user.id, { count: added, bulk: true });
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
    const missionMap = await missionCountsByGame(user.id);
    const ttbMap = await resolveTtbFor(user.id, [row.games]);
    return entryToJson(
      row.user_games,
      row.games,
      platformMap.get(row.user_games.id) ?? [],
      tagMap.get(row.user_games.id) ?? [],
      missionMap.get(row.games.id),
      ttbMap.get(row.games.id),
    );
  });

  /**
   * Time-remaining estimate: the user's mission checklist for this game,
   * with the chosen how-long-to-beat figure spread across its missions.
   */
  app.get<{ Params: { id: string } }>("/api/library/:id/progress", async (request, reply) => {
    const user = await requireUser(request, reply);
    if (!user) return;
    const [row] = await db
      .select()
      .from(schema.userGames)
      .innerJoin(schema.games, eq(schema.userGames.gameId, schema.games.id))
      .where(and(eq(schema.userGames.id, request.params.id), eq(schema.userGames.userId, user.id)));
    if (!row) return reply.status(404).send({ message: "Not found" });

    const basis = row.user_games.progressBasis;
    const ttbMap = await resolveTtbFor(user.id, [row.games]);
    const totalSeconds = ttbForBasis(ttbMap.get(row.games.id) ?? row.games, basis);

    // the user's own mission list for this game — oldest first, so adding a
    // second one doesn't silently move the estimate
    const [list] = await db
      .select({
        id: schema.checklistTemplates.id,
        title: schema.checklistTemplates.title,
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
          eq(schema.userChecklistItems.userId, user.id),
        ),
      )
      .where(
        and(
          eq(schema.checklistTemplates.gameId, row.games.id),
          eq(schema.checklistTemplates.authorUserId, user.id),
          eq(schema.checklistTemplates.kind, "missions"),
        ),
      )
      .groupBy(schema.checklistTemplates.id, schema.checklistTemplates.createdAt)
      .orderBy(asc(schema.checklistTemplates.createdAt))
      .limit(1);

    const estimate = estimateProgress({
      total: list?.total ?? 0,
      done: list?.done ?? 0,
      totalSeconds,
    });
    return {
      basis,
      checklistId: list?.id ?? null,
      checklistTitle: list?.title ?? null,
      ...estimate,
    };
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
    const { status, rating, notes, ttbEnabled, completed100, progressBasis } = parsed.data;
    if (status !== undefined) {
      if (!(await assertCategory(user.id, status, reply))) return;
      patch.status = status;
      // auto-stamp progress dates on first transition
      if (status === "playing" && !existing.startedAt) patch.startedAt = new Date();
      if (status === "finished" && !existing.finishedAt) patch.finishedAt = new Date();
    }
    if (rating !== undefined) patch.rating = rating === null ? null : String(rating);
    if (notes !== undefined) patch.notes = notes;
    if (ttbEnabled !== undefined) patch.ttbEnabled = ttbEnabled;
    if (completed100 !== undefined) patch.completed100 = completed100;
    if (progressBasis !== undefined) patch.progressBasis = progressBasis;

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
    const { ids, status, ttbEnabled, completed100, platforms, platformMode } = parsed.data;

    const patch: Partial<typeof schema.userGames.$inferInsert> = { updatedAt: new Date() };
    if (status !== undefined) {
      if (!(await assertCategory(user.id, status, reply))) return;
      patch.status = status;
    }
    if (ttbEnabled !== undefined) patch.ttbEnabled = ttbEnabled;
    if (completed100 !== undefined) patch.completed100 = completed100;

    const updated = await db
      .update(schema.userGames)
      .set(patch)
      .where(and(inArray(schema.userGames.id, ids), eq(schema.userGames.userId, user.id)))
      .returning({ id: schema.userGames.id, startedAt: schema.userGames.startedAt, finishedAt: schema.userGames.finishedAt });

    // platform ownership, scoped to the entries that were actually theirs
    if (platforms !== undefined) {
      const mine = updated.map((r) => r.id);
      if (mine.length > 0) {
        const targets = platforms.map((p) => p.platformId);
        if (platformMode === "replace") {
          await db
            .delete(schema.userGamePlatforms)
            .where(inArray(schema.userGamePlatforms.userGameId, mine));
        } else if (platformMode === "remove" && targets.length > 0) {
          // removing ignores format — "not on this console" covers both
          await db
            .delete(schema.userGamePlatforms)
            .where(
              and(
                inArray(schema.userGamePlatforms.userGameId, mine),
                inArray(schema.userGamePlatforms.platformId, targets),
              ),
            );
        }
        if (platformMode !== "remove" && platforms.length > 0) {
          await db
            .insert(schema.userGamePlatforms)
            .values(
              mine.flatMap((userGameId) =>
                platforms.map((p) => ({
                  userGameId,
                  platformId: p.platformId,
                  format: p.format,
                })),
              ),
            )
            .onConflictDoNothing();
          await rememberConsoles(user.id, targets);
        }
      }
    }

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
      // filing a game under a console adds it to your consoles list
      await rememberConsoles(user.id, parsed.data.platforms.map((p) => p.platformId));
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

  /**
   * Record how long this game took *you*, for when IGDB has nothing.
   *
   * This used to write the shared catalog row, on the reasoning that a game's
   * length is a fact about the game rather than about you. It is — but the
   * app is public now, so "shared row, last writer wins" meant one person's
   * typo silently became everyone's number, and there was nothing left to
   * average. Submissions are per-user; `resolveTtb` picks what to show, and
   * `communityTimes` averages the rest.
   *
   * Values are seconds. Sending null clears one, and clearing them all
   * removes your submission entirely. `normalizeTtb` enforces
   * main <= main+extras <= completionist, the same as on ingest, so a typo
   * can't invert the columns.
   */
  app.put<{ Params: { id: string } }>("/api/library/:id/time-to-beat", async (request, reply) => {
    const user = await requireUser(request, reply);
    if (!user) return;

    const entry = await db.query.userGames.findFirst({
      where: (ug, { and: andW, eq: eqW }) =>
        andW(eqW(ug.id, request.params.id), eqW(ug.userId, user.id)),
      columns: { gameId: true },
    });
    if (!entry) return reply.status(404).send({ message: "Not found" });

    // a day is already a stretch for a single figure; the cap is there to
    // catch a stray "3600" typed into a field that wanted hours
    const seconds = z.number().int().min(0).max(60 * 60 * 1000).nullable();
    const parsed = z
      .object({
        ttbMain: seconds.optional(),
        ttbMainExtra: seconds.optional(),
        ttbCompletionist: seconds.optional(),
      })
      .safeParse(request.body);
    if (!parsed.success) return reply.status(400).send({ message: "Invalid times" });

    const [mine] = await db
      .select()
      .from(schema.userTimeToBeat)
      .where(
        and(
          eq(schema.userTimeToBeat.userId, user.id),
          eq(schema.userTimeToBeat.gameId, entry.gameId),
        ),
      );

    // an omitted key keeps what you had; an explicit null clears it
    const merged = normalizeTtb({
      ttbMain: parsed.data.ttbMain === undefined ? (mine?.mainSeconds ?? null) : parsed.data.ttbMain,
      ttbMainExtra:
        parsed.data.ttbMainExtra === undefined
          ? (mine?.mainExtraSeconds ?? null)
          : parsed.data.ttbMainExtra,
      ttbCompletionist:
        parsed.data.ttbCompletionist === undefined
          ? (mine?.completionistSeconds ?? null)
          : parsed.data.ttbCompletionist,
    });

    const hasAny =
      merged.ttbMain != null || merged.ttbMainExtra != null || merged.ttbCompletionist != null;

    if (!hasAny) {
      await db
        .delete(schema.userTimeToBeat)
        .where(
          and(
            eq(schema.userTimeToBeat.userId, user.id),
            eq(schema.userTimeToBeat.gameId, entry.gameId),
          ),
        );
      // The one way back for a catalog row a previous version let someone
      // pin by hand: nothing else writes `games.ttb_*` any more, so clearing
      // your submission also clears a stale manual override rather than
      // leaving it uncorrectable forever. IGDB's own figures are left alone.
      await db
        .update(schema.games)
        .set({ ttbMain: null, ttbMainExtra: null, ttbCompletionist: null, ttbSource: null })
        .where(and(eq(schema.games.id, entry.gameId), eq(schema.games.ttbSource, "manual")));
      return { ok: true, ...merged };
    }

    await db
      .insert(schema.userTimeToBeat)
      .values({
        userId: user.id,
        gameId: entry.gameId,
        mainSeconds: merged.ttbMain,
        mainExtraSeconds: merged.ttbMainExtra,
        completionistSeconds: merged.ttbCompletionist,
      })
      .onConflictDoUpdate({
        target: [schema.userTimeToBeat.userId, schema.userTimeToBeat.gameId],
        set: {
          mainSeconds: merged.ttbMain,
          mainExtraSeconds: merged.ttbMainExtra,
          completionistSeconds: merged.ttbCompletionist,
          updatedAt: new Date(),
        },
      });
    logEvent("time_submitted", user.id, { gameId: entry.gameId });
    return { ok: true, ...merged };
  });

  /**
   * What everyone else thinks of a game: average score, and the average play
   * time when players have supplied one.
   *
   * Its own request rather than a field on the library list. This is one
   * query pair per game detail page, where `GET /api/library` is the app's
   * hottest route and doesn't need the weight.
   */
  app.get<{ Params: { gameId: string } }>(
    "/api/games/:gameId/community",
    async (request, reply) => {
      const user = await requireUser(request, reply);
      if (!user) return;
      const gameId = request.params.gameId;

      const [ratings, times, own] = await Promise.all([
        communityRatings([gameId]),
        communityTimes([gameId]),
        ownTimes(user.id, [gameId]),
      ]);
      return {
        rating: ratings.get(gameId) ?? null,
        timeToBeat: times.get(gameId) ?? null,
        yours: own.get(gameId) ?? null,
        minRatings: MIN_RATINGS,
      };
    },
  );
}
