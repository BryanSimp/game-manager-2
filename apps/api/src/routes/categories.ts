import type { FastifyInstance } from "fastify";
import { and, eq, sql } from "drizzle-orm";
import { z } from "zod";
import { db, schema } from "../db/index.js";
import { requireUser } from "../plugins/auth.js";
import { listCategories } from "../services/categories.js";

const categorySchema = z.object({
  name: z.string().min(1).max(40),
  color: z
    .string()
    .regex(/^#[0-9a-fA-F]{6}$/)
    .nullable()
    .optional(),
});
const patchSchema = categorySchema.partial();

export function registerCategoryRoutes(app: FastifyInstance): void {
  /** Built-ins and the user's custom categories, resolved and counted. */
  app.get("/api/categories", async (request, reply) => {
    const user = await requireUser(request, reply);
    if (!user) return;
    return listCategories(user.id);
  });

  app.post("/api/categories", async (request, reply) => {
    const user = await requireUser(request, reply);
    if (!user) return;
    const parsed = categorySchema.safeParse(request.body);
    if (!parsed.success) return reply.status(400).send({ message: "A name is required" });

    const [maxRow] = await db
      .select({ max: sql<number>`coalesce(max(${schema.customCategories.sortOrder}), -1)::int` })
      .from(schema.customCategories)
      .where(eq(schema.customCategories.userId, user.id));

    try {
      const [row] = await db
        .insert(schema.customCategories)
        .values({
          userId: user.id,
          name: parsed.data.name.trim(),
          color: parsed.data.color ?? null,
          sortOrder: (maxRow?.max ?? -1) + 1,
        })
        .returning();
      reply.status(201);
      return { id: row!.id };
    } catch {
      // unique(user_id, name)
      return reply.status(409).send({ message: "You already have a category with that name" });
    }
  });

  app.patch<{ Params: { id: string } }>("/api/categories/:id", async (request, reply) => {
    const user = await requireUser(request, reply);
    if (!user) return;
    const parsed = patchSchema.safeParse(request.body);
    if (!parsed.success) return reply.status(400).send({ message: "Invalid input" });
    const updated = await db
      .update(schema.customCategories)
      .set({
        ...(parsed.data.name !== undefined ? { name: parsed.data.name.trim() } : {}),
        ...(parsed.data.color !== undefined ? { color: parsed.data.color } : {}),
      })
      .where(
        and(
          eq(schema.customCategories.id, request.params.id),
          eq(schema.customCategories.userId, user.id),
        ),
      )
      .returning({ id: schema.customCategories.id });
    if (updated.length === 0) return reply.status(404).send({ message: "Category not found" });
    return { ok: true };
  });

  /**
   * Delete a custom category. Games filed under it move to 'uncategorized'
   * rather than disappearing — a deleted category shouldn't cost you data.
   */
  app.delete<{ Params: { id: string } }>("/api/categories/:id", async (request, reply) => {
    const user = await requireUser(request, reply);
    if (!user) return;
    const [row] = await db
      .select()
      .from(schema.customCategories)
      .where(
        and(
          eq(schema.customCategories.id, request.params.id),
          eq(schema.customCategories.userId, user.id),
        ),
      );
    if (!row) return reply.status(404).send({ message: "Category not found" });

    const moved = await db
      .update(schema.userGames)
      .set({ status: "uncategorized", updatedAt: new Date() })
      .where(and(eq(schema.userGames.userId, user.id), eq(schema.userGames.status, row.id)))
      .returning({ id: schema.userGames.id });

    // don't leave it as the default for new games
    await db
      .update(schema.userPreferences)
      .set({ defaultStatus: "backlog" })
      .where(
        and(
          eq(schema.userPreferences.userId, user.id),
          eq(schema.userPreferences.defaultStatus, row.id),
        ),
      );

    // …or as the view the library opens on, which would filter to nothing
    await db
      .update(schema.userPreferences)
      .set({ defaultLibraryFilter: "all" })
      .where(
        and(
          eq(schema.userPreferences.userId, user.id),
          eq(schema.userPreferences.defaultLibraryFilter, row.id),
        ),
      );

    await db.delete(schema.customCategories).where(eq(schema.customCategories.id, row.id));
    return { ok: true, movedToUncategorized: moved.length };
  });
}
