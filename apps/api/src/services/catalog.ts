import { eq } from "drizzle-orm";
import { db, schema } from "../db/index.js";
import {
  getIgdbGame,
  getIgdbTimeToBeat,
  igdbCoverUrl,
  type IgdbGame,
} from "./igdb.js";
import { cacheRemoteImage } from "./images.js";

/**
 * Ensure a catalog row exists for an IGDB game; returns the local game id.
 * Fetches metadata + TTB, links genres/platforms, and kicks off a
 * best-effort cover download in the background.
 */
export async function upsertGameFromIgdb(igdbId: number): Promise<string> {
  const existing = await db.query.games.findFirst({
    where: eq(schema.games.igdbId, igdbId),
  });
  if (existing) return existing.id;

  const igdb = await getIgdbGame(igdbId);
  if (!igdb) throw new Error(`IGDB game ${igdbId} not found (or IGDB not configured)`);

  const ttb = await getIgdbTimeToBeat(igdbId);
  const coverUrl = igdb.cover ? igdbCoverUrl(igdb.cover.image_id) : null;

  const [game] = await db
    .insert(schema.games)
    .values({
      igdbId,
      title: igdb.name,
      summary: igdb.summary ?? null,
      releaseDate: igdb.first_release_date
        ? new Date(igdb.first_release_date * 1000).toISOString().slice(0, 10)
        : null,
      coverUrl,
      ttbMain: ttb?.normally ?? null,
      ttbMainExtra: ttb?.hastily ?? null,
      ttbCompletionist: ttb?.completely ?? null,
      ttbSource: ttb ? "igdb" : null,
    })
    .onConflictDoUpdate({
      target: schema.games.igdbId,
      set: { updatedAt: new Date() },
    })
    .returning({ id: schema.games.id });
  if (!game) throw new Error("Failed to upsert game");

  await linkGenres(game.id, igdb);
  await linkPlatforms(game.id, igdb);

  if (coverUrl) {
    // fire-and-forget: cover appears once downloaded; coverUrl is the fallback
    void cacheRemoteImage(coverUrl, "cover").then(async (imageId) => {
      if (imageId) {
        await db
          .update(schema.games)
          .set({ coverImageId: imageId })
          .where(eq(schema.games.id, game.id));
      }
    });
  }
  return game.id;
}

async function linkGenres(gameId: string, igdb: IgdbGame): Promise<void> {
  for (const genre of igdb.genres ?? []) {
    const [row] = await db
      .insert(schema.genres)
      .values({ igdbGenreId: genre.id, name: genre.name })
      .onConflictDoUpdate({ target: schema.genres.name, set: { igdbGenreId: genre.id } })
      .returning({ id: schema.genres.id });
    if (row) {
      await db
        .insert(schema.gameGenres)
        .values({ gameId, genreId: row.id })
        .onConflictDoNothing();
    }
  }
}

async function linkPlatforms(gameId: string, igdb: IgdbGame): Promise<void> {
  if (!igdb.platforms?.length) return;
  const known = await db.select().from(schema.platforms);
  const byIgdbId = new Map(known.filter((p) => p.igdbPlatformId).map((p) => [p.igdbPlatformId, p]));
  for (const p of igdb.platforms) {
    const local = byIgdbId.get(p.id);
    if (local) {
      await db
        .insert(schema.gamePlatforms)
        .values({ gameId, platformId: local.id })
        .onConflictDoNothing();
    }
  }
}

/** Manual catalog entry for games IGDB doesn't know (or when IGDB is unconfigured). */
export async function createManualGame(title: string): Promise<string> {
  const [game] = await db
    .insert(schema.games)
    .values({ title: title.trim() })
    .returning({ id: schema.games.id });
  if (!game) throw new Error("Failed to create game");
  return game.id;
}
