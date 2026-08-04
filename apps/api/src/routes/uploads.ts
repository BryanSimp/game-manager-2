import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { and, eq } from "drizzle-orm";
import { db, schema } from "../db/index.js";
import { requireUser } from "../plugins/auth.js";
import { cacheRemoteImage, saveUploadedImage } from "../services/images.js";
import { searchCovers, getSteamGridDbKey } from "../services/steamgriddb.js";
import { externalLookupRateLimit, uploadRateLimit } from "../plugins/rate-limits.js";

const BAD_IMAGE = "That file isn't a valid image — PNG, JPEG, WebP, or AVIF only";

/** Hosts the cover-from-url endpoint will fetch, so it can't be used as a proxy. */
const ALLOWED_COVER_HOSTS = ["steamgriddb.com", "cdn2.steamgriddb.com", "cdn.steamgriddb.com"];

const coverUrlSchema = z.object({ url: z.string().url().max(1000) });

export function registerUploadRoutes(app: FastifyInstance): void {
  app.post<{ Params: { id: string } }>(
    "/api/library/:id/cover",
    { config: uploadRateLimit },
    async (request, reply) => {
    const user = await requireUser(request, reply);
    if (!user) return;
    const [entry] = await db
      .select({ id: schema.userGames.id })
      .from(schema.userGames)
      .where(and(eq(schema.userGames.id, request.params.id), eq(schema.userGames.userId, user.id)));
    if (!entry) return reply.status(404).send({ message: "Not found" });

    const file = await request.file();
    if (!file) return reply.status(400).send({ message: "No file uploaded" });
    // the mimetype header is not consulted — saveUploadedImage sniffs the bytes
    const buffer = await file.toBuffer();
    const imageId = await saveUploadedImage(buffer, "custom_cover", user.id);
    if (!imageId) return reply.status(400).send({ message: BAD_IMAGE });
    await db
      .update(schema.userGames)
      .set({ customCoverImageId: imageId, updatedAt: new Date() })
      .where(eq(schema.userGames.id, entry.id));
    return { imageId, coverSrc: `/api/images/${imageId}` };
    },
  );

  /**
   * Alternate covers for a game, from SteamGridDB. Empty list rather than an
   * error when no key is configured — the UI hides the browser in that case.
   */
  app.get<{ Params: { id: string } }>(
    "/api/library/:id/covers",
    { config: externalLookupRateLimit },
    async (request, reply) => {
    const user = await requireUser(request, reply);
    if (!user) return;
    const [row] = await db
      .select({ title: schema.games.title, steamAppId: schema.games.steamAppId })
      .from(schema.userGames)
      .innerJoin(schema.games, eq(schema.userGames.gameId, schema.games.id))
      .where(and(eq(schema.userGames.id, request.params.id), eq(schema.userGames.userId, user.id)));
    if (!row) return reply.status(404).send({ message: "Not found" });

    const configured = !!(await getSteamGridDbKey());
    if (!configured) return { configured: false, covers: [] };
    return { configured: true, covers: await searchCovers(row.title, row.steamAppId) };
    },
  );

  /** Use one of those covers: downloaded server-side, then set as the custom cover. */
  app.post<{ Params: { id: string } }>(
    "/api/library/:id/cover/from-url",
    { config: uploadRateLimit },
    async (request, reply) => {
    const user = await requireUser(request, reply);
    if (!user) return;
    const parsed = coverUrlSchema.safeParse(request.body);
    if (!parsed.success) return reply.status(400).send({ message: "A cover url is required" });

    const [entry] = await db
      .select({ id: schema.userGames.id })
      .from(schema.userGames)
      .where(and(eq(schema.userGames.id, request.params.id), eq(schema.userGames.userId, user.id)));
    if (!entry) return reply.status(404).send({ message: "Not found" });

    // only ever fetch from the service we offered — this endpoint must not
    // become a way to make the server fetch arbitrary URLs
    let host: string;
    try {
      host = new URL(parsed.data.url).host;
    } catch {
      return reply.status(400).send({ message: "Invalid url" });
    }
    if (!ALLOWED_COVER_HOSTS.some((h) => host === h || host.endsWith(`.${h}`))) {
      return reply.status(400).send({ message: "That image host isn't allowed" });
    }

    const imageId = await cacheRemoteImage(parsed.data.url, "custom_cover", user.id);
    if (!imageId) return reply.status(502).send({ message: "Couldn't download that image" });

    await db
      .update(schema.userGames)
      .set({ customCoverImageId: imageId, updatedAt: new Date() })
      .where(eq(schema.userGames.id, entry.id));
    return { imageId, coverSrc: `/api/images/${imageId}` };
    },
  );

  app.delete<{ Params: { id: string } }>("/api/library/:id/cover", async (request, reply) => {
    const user = await requireUser(request, reply);
    if (!user) return;
    const updated = await db
      .update(schema.userGames)
      .set({ customCoverImageId: null, updatedAt: new Date() })
      .where(and(eq(schema.userGames.id, request.params.id), eq(schema.userGames.userId, user.id)))
      .returning({ id: schema.userGames.id });
    if (updated.length === 0) return reply.status(404).send({ message: "Not found" });
    return { ok: true };
  });
}
