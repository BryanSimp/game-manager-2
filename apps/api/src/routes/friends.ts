import type { FastifyInstance } from "fastify";
import { and, asc, eq, inArray, or, sql } from "drizzle-orm";
import { z } from "zod";
import { db, schema } from "../db/index.js";
import { requireUser } from "../plugins/auth.js";
import { areFriends, ensureFriendCode, normalizeFriendCode } from "../services/friends.js";

const codeSchema = z.object({ code: z.string().min(1).max(40) });

/** The other party's id, whichever column they're in. */
function otherId(row: { requesterId: string; addresseeId: string }, me: string): string {
  return row.requesterId === me ? row.addresseeId : row.requesterId;
}

async function namesFor(ids: string[]): Promise<Map<string, string>> {
  if (ids.length === 0) return new Map();
  const rows = await db
    .select({ id: schema.user.id, name: schema.user.name })
    .from(schema.user)
    .where(inArray(schema.user.id, ids));
  return new Map(rows.map((r) => [r.id, r.name]));
}

export function registerFriendRoutes(app: FastifyInstance): void {
  /** Your code, your friends, and requests in both directions. */
  app.get("/api/friends", async (request, reply) => {
    const user = await requireUser(request, reply);
    if (!user) return;

    const friendCode = await ensureFriendCode(user.id);
    const rows = await db
      .select()
      .from(schema.friendships)
      .where(
        or(eq(schema.friendships.requesterId, user.id), eq(schema.friendships.addresseeId, user.id)),
      )
      .orderBy(asc(schema.friendships.createdAt));

    const names = await namesFor(rows.map((r) => otherId(r, user.id)));

    const accepted = rows.filter((r) => r.status === "accepted");
    const friendIds = accepted.map((r) => otherId(r, user.id));

    // library size and overlap for every friend, in two grouped queries
    const counts = await libraryCounts(friendIds);
    const common = await commonCounts(user.id, friendIds);

    return {
      friendCode,
      friends: accepted.map((r) => {
        const id = otherId(r, user.id);
        return {
          userId: id,
          name: names.get(id) ?? "Unknown",
          friendedAt: r.respondedAt,
          gamesInCommon: common.get(id) ?? 0,
          libraryCount: counts.get(id) ?? 0,
        };
      }),
      incoming: rows
        .filter((r) => r.status === "pending" && r.addresseeId === user.id)
        .map((r) => ({
          id: r.id,
          userId: r.requesterId,
          name: names.get(r.requesterId) ?? "Unknown",
          createdAt: r.createdAt,
        })),
      outgoing: rows
        .filter((r) => r.status === "pending" && r.requesterId === user.id)
        .map((r) => ({
          id: r.id,
          userId: r.addresseeId,
          name: names.get(r.addresseeId) ?? "Unknown",
          createdAt: r.createdAt,
        })),
    };
  });

  /** Send a request by friend code. */
  app.post("/api/friends/requests", async (request, reply) => {
    const user = await requireUser(request, reply);
    if (!user) return;
    const parsed = codeSchema.safeParse(request.body);
    if (!parsed.success) return reply.status(400).send({ message: "Enter a friend code" });

    const code = normalizeFriendCode(parsed.data.code);
    if (!code) {
      return reply.status(400).send({ message: "That doesn't look like a friend code" });
    }

    const [target] = await db
      .select({ id: schema.user.id, name: schema.user.name })
      .from(schema.user)
      .where(eq(schema.user.friendCode, code));
    // same message either way — otherwise this endpoint confirms which codes
    // are real, turning it into a directory
    if (!target || target.id === user.id) {
      return reply.status(404).send({ message: "No one found with that friend code" });
    }

    const [existing] = await db
      .select()
      .from(schema.friendships)
      .where(
        or(
          and(
            eq(schema.friendships.requesterId, user.id),
            eq(schema.friendships.addresseeId, target.id),
          ),
          and(
            eq(schema.friendships.requesterId, target.id),
            eq(schema.friendships.addresseeId, user.id),
          ),
        ),
      );

    if (existing?.status === "accepted") {
      return reply.status(409).send({ message: `You're already friends with ${target.name}` });
    }
    if (existing) {
      // they already asked you — treat entering their code as accepting
      if (existing.addresseeId === user.id) {
        await db
          .update(schema.friendships)
          .set({ status: "accepted", respondedAt: new Date() })
          .where(eq(schema.friendships.id, existing.id));
        return { status: "accepted" as const, name: target.name };
      }
      return reply.status(409).send({ message: `You've already asked ${target.name}` });
    }

    await db
      .insert(schema.friendships)
      .values({ requesterId: user.id, addresseeId: target.id, status: "pending" });
    reply.status(201);
    return { status: "pending" as const, name: target.name };
  });

  /** Accept an incoming request (addressee only). */
  app.post<{ Params: { id: string } }>(
    "/api/friends/requests/:id/accept",
    async (request, reply) => {
      const user = await requireUser(request, reply);
      if (!user) return;
      const [row] = await db
        .select()
        .from(schema.friendships)
        .where(eq(schema.friendships.id, request.params.id));
      if (!row || row.addresseeId !== user.id || row.status !== "pending") {
        return reply.status(404).send({ message: "Request not found" });
      }
      await db
        .update(schema.friendships)
        .set({ status: "accepted", respondedAt: new Date() })
        .where(eq(schema.friendships.id, row.id));
      return { ok: true };
    },
  );

  /** Decline an incoming request, or withdraw one you sent. */
  app.delete<{ Params: { id: string } }>("/api/friends/requests/:id", async (request, reply) => {
    const user = await requireUser(request, reply);
    if (!user) return;
    const [row] = await db
      .select()
      .from(schema.friendships)
      .where(eq(schema.friendships.id, request.params.id));
    if (!row || row.status !== "pending" || (row.addresseeId !== user.id && row.requesterId !== user.id)) {
      return reply.status(404).send({ message: "Request not found" });
    }
    await db.delete(schema.friendships).where(eq(schema.friendships.id, row.id));
    return { ok: true };
  });

  /** Unfriend. Either side can, and it removes the row entirely. */
  app.delete<{ Params: { userId: string } }>("/api/friends/:userId", async (request, reply) => {
    const user = await requireUser(request, reply);
    if (!user) return;
    const other = request.params.userId;
    const deleted = await db
      .delete(schema.friendships)
      .where(
        and(
          eq(schema.friendships.status, "accepted"),
          or(
            and(
              eq(schema.friendships.requesterId, user.id),
              eq(schema.friendships.addresseeId, other),
            ),
            and(
              eq(schema.friendships.requesterId, other),
              eq(schema.friendships.addresseeId, user.id),
            ),
          ),
        ),
      )
      .returning({ id: schema.friendships.id });
    if (deleted.length === 0) return reply.status(404).send({ message: "Not friends" });
    return { ok: true };
  });

  /**
   * A friend's library, with the games you both own flagged.
   *
   * Only accepted friends, and never the private columns: notes stay with
   * their owner.
   */
  app.get<{ Params: { userId: string } }>(
    "/api/friends/:userId/library",
    async (request, reply) => {
      const user = await requireUser(request, reply);
      if (!user) return;
      const friendId = request.params.userId;
      if (!(await areFriends(user.id, friendId))) {
        return reply.status(403).send({ message: "You're not friends with this user" });
      }

      const [friend] = await db
        .select({ id: schema.user.id, name: schema.user.name })
        .from(schema.user)
        .where(eq(schema.user.id, friendId));
      if (!friend) return reply.status(404).send({ message: "User not found" });

      // my entry id comes along so a card can link straight to my copy —
      // without it the UI can only offer /catalog/:gameId, which would
      // bounce through a redirect for every game we both own
      const mine = await db
        .select({
          id: schema.userGames.id,
          gameId: schema.userGames.gameId,
          status: schema.userGames.status,
        })
        .from(schema.userGames)
        .where(eq(schema.userGames.userId, user.id));
      const myGames = new Map(mine.map((m) => [m.gameId, m]));

      const rows = await db
        .select({
          gameId: schema.games.id,
          title: schema.games.title,
          releaseDate: schema.games.releaseDate,
          coverImageId: schema.games.coverImageId,
          coverUrl: schema.games.coverUrl,
          status: schema.userGames.status,
          rating: schema.userGames.rating,
          completed100: schema.userGames.completed100,
          userGameId: schema.userGames.id,
        })
        .from(schema.userGames)
        .innerJoin(schema.games, eq(schema.userGames.gameId, schema.games.id))
        .where(eq(schema.userGames.userId, friendId))
        .orderBy(asc(schema.games.title));

      const platforms = await platformNames(rows.map((r) => r.userGameId));

      const entries = rows.map((r) => {
        const mineForGame = myGames.get(r.gameId) ?? null;
        return {
          gameId: r.gameId,
          title: r.title,
          coverSrc: r.coverImageId ? `/api/images/${r.coverImageId}` : r.coverUrl,
          releaseDate: r.releaseDate,
          status: r.status,
          rating: r.rating ? Number(r.rating) : null,
          completed100: r.completed100,
          platforms: platforms.get(r.userGameId) ?? [],
          inCommon: mineForGame !== null,
          myStatus: mineForGame?.status ?? null,
          myUserGameId: mineForGame?.id ?? null,
        };
      });

      return {
        friend: { userId: friend.id, name: friend.name },
        entries,
        total: entries.length,
        inCommon: entries.filter((e) => e.inCommon).length,
      };
    },
  );
}

/** Platform labels per user_game, for the friend library rows. */
async function platformNames(userGameIds: string[]): Promise<Map<string, string[]>> {
  if (userGameIds.length === 0) return new Map();
  const rows = await db
    .select({
      userGameId: schema.userGamePlatforms.userGameId,
      name: schema.platforms.name,
      abbreviation: schema.platforms.abbreviation,
    })
    .from(schema.userGamePlatforms)
    .innerJoin(schema.platforms, eq(schema.userGamePlatforms.platformId, schema.platforms.id))
    .where(inArray(schema.userGamePlatforms.userGameId, userGameIds));
  const map = new Map<string, string[]>();
  for (const r of rows) {
    const list = map.get(r.userGameId) ?? [];
    list.push(r.abbreviation ?? r.name);
    map.set(r.userGameId, list);
  }
  return map;
}

async function libraryCounts(userIds: string[]): Promise<Map<string, number>> {
  if (userIds.length === 0) return new Map();
  const rows = await db
    .select({ userId: schema.userGames.userId, count: sql<number>`count(*)::int` })
    .from(schema.userGames)
    .where(inArray(schema.userGames.userId, userIds))
    .groupBy(schema.userGames.userId);
  return new Map(rows.map((r) => [r.userId, r.count]));
}

/** How many games each friend shares with me — one grouped self-join. */
async function commonCounts(meId: string, friendIds: string[]): Promise<Map<string, number>> {
  if (friendIds.length === 0) return new Map();
  const theirs = db
    .select({ userId: schema.userGames.userId, gameId: schema.userGames.gameId })
    .from(schema.userGames)
    .where(inArray(schema.userGames.userId, friendIds))
    .as("theirs");
  const rows = await db
    .select({ userId: theirs.userId, count: sql<number>`count(*)::int` })
    .from(theirs)
    .innerJoin(
      schema.userGames,
      and(eq(schema.userGames.gameId, theirs.gameId), eq(schema.userGames.userId, meId)),
    )
    .groupBy(theirs.userId);
  return new Map(rows.map((r) => [r.userId, r.count]));
}
