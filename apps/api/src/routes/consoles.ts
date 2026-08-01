import type { FastifyInstance } from "fastify";
import { and, asc, desc, eq, inArray } from "drizzle-orm";
import { alias } from "drizzle-orm/pg-core";
import { z } from "zod";
import { db, schema } from "../db/index.js";
import { requireUser } from "../plugins/auth.js";
import { backfillPlatformMeta, rememberConsoles } from "../services/consoles.js";
import { saveUploadedImage } from "../services/images.js";

const addSchema = z.object({ platformId: z.string().uuid() });

const parentPlatform = alias(schema.platforms, "parent_platform");

const ALLOWED_IMAGE_MIMES = new Set(["image/jpeg", "image/png", "image/webp"]);

/** How many covers each console card previews. */
const PREVIEW_LIMIT = 8;

export function registerConsoleRoutes(app: FastifyInstance): void {
  /** The consoles you own, each with a slice of your library on it. */
  app.get("/api/consoles", async (request, reply) => {
    const user = await requireUser(request, reply);
    if (!user) return;

    const consoles = await db
      .select({
        addedAt: schema.userConsoles.addedAt,
        customImageId: schema.userConsoles.customImageId,
        id: schema.platforms.id,
        name: schema.platforms.name,
        abbreviation: schema.platforms.abbreviation,
        family: schema.platforms.family,
        sortOrder: schema.platforms.sortOrder,
        releaseDate: schema.platforms.releaseDate,
        summary: schema.platforms.summary,
        logoUrl: schema.platforms.logoUrl,
        parentPlatformId: schema.platforms.parentPlatformId,
        parentName: parentPlatform.name,
      })
      .from(schema.userConsoles)
      .innerJoin(schema.platforms, eq(schema.userConsoles.platformId, schema.platforms.id))
      .leftJoin(parentPlatform, eq(schema.platforms.parentPlatformId, parentPlatform.id))
      .where(eq(schema.userConsoles.userId, user.id))
      .orderBy(asc(schema.platforms.sortOrder));

    // every owned game, with which platform(s) it sits on. Small enough to
    // group in memory, and it keeps the counts and previews in one query.
    const owned = await db
      .select({
        platformId: schema.userGamePlatforms.platformId,
        format: schema.userGamePlatforms.format,
        entryId: schema.userGames.id,
        status: schema.userGames.status,
        createdAt: schema.userGames.createdAt,
        title: schema.games.title,
        customCoverImageId: schema.userGames.customCoverImageId,
        coverImageId: schema.games.coverImageId,
        coverUrl: schema.games.coverUrl,
      })
      .from(schema.userGamePlatforms)
      .innerJoin(schema.userGames, eq(schema.userGamePlatforms.userGameId, schema.userGames.id))
      .innerJoin(schema.games, eq(schema.userGames.gameId, schema.games.id))
      .where(eq(schema.userGames.userId, user.id))
      .orderBy(desc(schema.userGames.createdAt));

    const byPlatform = new Map<
      string,
      {
        entries: Map<string, { entryId: string; title: string; coverSrc: string | null; status: string }>;
        physical: Set<string>;
        digital: Set<string>;
      }
    >();
    for (const row of owned) {
      let bucket = byPlatform.get(row.platformId);
      if (!bucket) {
        bucket = { entries: new Map(), physical: new Set(), digital: new Set() };
        byPlatform.set(row.platformId, bucket);
      }
      // a game owned both physically and digitally is still one game
      bucket.entries.set(row.entryId, {
        entryId: row.entryId,
        title: row.title,
        coverSrc: row.customCoverImageId
          ? `/api/images/${row.customCoverImageId}`
          : row.coverImageId
            ? `/api/images/${row.coverImageId}`
            : row.coverUrl,
        status: row.status,
      });
      (row.format === "physical" ? bucket.physical : bucket.digital).add(row.entryId);
    }

    void backfillPlatformMeta(consoles.map((c) => c.id));

    // a storefront's games are PC games too, so PC's card counts itself plus
    // everything filed under its stores — `storefrontCount` says how much of
    // that total came from them
    const childIds = new Map<string, string[]>();
    for (const row of await db
      .select({ id: schema.platforms.id, parentId: schema.platforms.parentPlatformId })
      .from(schema.platforms)) {
      if (!row.parentId) continue;
      childIds.set(row.parentId, [...(childIds.get(row.parentId) ?? []), row.id]);
    }

    return consoles.map((c) => {
      const own = byPlatform.get(c.id);
      const children = childIds.get(c.id) ?? [];
      const entries = new Map(own?.entries ?? []);
      const physical = new Set(own?.physical ?? []);
      const digital = new Set(own?.digital ?? []);
      let storefrontCount = 0;
      for (const childId of children) {
        const child = byPlatform.get(childId);
        if (!child) continue;
        for (const [id, entry] of child.entries) {
          if (!entries.has(id)) storefrontCount++;
          entries.set(id, entry);
        }
        for (const id of child.physical) physical.add(id);
        for (const id of child.digital) digital.add(id);
      }
      const list = [...entries.values()];
      return {
        platform: {
          id: c.id,
          name: c.name,
          abbreviation: c.abbreviation,
          family: c.family,
          sortOrder: c.sortOrder,
          releaseDate: c.releaseDate,
          summary: c.summary,
          logoUrl: c.logoUrl,
          parentPlatformId: c.parentPlatformId,
          parentName: c.parentName,
          owned: true,
        },
        addedAt: c.addedAt,
        customImageSrc: c.customImageId ? `/api/images/${c.customImageId}` : null,
        gameCount: list.length,
        storefrontCount,
        physicalCount: physical.size,
        digitalCount: digital.size,
        preview: list.slice(0, PREVIEW_LIMIT),
      };
    });
  });

  app.post("/api/consoles", async (request, reply) => {
    const user = await requireUser(request, reply);
    if (!user) return;
    const parsed = addSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.status(400).send({ message: parsed.error.issues[0]?.message });
    }
    const [platform] = await db
      .select({ id: schema.platforms.id })
      .from(schema.platforms)
      .where(eq(schema.platforms.id, parsed.data.platformId));
    if (!platform) return reply.status(404).send({ message: "Unknown console" });

    await rememberConsoles(user.id, [platform.id]);
    void backfillPlatformMeta([platform.id]);
    reply.status(201);
    return { ok: true };
  });

  /**
   * Your own art for a console. Platforms are shared between users, so this
   * lives on `user_consoles` — one person's Steam logo isn't everyone's.
   */
  app.post<{ Params: { platformId: string } }>(
    "/api/consoles/:platformId/image",
    async (request, reply) => {
      const user = await requireUser(request, reply);
      if (!user) return;
      const [owned] = await db
        .select({ platformId: schema.userConsoles.platformId })
        .from(schema.userConsoles)
        .where(
          and(
            eq(schema.userConsoles.userId, user.id),
            eq(schema.userConsoles.platformId, request.params.platformId),
          ),
        );
      if (!owned) return reply.status(404).send({ message: "Not on your list" });

      const file = await request.file();
      if (!file) return reply.status(400).send({ message: "No file uploaded" });
      if (!ALLOWED_IMAGE_MIMES.has(file.mimetype)) {
        return reply.status(400).send({ message: "Console art must be a JPEG, PNG, or WebP image" });
      }
      const buffer = await file.toBuffer();
      const imageId = await saveUploadedImage(buffer, file.mimetype, "console_logo", user.id);
      await db
        .update(schema.userConsoles)
        .set({ customImageId: imageId })
        .where(
          and(
            eq(schema.userConsoles.userId, user.id),
            eq(schema.userConsoles.platformId, request.params.platformId),
          ),
        );
      return { imageId, customImageSrc: `/api/images/${imageId}` };
    },
  );

  /** Back to the stock logo. */
  app.delete<{ Params: { platformId: string } }>(
    "/api/consoles/:platformId/image",
    async (request, reply) => {
      const user = await requireUser(request, reply);
      if (!user) return;
      const updated = await db
        .update(schema.userConsoles)
        .set({ customImageId: null })
        .where(
          and(
            eq(schema.userConsoles.userId, user.id),
            eq(schema.userConsoles.platformId, request.params.platformId),
          ),
        )
        .returning({ platformId: schema.userConsoles.platformId });
      if (updated.length === 0) return reply.status(404).send({ message: "Not on your list" });
      return { ok: true };
    },
  );

  /**
   * Drop a console. Any games filed under it lose that platform too —
   * ownership that points at a console you don't have would be exactly the
   * drift this list exists to prevent. The count comes back so the UI can
   * say what it cost.
   */
  app.delete<{ Params: { platformId: string } }>(
    "/api/consoles/:platformId",
    async (request, reply) => {
      const user = await requireUser(request, reply);
      if (!user) return;

      const deleted = await db
        .delete(schema.userConsoles)
        .where(
          and(
            eq(schema.userConsoles.userId, user.id),
            eq(schema.userConsoles.platformId, request.params.platformId),
          ),
        )
        .returning({ platformId: schema.userConsoles.platformId });
      if (deleted.length === 0) return reply.status(404).send({ message: "Not on your list" });

      // scoped to this user's entries — the platform is shared, the
      // ownership rows hanging off it are not
      const mine = db
        .select({ id: schema.userGames.id })
        .from(schema.userGames)
        .where(eq(schema.userGames.userId, user.id));
      const removed = await db
        .delete(schema.userGamePlatforms)
        .where(
          and(
            eq(schema.userGamePlatforms.platformId, request.params.platformId),
            inArray(schema.userGamePlatforms.userGameId, mine),
          ),
        )
        .returning({ userGameId: schema.userGamePlatforms.userGameId });

      // both formats of the same game count once
      const affected = new Set(removed.map((r) => r.userGameId));
      return { ok: true, removedFromGames: affected.size };
    },
  );
}
