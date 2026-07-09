import type { FastifyInstance } from "fastify";
import { and, eq } from "drizzle-orm";
import { db, schema } from "../db/index.js";
import { requireUser } from "../plugins/auth.js";
import { saveUploadedImage } from "../services/images.js";

const ALLOWED_MIMES = new Set(["image/jpeg", "image/png", "image/webp"]);

export function registerUploadRoutes(app: FastifyInstance): void {
  app.post<{ Params: { id: string } }>("/api/library/:id/cover", async (request, reply) => {
    const user = await requireUser(request, reply);
    if (!user) return;
    const [entry] = await db
      .select({ id: schema.userGames.id })
      .from(schema.userGames)
      .where(and(eq(schema.userGames.id, request.params.id), eq(schema.userGames.userId, user.id)));
    if (!entry) return reply.status(404).send({ message: "Not found" });

    const file = await request.file();
    if (!file) return reply.status(400).send({ message: "No file uploaded" });
    if (!ALLOWED_MIMES.has(file.mimetype)) {
      return reply.status(400).send({ message: "Cover must be a JPEG, PNG, or WebP image" });
    }
    const buffer = await file.toBuffer();
    const imageId = await saveUploadedImage(buffer, file.mimetype, "custom_cover", user.id);
    await db
      .update(schema.userGames)
      .set({ customCoverImageId: imageId, updatedAt: new Date() })
      .where(eq(schema.userGames.id, entry.id));
    return { imageId, coverSrc: `/api/images/${imageId}` };
  });

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
