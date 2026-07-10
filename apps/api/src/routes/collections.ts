import type { FastifyInstance } from "fastify";
import { and, asc, count, eq, inArray, sql } from "drizzle-orm";
import { z } from "zod";
import { db, schema } from "../db/index.js";
import { requireUser } from "../plugins/auth.js";

const collectionSchema = z.object({
  name: z.string().min(1).max(100),
  description: z.string().max(2000).nullable().optional(),
  accentColor: z
    .string()
    .regex(/^#[0-9a-fA-F]{6}$/)
    .nullable()
    .optional(),
});

const layoutSchema = z.object({
  nodes: z
    .array(
      z.object({
        gameId: z.string().uuid(),
        x: z.number().min(-10_000).max(10_000),
        y: z.number().min(-10_000).max(10_000),
      }),
    )
    .max(200),
  links: z
    .array(
      z.object({
        fromGameId: z.string().uuid(),
        toGameId: z.string().uuid(),
        label: z.string().max(60).nullable().optional(),
      }),
    )
    .max(400),
});

async function ownedCollection(userId: string, id: string) {
  const [row] = await db
    .select()
    .from(schema.collections)
    .where(and(eq(schema.collections.id, id), eq(schema.collections.userId, userId)));
  return row ?? null;
}

function gameCover(game: {
  coverImageId: string | null;
  coverUrl: string | null;
  customCoverImageId?: string | null;
}): string | null {
  return game.coverImageId ? `/api/images/${game.coverImageId}` : game.coverUrl;
}

export function registerCollectionRoutes(app: FastifyInstance): void {
  app.get("/api/collections", async (request, reply) => {
    const user = await requireUser(request, reply);
    if (!user) return;
    const rows = await db
      .select()
      .from(schema.collections)
      .where(eq(schema.collections.userId, user.id))
      .orderBy(asc(schema.collections.name));

    // roll-up stats: total games + user's finished count per collection
    const stats = await db
      .select({
        collectionId: schema.collectionGames.collectionId,
        total: count(),
        finished: sql<number>`count(*) filter (where ${schema.userGames.status} = 'finished')`,
      })
      .from(schema.collectionGames)
      .leftJoin(
        schema.userGames,
        and(
          eq(schema.userGames.gameId, schema.collectionGames.gameId),
          eq(schema.userGames.userId, user.id),
        ),
      )
      .groupBy(schema.collectionGames.collectionId);
    const statMap = new Map(stats.map((s) => [s.collectionId, s]));

    return rows.map((c) => ({
      id: c.id,
      name: c.name,
      description: c.description,
      accentColor: c.accentColor,
      total: statMap.get(c.id)?.total ?? 0,
      finished: Number(statMap.get(c.id)?.finished ?? 0),
    }));
  });

  app.post("/api/collections", async (request, reply) => {
    const user = await requireUser(request, reply);
    if (!user) return;
    const parsed = collectionSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.status(400).send({ message: parsed.error.issues[0]?.message });
    }
    const [created] = await db
      .insert(schema.collections)
      .values({
        userId: user.id,
        name: parsed.data.name.trim(),
        description: parsed.data.description ?? null,
        accentColor: parsed.data.accentColor ?? null,
      })
      .onConflictDoNothing()
      .returning();
    if (!created) {
      return reply.status(409).send({ message: "You already have a collection with that name" });
    }
    reply.status(201);
    return created;
  });

  app.patch<{ Params: { id: string } }>("/api/collections/:id", async (request, reply) => {
    const user = await requireUser(request, reply);
    if (!user) return;
    const parsed = collectionSchema.partial().safeParse(request.body);
    if (!parsed.success) {
      return reply.status(400).send({ message: parsed.error.issues[0]?.message });
    }
    const updated = await db
      .update(schema.collections)
      .set(parsed.data)
      .where(and(eq(schema.collections.id, request.params.id), eq(schema.collections.userId, user.id)))
      .returning();
    if (updated.length === 0) return reply.status(404).send({ message: "Collection not found" });
    return updated[0];
  });

  app.delete<{ Params: { id: string } }>("/api/collections/:id", async (request, reply) => {
    const user = await requireUser(request, reply);
    if (!user) return;
    const deleted = await db
      .delete(schema.collections)
      .where(and(eq(schema.collections.id, request.params.id), eq(schema.collections.userId, user.id)))
      .returning({ id: schema.collections.id });
    if (deleted.length === 0) return reply.status(404).send({ message: "Collection not found" });
    return { ok: true };
  });

  app.get<{ Params: { id: string } }>("/api/collections/:id", async (request, reply) => {
    const user = await requireUser(request, reply);
    if (!user) return;
    const collection = await ownedCollection(user.id, request.params.id);
    if (!collection) return reply.status(404).send({ message: "Collection not found" });

    const nodes = await db
      .select({
        gameId: schema.collectionGames.gameId,
        x: schema.collectionGames.positionX,
        y: schema.collectionGames.positionY,
        title: schema.games.title,
        coverImageId: schema.games.coverImageId,
        coverUrl: schema.games.coverUrl,
        userGameId: schema.userGames.id,
        status: schema.userGames.status,
      })
      .from(schema.collectionGames)
      .innerJoin(schema.games, eq(schema.collectionGames.gameId, schema.games.id))
      .leftJoin(
        schema.userGames,
        and(
          eq(schema.userGames.gameId, schema.collectionGames.gameId),
          eq(schema.userGames.userId, user.id),
        ),
      )
      .where(eq(schema.collectionGames.collectionId, collection.id));

    const links = await db
      .select()
      .from(schema.collectionLinks)
      .where(eq(schema.collectionLinks.collectionId, collection.id));

    return {
      id: collection.id,
      name: collection.name,
      description: collection.description,
      accentColor: collection.accentColor,
      games: nodes.map((n) => ({
        gameId: n.gameId,
        title: n.title,
        coverSrc: gameCover(n),
        x: n.x,
        y: n.y,
        userGameId: n.userGameId,
        status: n.status,
      })),
      links: links.map((l) => ({
        id: l.id,
        fromGameId: l.fromGameId,
        toGameId: l.toGameId,
        label: l.label,
      })),
    };
  });

  app.post<{ Params: { id: string } }>("/api/collections/:id/games", async (request, reply) => {
    const user = await requireUser(request, reply);
    if (!user) return;
    const collection = await ownedCollection(user.id, request.params.id);
    if (!collection) return reply.status(404).send({ message: "Collection not found" });
    const parsed = z.object({ gameId: z.string().uuid() }).safeParse(request.body);
    if (!parsed.success) return reply.status(400).send({ message: "gameId required" });

    // place new nodes in a loose grid so they don't stack at the origin
    const [countRow] = await db
      .select({ n: count() })
      .from(schema.collectionGames)
      .where(eq(schema.collectionGames.collectionId, collection.id));
    const n = countRow?.n ?? 0;
    await db
      .insert(schema.collectionGames)
      .values({
        collectionId: collection.id,
        gameId: parsed.data.gameId,
        positionX: 80 + (n % 5) * 150,
        positionY: 80 + Math.floor(n / 5) * 190,
      })
      .onConflictDoNothing();
    return { ok: true };
  });

  app.delete<{ Params: { id: string; gameId: string } }>(
    "/api/collections/:id/games/:gameId",
    async (request, reply) => {
      const user = await requireUser(request, reply);
      if (!user) return;
      const collection = await ownedCollection(user.id, request.params.id);
      if (!collection) return reply.status(404).send({ message: "Collection not found" });
      await db
        .delete(schema.collectionGames)
        .where(
          and(
            eq(schema.collectionGames.collectionId, collection.id),
            eq(schema.collectionGames.gameId, request.params.gameId),
          ),
        );
      await db
        .delete(schema.collectionLinks)
        .where(
          and(
            eq(schema.collectionLinks.collectionId, collection.id),
            sql`(${schema.collectionLinks.fromGameId} = ${request.params.gameId} or ${schema.collectionLinks.toGameId} = ${request.params.gameId})`,
          ),
        );
      return { ok: true };
    },
  );

  /** Replace node positions + edges in one shot (called on graph edits). */
  app.put<{ Params: { id: string } }>("/api/collections/:id/layout", async (request, reply) => {
    const user = await requireUser(request, reply);
    if (!user) return;
    const collection = await ownedCollection(user.id, request.params.id);
    if (!collection) return reply.status(404).send({ message: "Collection not found" });
    const parsed = layoutSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.status(400).send({ message: parsed.error.issues[0]?.message });
    }

    // only games actually in the collection
    const members = await db
      .select({ gameId: schema.collectionGames.gameId })
      .from(schema.collectionGames)
      .where(eq(schema.collectionGames.collectionId, collection.id));
    const memberIds = new Set(members.map((m) => m.gameId));

    for (const node of parsed.data.nodes) {
      if (!memberIds.has(node.gameId)) continue;
      await db
        .update(schema.collectionGames)
        .set({ positionX: node.x, positionY: node.y })
        .where(
          and(
            eq(schema.collectionGames.collectionId, collection.id),
            eq(schema.collectionGames.gameId, node.gameId),
          ),
        );
    }

    await db
      .delete(schema.collectionLinks)
      .where(eq(schema.collectionLinks.collectionId, collection.id));
    const validLinks = parsed.data.links.filter(
      (l) => memberIds.has(l.fromGameId) && memberIds.has(l.toGameId) && l.fromGameId !== l.toGameId,
    );
    if (validLinks.length > 0) {
      await db.insert(schema.collectionLinks).values(
        validLinks.map((l) => ({
          collectionId: collection.id,
          fromGameId: l.fromGameId,
          toGameId: l.toGameId,
          label: l.label ?? null,
        })),
      );
    }
    return { ok: true };
  });
}
