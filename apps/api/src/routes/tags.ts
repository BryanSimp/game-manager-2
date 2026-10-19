import type { FastifyInstance } from "fastify";
import { and, asc, eq } from "drizzle-orm";
import { z } from "zod";
import { db, schema } from "../db/index.js";
import { requireUser } from "../plugins/auth.js";
import { replyWithServiceError } from "../services/service-error.js";
import { createTag, deleteTag, ownedTagIds, updateTag } from "../services/tags.js";

const setTagsSchema = z.object({
  tagIds: z.array(z.string().uuid()).max(100),
});

export function registerTagRoutes(app: FastifyInstance): void {
  app.get("/api/tags", async (request, reply) => {
    const user = await requireUser(request, reply);
    if (!user) return;
    return db
      .select()
      .from(schema.tags)
      .where(eq(schema.tags.userId, user.id))
      .orderBy(asc(schema.tags.groupName), asc(schema.tags.name));
  });

  app.post("/api/tags", async (request, reply) => {
    const user = await requireUser(request, reply);
    if (!user) return;
    try {
      const created = await createTag(user.id, request.body);
      reply.status(201);
      return created;
    } catch (err) {
      return replyWithServiceError(reply, err);
    }
  });

  app.patch<{ Params: { id: string } }>("/api/tags/:id", async (request, reply) => {
    const user = await requireUser(request, reply);
    if (!user) return;
    try {
      return await updateTag(user.id, request.params.id, request.body);
    } catch (err) {
      return replyWithServiceError(reply, err);
    }
  });

  app.delete<{ Params: { id: string } }>("/api/tags/:id", async (request, reply) => {
    const user = await requireUser(request, reply);
    if (!user) return;
    try {
      await deleteTag(user.id, request.params.id);
      return { ok: true };
    } catch (err) {
      return replyWithServiceError(reply, err);
    }
  });

  app.put<{ Params: { id: string } }>("/api/library/:id/tags", async (request, reply) => {
    const user = await requireUser(request, reply);
    if (!user) return;
    const parsed = setTagsSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.status(400).send({ message: parsed.error.issues[0]?.message });
    }
    const [entry] = await db
      .select({ id: schema.userGames.id })
      .from(schema.userGames)
      .where(and(eq(schema.userGames.id, request.params.id), eq(schema.userGames.userId, user.id)));
    if (!entry) return reply.status(404).send({ message: "Not found" });

    // only this user's tags can be attached
    const tagIds = await ownedTagIds(user.id, parsed.data.tagIds);

    await db.delete(schema.userGameTags).where(eq(schema.userGameTags.userGameId, entry.id));
    if (tagIds.length > 0) {
      await db
        .insert(schema.userGameTags)
        .values(tagIds.map((tagId) => ({ userGameId: entry.id, tagId })))
        .onConflictDoNothing();
    }
    return { ok: true };
  });
}
