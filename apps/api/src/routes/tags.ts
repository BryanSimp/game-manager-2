import type { FastifyInstance } from "fastify";
import { and, asc, eq } from "drizzle-orm";
import { z } from "zod";
import { db, schema } from "../db/index.js";
import { requireUser } from "../plugins/auth.js";

const tagSchema = z.object({
  name: z.string().min(1).max(60),
  color: z
    .string()
    .regex(/^#[0-9a-fA-F]{6}$/, "Color must be a hex value like #8b5cf6")
    .nullable()
    .optional(),
  groupName: z.string().min(1).max(60).nullable().optional(),
});

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
    const parsed = tagSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.status(400).send({ message: parsed.error.issues[0]?.message });
    }
    const [created] = await db
      .insert(schema.tags)
      .values({
        userId: user.id,
        name: parsed.data.name.trim(),
        color: parsed.data.color ?? null,
        groupName: parsed.data.groupName?.trim() || null,
      })
      .onConflictDoNothing()
      .returning();
    if (!created) return reply.status(409).send({ message: "You already have a tag with that name" });
    reply.status(201);
    return created;
  });

  app.patch<{ Params: { id: string } }>("/api/tags/:id", async (request, reply) => {
    const user = await requireUser(request, reply);
    if (!user) return;
    const parsed = tagSchema.partial().safeParse(request.body);
    if (!parsed.success) {
      return reply.status(400).send({ message: parsed.error.issues[0]?.message });
    }
    const patch: Record<string, unknown> = {};
    if (parsed.data.name !== undefined) patch.name = parsed.data.name.trim();
    if (parsed.data.color !== undefined) patch.color = parsed.data.color;
    if (parsed.data.groupName !== undefined) patch.groupName = parsed.data.groupName?.trim() || null;
    const updated = await db
      .update(schema.tags)
      .set(patch)
      .where(and(eq(schema.tags.id, request.params.id), eq(schema.tags.userId, user.id)))
      .returning();
    if (updated.length === 0) return reply.status(404).send({ message: "Tag not found" });
    return updated[0];
  });

  app.delete<{ Params: { id: string } }>("/api/tags/:id", async (request, reply) => {
    const user = await requireUser(request, reply);
    if (!user) return;
    const deleted = await db
      .delete(schema.tags)
      .where(and(eq(schema.tags.id, request.params.id), eq(schema.tags.userId, user.id)))
      .returning({ id: schema.tags.id });
    if (deleted.length === 0) return reply.status(404).send({ message: "Tag not found" });
    return { ok: true };
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
    const owned = await db
      .select({ id: schema.tags.id })
      .from(schema.tags)
      .where(eq(schema.tags.userId, user.id));
    const ownedIds = new Set(owned.map((t) => t.id));
    const tagIds = parsed.data.tagIds.filter((id) => ownedIds.has(id));

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
