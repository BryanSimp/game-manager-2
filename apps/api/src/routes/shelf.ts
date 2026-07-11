import type { FastifyInstance } from "fastify";
import { and, asc, eq, inArray } from "drizzle-orm";
import { alias } from "drizzle-orm/pg-core";
import { z } from "zod";
import { db, schema } from "../db/index.js";
import { requireUser } from "../plugins/auth.js";
import { boxArtSupported, ensureBoxArt } from "../services/boxart.js";

const boxArtImage = alias(schema.images, "box_art_image");

const orderSchema = z.object({
  orderedUserGameIds: z.array(z.string().uuid()).min(1).max(500),
});

export function registerShelfRoutes(app: FastifyInstance): void {
  /** Owned games grouped into one shelf row per platform. */
  app.get("/api/shelf", async (request, reply) => {
    const user = await requireUser(request, reply);
    if (!user) return;

    const rows = await db
      .select({
        userGameId: schema.userGames.id,
        status: schema.userGames.status,
        rating: schema.userGames.rating,
        customCoverImageId: schema.userGames.customCoverImageId,
        format: schema.userGamePlatforms.format,
        position: schema.userGamePlatforms.position,
        platformId: schema.platforms.id,
        platformName: schema.platforms.name,
        platformAbbr: schema.platforms.abbreviation,
        family: schema.platforms.family,
        platformSort: schema.platforms.sortOrder,
        gameId: schema.games.id,
        title: schema.games.title,
        coverImageId: schema.games.coverImageId,
        coverUrl: schema.games.coverUrl,
        releaseDate: schema.games.releaseDate,
        boxArtImageId: schema.gameBoxArt.imageId,
        boxArtSource: schema.gameBoxArt.source,
        boxArtW: boxArtImage.width,
        boxArtH: boxArtImage.height,
      })
      .from(schema.userGamePlatforms)
      .innerJoin(schema.userGames, eq(schema.userGamePlatforms.userGameId, schema.userGames.id))
      .innerJoin(schema.platforms, eq(schema.userGamePlatforms.platformId, schema.platforms.id))
      .innerJoin(schema.games, eq(schema.userGames.gameId, schema.games.id))
      .leftJoin(
        schema.gameBoxArt,
        and(
          eq(schema.gameBoxArt.gameId, schema.games.id),
          eq(schema.gameBoxArt.platformId, schema.platforms.id),
        ),
      )
      .leftJoin(boxArtImage, eq(schema.gameBoxArt.imageId, boxArtImage.id))
      .where(eq(schema.userGames.userId, user.id))
      .orderBy(
        asc(schema.platforms.sortOrder),
        asc(schema.userGamePlatforms.position),
        asc(schema.games.title),
      );

    const shelves = new Map<
      string,
      {
        platform: {
          id: string;
          name: string;
          abbreviation: string | null;
          family: string;
          sortOrder: number;
        };
        entries: unknown[];
      }
    >();
    for (const row of rows) {
      if (!shelves.has(row.platformId)) {
        shelves.set(row.platformId, {
          platform: {
            id: row.platformId,
            name: row.platformName,
            abbreviation: row.platformAbbr,
            family: row.family,
            sortOrder: row.platformSort,
          },
          entries: [],
        });
      }
      shelves.get(row.platformId)!.entries.push({
        userGameId: row.userGameId,
        gameId: row.gameId,
        title: row.title,
        coverSrc: row.customCoverImageId
          ? `/api/images/${row.customCoverImageId}`
          : row.coverImageId
            ? `/api/images/${row.coverImageId}`
            : row.coverUrl,
        boxArtSrc: row.boxArtImageId ? `/api/images/${row.boxArtImageId}` : null,
        boxArtW: row.boxArtW,
        boxArtH: row.boxArtH,
        format: row.format,
        status: row.status,
        rating: row.rating ? Number(row.rating) : null,
        releaseDate: row.releaseDate,
        position: row.position,
      });
    }

    // kick off real box-art lookups for physical games that haven't been tried
    let queued = 0;
    for (const row of rows) {
      if (queued >= 6) break;
      if (
        row.format === "physical" &&
        row.boxArtSource == null &&
        boxArtSupported(row.platformName)
      ) {
        void ensureBoxArt(row.gameId, row.platformId, row.title, row.platformName);
        queued++;
      }
    }

    return [...shelves.values()];
  });

  /** Persist a custom order for one platform's shelf row. */
  app.put<{ Params: { platformId: string } }>(
    "/api/shelf/:platformId/order",
    async (request, reply) => {
      const user = await requireUser(request, reply);
      if (!user) return;
      const parsed = orderSchema.safeParse(request.body);
      if (!parsed.success) {
        return reply.status(400).send({ message: parsed.error.issues[0]?.message });
      }
      // only this user's entries are reorderable
      const owned = await db
        .select({ id: schema.userGames.id })
        .from(schema.userGames)
        .where(
          and(
            eq(schema.userGames.userId, user.id),
            inArray(schema.userGames.id, parsed.data.orderedUserGameIds),
          ),
        );
      const ownedIds = new Set(owned.map((r) => r.id));
      let position = 0;
      for (const userGameId of parsed.data.orderedUserGameIds) {
        if (!ownedIds.has(userGameId)) continue;
        await db
          .update(schema.userGamePlatforms)
          .set({ position })
          .where(
            and(
              eq(schema.userGamePlatforms.userGameId, userGameId),
              eq(schema.userGamePlatforms.platformId, request.params.platformId),
            ),
          );
        position++;
      }
      return { ok: true };
    },
  );
}
