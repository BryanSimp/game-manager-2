import type { FastifyInstance } from "fastify";
import { count, sql } from "drizzle-orm";
import type { AdminAnalyticsOverview, ScraperHealth } from "@gm/shared";
import { db, schema } from "../db/index.js";
import { requireAdmin } from "../plugins/auth.js";
import { flushEvents } from "../services/analytics.js";

/**
 * Admin-only aggregates over analytics_events. Everything here is read-side:
 * the event log is written by services/analytics.ts in background batches,
 * so these queries never contend with a user-facing request.
 */

/** A ping this long after the previous one starts a new session. */
const SESSION_GAP = "30 minutes";

const FUNNEL_STEPS: Array<{ type: string; step: string }> = [
  { type: "sign_up", step: "Signed up" },
  { type: "steam_link", step: "Linked Steam" },
  { type: "game_added", step: "Added a game" },
  { type: "collection_created", step: "Created a collection" },
];

export function registerAnalyticsRoutes(app: FastifyInstance): void {
  app.get("/api/admin/analytics/overview", async (request, reply) => {
    const user = await requireAdmin(request, reply);
    if (!user) return;
    // land whatever is sitting in the buffer so the numbers are current
    await flushEvents();

    const funnelRows = (
      await db.execute(sql`
        SELECT type, COUNT(DISTINCT user_id)::int AS users
        FROM analytics_events
        WHERE type IN ('sign_up', 'steam_link', 'game_added', 'collection_created')
        GROUP BY type
      `)
    ).rows as Array<{ type: string; users: number }>;
    const byType = new Map(funnelRows.map((r) => [r.type, r.users]));
    const funnel = FUNNEL_STEPS.map(({ type, step }) => ({ step, users: byType.get(type) ?? 0 }));

    const dauRows = (
      await db.execute(sql`
        SELECT to_char(date_trunc('day', created_at), 'YYYY-MM-DD') AS day,
               COUNT(DISTINCT user_id)::int AS users
        FROM analytics_events
        WHERE user_id IS NOT NULL AND created_at > now() - interval '30 days'
        GROUP BY 1
        ORDER BY 1
      `)
    ).rows as Array<{ day: string; users: number }>;
    // fill gap days with 0 so the chart doesn't connect across quiet days
    const byDay = new Map(dauRows.map((r) => [r.day, r.users]));
    const dau: Array<{ day: string; users: number }> = [];
    for (let i = 29; i >= 0; i--) {
      const d = new Date(Date.now() - i * 86_400_000);
      const key = d.toISOString().slice(0, 10);
      dau.push({ day: key, users: byDay.get(key) ?? 0 });
    }

    const activeRows = (
      await db.execute(sql`
        SELECT COUNT(DISTINCT user_id) FILTER (WHERE created_at >= date_trunc('day', now()))::int AS today,
               COUNT(DISTINCT user_id) FILTER (WHERE created_at > now() - interval '7 days')::int AS wau,
               COUNT(DISTINCT user_id)::int AS mau
        FROM analytics_events
        WHERE user_id IS NOT NULL AND created_at > now() - interval '30 days'
      `)
    ).rows as Array<{ today: number; wau: number; mau: number }>;
    const active = activeRows[0] ?? { today: 0, wau: 0, mau: 0 };

    // sessionize activity pings: a >30-minute silence starts a new session,
    // and a session's length is last ping minus first ping
    const sessionRows = (
      await db.execute(sql`
        WITH pings AS (
          SELECT user_id, created_at,
                 CASE WHEN lag(created_at) OVER w IS NULL
                        OR created_at - lag(created_at) OVER w > interval '${sql.raw(SESSION_GAP)}'
                      THEN 1 ELSE 0 END AS boundary
          FROM analytics_events
          WHERE user_id IS NOT NULL AND created_at > now() - interval '30 days'
          WINDOW w AS (PARTITION BY user_id ORDER BY created_at)
        ),
        sess AS (
          SELECT user_id, created_at,
                 SUM(boundary) OVER (PARTITION BY user_id ORDER BY created_at) AS sid
          FROM pings
        )
        SELECT COUNT(*)::int AS sessions,
               COALESCE(AVG(dur), 0)::float8 AS avg_seconds
        FROM (
          SELECT EXTRACT(EPOCH FROM max(created_at) - min(created_at)) AS dur
          FROM sess
          GROUP BY user_id, sid
        ) d
      `)
    ).rows as Array<{ sessions: number; avg_seconds: number }>;
    const sessions = sessionRows[0] ?? { sessions: 0, avg_seconds: 0 };

    const [userRow] = await db.select({ n: count() }).from(schema.user);
    const [entryRow] = await db.select({ n: count() }).from(schema.userGames);
    const totalUsers = userRow?.n ?? 0;
    const totalLibraryEntries = entryRow?.n ?? 0;

    const overview: AdminAnalyticsOverview = {
      funnel,
      dau,
      engagement: {
        dauToday: active.today,
        wau: active.wau,
        mau: active.mau,
        totalUsers,
        totalLibraryEntries,
        avgGamesPerUser: totalUsers > 0 ? totalLibraryEntries / totalUsers : 0,
        avgSessionMinutes: sessions.avg_seconds / 60,
        sessions30d: sessions.sessions,
      },
    };
    return overview;
  });

  app.get("/api/admin/analytics/scrapers", async (request, reply) => {
    const user = await requireAdmin(request, reply);
    if (!user) return;
    await flushEvents();

    const sourceRows = (
      await db.execute(sql`
        SELECT meta->>'source' AS source,
               COUNT(*)::int AS total,
               COUNT(*) FILTER (WHERE (meta->>'ok')::boolean)::int AS ok,
               to_char(max(created_at) AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"') AS last_at
        FROM analytics_events
        WHERE type = 'scrape' AND created_at > now() - interval '7 days'
        GROUP BY 1
        ORDER BY 1
      `)
    ).rows as Array<{ source: string; total: number; ok: number; last_at: string | null }>;

    const failureRows = (
      await db.execute(sql`
        SELECT meta->>'source' AS source,
               meta->>'detail' AS detail,
               to_char(created_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"') AS at
        FROM analytics_events
        WHERE type = 'scrape'
          AND NOT (meta->>'ok')::boolean
          AND created_at > now() - interval '7 days'
        ORDER BY created_at DESC
        LIMIT 20
      `)
    ).rows as Array<{ source: string; detail: string | null; at: string }>;

    const health: ScraperHealth = {
      since: new Date(Date.now() - 7 * 86_400_000).toISOString(),
      sources: sourceRows.map((r) => ({
        source: r.source,
        total: r.total,
        ok: r.ok,
        rate: r.total > 0 ? r.ok / r.total : 0,
        lastAt: r.last_at,
      })),
      failures: failureRows,
    };
    return health;
  });
}
