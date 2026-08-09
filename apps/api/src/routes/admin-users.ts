import type { FastifyInstance } from "fastify";
import { and, asc, count, desc, eq, ilike, or, sql, type SQL } from "drizzle-orm";
import { z } from "zod";
import {
  ADMIN_USER_FILTERS,
  ADMIN_USER_SORTS,
  type AdminUserPage,
  type AdminUserRow,
  type AdminUserSort,
} from "@gm/shared";
import { db, schema } from "../db/index.js";
import { requireAdmin } from "../plugins/auth.js";
import { flushEvents } from "../services/analytics.js";

/**
 * The account list behind the Users tab on /admin/analytics.
 *
 * It's read-only on purpose. The charts answer "how is this being used"; this
 * answers "by whom", and a self-hosted operator's first question after
 * standing an instance up is who actually signed up. Editing accounts — bans,
 * role changes, forced resets — is a bigger surface with its own
 * confirmation-shaped problems, and belongs in the phase 6 admin panel rather
 * than being smuggled into an analytics page.
 *
 * Demo accounts are *included* here, unlike in every aggregate: the whole
 * point of the list is to see what rows exist, and hiding the seeded showcase
 * account would make its games look like they came from nowhere. It's flagged
 * instead, and filterable.
 */

const querySchema = z.object({
  q: z.string().trim().max(200).optional(),
  filter: z.enum(ADMIN_USER_FILTERS).default("all"),
  sort: z.enum(ADMIN_USER_SORTS).default("newest"),
  limit: z.coerce.number().int().min(1).max(200).default(50),
  offset: z.coerce.number().int().min(0).default(0),
});

type Query = z.infer<typeof querySchema>;

/*
 * Per-user counts as scalar subqueries rather than joins.
 *
 * Four left joins over one-to-many tables multiply rows together — games ×
 * collections × friendships — and every count comes back wrong in a way
 * that looks plausible. Correlated subqueries each answer one question, and
 * they keep the ORDER BY on `games` sortable in the database instead of
 * over one page's worth of rows.
 */
const gameCount = sql<number>`(
  SELECT COUNT(*)::int FROM ${schema.userGames} WHERE ${schema.userGames.userId} = ${schema.user.id}
)`;

const collectionCount = sql<number>`(
  SELECT COUNT(*)::int FROM ${schema.collections}
  WHERE ${schema.collections.userId} = ${schema.user.id}
)`;

/** Accepted friendships only, and the pair can be stored in either direction. */
const friendCount = sql<number>`(
  SELECT COUNT(*)::int FROM ${schema.friendships}
  WHERE ${schema.friendships.status} = 'accepted'
    AND (${schema.friendships.requesterId} = ${schema.user.id}
         OR ${schema.friendships.addresseeId} = ${schema.user.id})
)`;

/** Unexpired sessions — roughly "signed in on this many devices right now". */
const sessionCount = sql<number>`(
  SELECT COUNT(*)::int FROM ${schema.session}
  WHERE ${schema.session.userId} = ${schema.user.id} AND ${schema.session.expiresAt} > now()
)`;

/**
 * Last activity ping. Sourced from analytics_events, which only started
 * logging in phase 14 — an account quiet since before that reads as null
 * rather than as a date we'd be inventing.
 */
const lastActiveAt = sql<Date | null>`(
  SELECT MAX(${schema.analyticsEvents.createdAt}) FROM ${schema.analyticsEvents}
  WHERE ${schema.analyticsEvents.userId} = ${schema.user.id}
)`;

const steamLinked = sql<boolean>`EXISTS (
  SELECT 1 FROM ${schema.steamAccounts} WHERE ${schema.steamAccounts.userId} = ${schema.user.id}
)`;

function filtersFor(query: Query): SQL | undefined {
  const clauses: SQL[] = [];
  if (query.filter === "admins") clauses.push(eq(schema.user.role, "admin"));
  if (query.filter === "banned") clauses.push(eq(schema.user.banned, true));
  if (query.filter === "demo") clauses.push(eq(schema.user.isDemo, true));
  if (query.q) {
    const needle = `%${query.q}%`;
    clauses.push(or(ilike(schema.user.name, needle), ilike(schema.user.email, needle))!);
  }
  return clauses.length > 0 ? and(...clauses) : undefined;
}

function orderFor(sort: AdminUserSort): SQL[] {
  const newest = desc(schema.user.createdAt);
  if (sort === "oldest") return [asc(schema.user.createdAt)];
  if (sort === "name") return [asc(schema.user.name), newest];
  if (sort === "games") return [desc(gameCount), newest];
  // an account that has never pinged sorts last rather than as the epoch
  if (sort === "active") return [sql`${lastActiveAt} DESC NULLS LAST`, newest];
  return [newest];
}

export function registerAdminUserRoutes(app: FastifyInstance): void {
  app.get("/api/admin/users", async (request, reply) => {
    const admin = await requireAdmin(request, reply);
    if (!admin) return;
    // land buffered events so "last active" isn't up to five seconds stale —
    // the admin looking at this list is themselves the most recent activity
    await flushEvents();

    const parsed = querySchema.safeParse(request.query);
    if (!parsed.success) {
      return reply.status(400).send({ message: parsed.error.issues[0]?.message });
    }
    const query = parsed.data;
    const where = filtersFor(query);

    const rows = await db
      .select({
        id: schema.user.id,
        name: schema.user.name,
        email: schema.user.email,
        role: schema.user.role,
        emailVerified: schema.user.emailVerified,
        banned: schema.user.banned,
        banReason: schema.user.banReason,
        isDemo: schema.user.isDemo,
        isPremium: schema.user.isPremium,
        twoFactorEnabled: schema.user.twoFactorEnabled,
        createdAt: schema.user.createdAt,
        games: gameCount,
        collections: collectionCount,
        friends: friendCount,
        sessions: sessionCount,
        lastActiveAt,
        steamLinked,
      })
      .from(schema.user)
      .where(where)
      .orderBy(...orderFor(query.sort))
      .limit(query.limit)
      .offset(query.offset);

    const [totalRow] = await db.select({ n: count() }).from(schema.user).where(where);

    // Counts across everything rather than within the current filter, so the
    // tiles stay still while you click between them — a "Banned: 2" tile that
    // reads 2 only while the banned filter is on tells you nothing.
    const [countsRow] = await db
      .select({
        all: count(),
        admins: sql<number>`COUNT(*) FILTER (WHERE ${schema.user.role} = 'admin')::int`,
        banned: sql<number>`COUNT(*) FILTER (WHERE ${schema.user.banned})::int`,
        demo: sql<number>`COUNT(*) FILTER (WHERE ${schema.user.isDemo})::int`,
      })
      .from(schema.user);

    const users: AdminUserRow[] = rows.map((r) => ({
      id: r.id,
      name: r.name,
      email: r.email,
      role: r.role,
      emailVerified: r.emailVerified,
      banned: r.banned,
      banReason: r.banReason,
      isDemo: r.isDemo,
      isPremium: r.isPremium,
      twoFactorEnabled: r.twoFactorEnabled,
      steamLinked: Boolean(r.steamLinked),
      games: r.games,
      collections: r.collections,
      friends: r.friends,
      sessions: r.sessions,
      createdAt: r.createdAt.toISOString(),
      lastActiveAt: r.lastActiveAt ? new Date(r.lastActiveAt).toISOString() : null,
    }));

    const page: AdminUserPage = {
      users,
      total: totalRow?.n ?? 0,
      counts: {
        all: countsRow?.all ?? 0,
        admins: countsRow?.admins ?? 0,
        banned: countsRow?.banned ?? 0,
        demo: countsRow?.demo ?? 0,
      },
    };
    return page;
  });
}
