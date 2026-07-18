import type { FastifyInstance } from "fastify";
import { and, asc, eq, inArray, ne, sql } from "drizzle-orm";
import { z } from "zod";
import { db, schema } from "../db/index.js";
import { requireUser, type SessionUser } from "../plugins/auth.js";

const titleSchema = z.object({ title: z.string().min(1).max(200) });
const patchSchema = z.object({
  title: z.string().min(1).max(200).optional(),
  isPublic: z.boolean().optional(),
});
const itemSchema = z.object({
  text: z.string().min(1).max(500),
  category: z.string().max(100).nullable().optional(),
});
const itemPatchSchema = z.object({
  text: z.string().min(1).max(500).optional(),
  category: z.string().max(100).nullable().optional(),
  position: z.number().int().min(0).optional(),
});

async function getTemplate(id: string) {
  const [tpl] = await db
    .select()
    .from(schema.checklistTemplates)
    .where(eq(schema.checklistTemplates.id, id));
  return tpl ?? null;
}

/** Author sees their own; everyone sees public. */
function canView(tpl: { authorUserId: string; isPublic: boolean }, user: SessionUser) {
  return tpl.authorUserId === user.id || tpl.isPublic;
}

async function summarize(
  templates: Array<typeof schema.checklistTemplates.$inferSelect>,
  user: SessionUser,
) {
  if (templates.length === 0) return [];
  const ids = templates.map((t) => t.id);
  const counts = await db
    .select({
      templateId: schema.checklistItems.templateId,
      itemCount: sql<number>`count(*)::int`,
      doneCount: sql<number>`count(${schema.userChecklistItems.userId})::int`,
    })
    .from(schema.checklistItems)
    .leftJoin(
      schema.userChecklistItems,
      and(
        eq(schema.userChecklistItems.itemId, schema.checklistItems.id),
        eq(schema.userChecklistItems.userId, user.id),
      ),
    )
    .where(inArray(schema.checklistItems.templateId, ids))
    .groupBy(schema.checklistItems.templateId);
  const byTemplate = new Map(counts.map((c) => [c.templateId, c]));

  const authorIds = [...new Set(templates.map((t) => t.authorUserId))];
  const authors = await db
    .select({ id: schema.user.id, name: schema.user.name })
    .from(schema.user)
    .where(inArray(schema.user.id, authorIds));
  const authorNames = new Map(authors.map((a) => [a.id, a.name]));

  return templates.map((t) => ({
    id: t.id,
    title: t.title,
    isPublic: t.isPublic,
    mine: t.authorUserId === user.id,
    authorName: t.authorUserId === user.id ? null : (authorNames.get(t.authorUserId) ?? null),
    itemCount: byTemplate.get(t.id)?.itemCount ?? 0,
    doneCount: byTemplate.get(t.id)?.doneCount ?? 0,
  }));
}

export function registerChecklistRoutes(app: FastifyInstance): void {
  // All checklists for a game: mine + other users' public templates
  app.get<{ Params: { gameId: string } }>(
    "/api/games/:gameId/checklists",
    async (request, reply) => {
      const user = await requireUser(request, reply);
      if (!user) return;
      const mine = await db
        .select()
        .from(schema.checklistTemplates)
        .where(
          and(
            eq(schema.checklistTemplates.gameId, request.params.gameId),
            eq(schema.checklistTemplates.authorUserId, user.id),
          ),
        )
        .orderBy(asc(schema.checklistTemplates.createdAt));
      const pub = await db
        .select()
        .from(schema.checklistTemplates)
        .where(
          and(
            eq(schema.checklistTemplates.gameId, request.params.gameId),
            eq(schema.checklistTemplates.isPublic, true),
            ne(schema.checklistTemplates.authorUserId, user.id),
          ),
        )
        .orderBy(asc(schema.checklistTemplates.createdAt));
      return { mine: await summarize(mine, user), public: await summarize(pub, user) };
    },
  );

  app.post<{ Params: { gameId: string } }>(
    "/api/games/:gameId/checklists",
    async (request, reply) => {
      const user = await requireUser(request, reply);
      if (!user) return;
      const parsed = titleSchema.safeParse(request.body);
      if (!parsed.success) return reply.status(400).send({ message: "Title is required" });
      const [game] = await db
        .select({ id: schema.games.id })
        .from(schema.games)
        .where(eq(schema.games.id, request.params.gameId));
      if (!game) return reply.status(404).send({ message: "Game not found" });
      const [tpl] = await db
        .insert(schema.checklistTemplates)
        .values({ gameId: game.id, authorUserId: user.id, title: parsed.data.title.trim() })
        .returning();
      reply.status(201);
      return { id: tpl!.id };
    },
  );

  // Template detail with items + my completion state
  app.get<{ Params: { id: string } }>("/api/checklists/:id", async (request, reply) => {
    const user = await requireUser(request, reply);
    if (!user) return;
    const tpl = await getTemplate(request.params.id);
    if (!tpl || !canView(tpl, user)) {
      return reply.status(404).send({ message: "Checklist not found" });
    }
    const items = await db
      .select({
        id: schema.checklistItems.id,
        position: schema.checklistItems.position,
        text: schema.checklistItems.text,
        category: schema.checklistItems.category,
        completedAt: schema.userChecklistItems.completedAt,
      })
      .from(schema.checklistItems)
      .leftJoin(
        schema.userChecklistItems,
        and(
          eq(schema.userChecklistItems.itemId, schema.checklistItems.id),
          eq(schema.userChecklistItems.userId, user.id),
        ),
      )
      .where(eq(schema.checklistItems.templateId, tpl.id))
      .orderBy(asc(schema.checklistItems.position), asc(schema.checklistItems.text));
    let authorName: string | null = null;
    if (tpl.authorUserId !== user.id) {
      const [author] = await db
        .select({ name: schema.user.name })
        .from(schema.user)
        .where(eq(schema.user.id, tpl.authorUserId));
      authorName = author?.name ?? null;
    }
    return {
      id: tpl.id,
      gameId: tpl.gameId,
      title: tpl.title,
      isPublic: tpl.isPublic,
      mine: tpl.authorUserId === user.id,
      authorName,
      items,
    };
  });

  app.patch<{ Params: { id: string } }>("/api/checklists/:id", async (request, reply) => {
    const user = await requireUser(request, reply);
    if (!user) return;
    const tpl = await getTemplate(request.params.id);
    if (!tpl || tpl.authorUserId !== user.id) {
      return reply.status(404).send({ message: "Checklist not found" });
    }
    const parsed = patchSchema.safeParse(request.body);
    if (!parsed.success) return reply.status(400).send({ message: "Invalid input" });
    await db
      .update(schema.checklistTemplates)
      .set({
        ...(parsed.data.title !== undefined ? { title: parsed.data.title.trim() } : {}),
        ...(parsed.data.isPublic !== undefined ? { isPublic: parsed.data.isPublic } : {}),
        updatedAt: new Date(),
      })
      .where(eq(schema.checklistTemplates.id, tpl.id));
    return { ok: true };
  });

  // Author deletes their own; admin can moderate any public template
  app.delete<{ Params: { id: string } }>("/api/checklists/:id", async (request, reply) => {
    const user = await requireUser(request, reply);
    if (!user) return;
    const tpl = await getTemplate(request.params.id);
    if (!tpl) return reply.status(404).send({ message: "Checklist not found" });
    const allowed = tpl.authorUserId === user.id || (user.role === "admin" && tpl.isPublic);
    if (!allowed) return reply.status(403).send({ message: "Not your checklist" });
    await db.delete(schema.checklistTemplates).where(eq(schema.checklistTemplates.id, tpl.id));
    return { ok: true };
  });

  // Adopt a public template: private copy under my account, progress starts fresh
  app.post<{ Params: { id: string } }>("/api/checklists/:id/adopt", async (request, reply) => {
    const user = await requireUser(request, reply);
    if (!user) return;
    const tpl = await getTemplate(request.params.id);
    if (!tpl || !tpl.isPublic) return reply.status(404).send({ message: "Checklist not found" });
    if (tpl.authorUserId === user.id) {
      return reply.status(400).send({ message: "This checklist is already yours" });
    }
    const items = await db
      .select()
      .from(schema.checklistItems)
      .where(eq(schema.checklistItems.templateId, tpl.id))
      .orderBy(asc(schema.checklistItems.position));
    const [copy] = await db
      .insert(schema.checklistTemplates)
      .values({
        gameId: tpl.gameId,
        authorUserId: user.id,
        title: tpl.title,
        isPublic: false,
        adoptedFromId: tpl.id,
      })
      .returning();
    if (items.length > 0) {
      await db.insert(schema.checklistItems).values(
        items.map((it) => ({
          templateId: copy!.id,
          position: it.position,
          text: it.text,
          category: it.category,
        })),
      );
    }
    reply.status(201);
    return { id: copy!.id };
  });

  // ---- items (author only) ----

  app.post<{ Params: { id: string } }>("/api/checklists/:id/items", async (request, reply) => {
    const user = await requireUser(request, reply);
    if (!user) return;
    const tpl = await getTemplate(request.params.id);
    if (!tpl || tpl.authorUserId !== user.id) {
      return reply.status(404).send({ message: "Checklist not found" });
    }
    const parsed = itemSchema.safeParse(request.body);
    if (!parsed.success) return reply.status(400).send({ message: "Item text is required" });
    const [maxRow] = await db
      .select({ max: sql<number>`coalesce(max(${schema.checklistItems.position}), -1)::int` })
      .from(schema.checklistItems)
      .where(eq(schema.checklistItems.templateId, tpl.id));
    const max = maxRow?.max ?? -1;
    const [item] = await db
      .insert(schema.checklistItems)
      .values({
        templateId: tpl.id,
        position: max + 1,
        text: parsed.data.text.trim(),
        category: parsed.data.category?.trim() || null,
      })
      .returning();
    reply.status(201);
    return { id: item!.id, position: item!.position };
  });

  app.patch<{ Params: { itemId: string } }>(
    "/api/checklists/items/:itemId",
    async (request, reply) => {
      const user = await requireUser(request, reply);
      if (!user) return;
      const [row] = await db
        .select({ item: schema.checklistItems, tpl: schema.checklistTemplates })
        .from(schema.checklistItems)
        .innerJoin(
          schema.checklistTemplates,
          eq(schema.checklistItems.templateId, schema.checklistTemplates.id),
        )
        .where(eq(schema.checklistItems.id, request.params.itemId));
      if (!row || row.tpl.authorUserId !== user.id) {
        return reply.status(404).send({ message: "Item not found" });
      }
      const parsed = itemPatchSchema.safeParse(request.body);
      if (!parsed.success) return reply.status(400).send({ message: "Invalid input" });
      await db
        .update(schema.checklistItems)
        .set({
          ...(parsed.data.text !== undefined ? { text: parsed.data.text.trim() } : {}),
          ...(parsed.data.category !== undefined
            ? { category: parsed.data.category?.trim() || null }
            : {}),
          ...(parsed.data.position !== undefined ? { position: parsed.data.position } : {}),
        })
        .where(eq(schema.checklistItems.id, row.item.id));
      return { ok: true };
    },
  );

  app.delete<{ Params: { itemId: string } }>(
    "/api/checklists/items/:itemId",
    async (request, reply) => {
      const user = await requireUser(request, reply);
      if (!user) return;
      const [row] = await db
        .select({ item: schema.checklistItems, tpl: schema.checklistTemplates })
        .from(schema.checklistItems)
        .innerJoin(
          schema.checklistTemplates,
          eq(schema.checklistItems.templateId, schema.checklistTemplates.id),
        )
        .where(eq(schema.checklistItems.id, request.params.itemId));
      if (!row || row.tpl.authorUserId !== user.id) {
        return reply.status(404).send({ message: "Item not found" });
      }
      await db.delete(schema.checklistItems).where(eq(schema.checklistItems.id, row.item.id));
      return { ok: true };
    },
  );

  // ---- progress (own templates only — adopt public ones first) ----

  app.put<{ Params: { itemId: string } }>(
    "/api/checklists/items/:itemId/check",
    async (request, reply) => {
      const user = await requireUser(request, reply);
      if (!user) return;
      const parsed = z.object({ completed: z.boolean() }).safeParse(request.body);
      if (!parsed.success) return reply.status(400).send({ message: "Invalid input" });
      const [row] = await db
        .select({ itemId: schema.checklistItems.id, authorUserId: schema.checklistTemplates.authorUserId })
        .from(schema.checklistItems)
        .innerJoin(
          schema.checklistTemplates,
          eq(schema.checklistItems.templateId, schema.checklistTemplates.id),
        )
        .where(eq(schema.checklistItems.id, request.params.itemId));
      if (!row || row.authorUserId !== user.id) {
        return reply.status(404).send({ message: "Item not found" });
      }
      if (parsed.data.completed) {
        await db
          .insert(schema.userChecklistItems)
          .values({ userId: user.id, itemId: row.itemId })
          .onConflictDoNothing();
      } else {
        await db
          .delete(schema.userChecklistItems)
          .where(
            and(
              eq(schema.userChecklistItems.userId, user.id),
              eq(schema.userChecklistItems.itemId, row.itemId),
            ),
          );
      }
      return { ok: true };
    },
  );
}
