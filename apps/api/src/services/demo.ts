import { and, asc, eq, sql } from "drizzle-orm";
import type { PgColumn } from "drizzle-orm/pg-core";
import { db, schema } from "../db/index.js";

/**
 * The read-only demo tour.
 *
 * Anyone can look round a populated library before signing up. Rather than
 * building a second, fake version of the app — which would rot the moment a
 * real screen changed — the demo is a **real seeded account** served through
 * the real routes, with two rules enforced in exactly two places:
 *
 *  1. A request opts in with the `x-gm-demo` header, and gets the demo user
 *     back from `getSessionUser` as if it had signed in as them.
 *  2. `server.ts` refuses any demo request that isn't a read. That single
 *     hook is the whole safety property — no route needs to know about the
 *     demo, and a route added next year is covered without being told.
 *
 * The demo accounts (`user.is_demo`) have no `account` row, so there are no
 * credentials to leak and nobody can sign in as one by any other path.
 */

/** Opt-in header. A header, not a cookie: nothing about it should persist. */
export const DEMO_HEADER = "x-gm-demo";

/**
 * Admin curation of the demo library.
 *
 * "Edit the demo" doesn't get a bespoke CRUD screen, because the app already
 * has twenty of them. An admin sends this header instead and every route acts
 * on the demo account's data through the ordinary Library, Collections and
 * Progress UIs — the tour is curated with the same tools it's showing off.
 *
 * A **different header from the tour's** on purpose: the write block keys on
 * `x-gm-demo`, so an edit session isn't refused, and no request can be both.
 * It is honoured only for a signed-in admin (see `plugins/auth.ts`); from
 * anyone else it's an inert string.
 */
export const DEMO_EDIT_HEADER = "x-gm-demo-edit";

export function isDemoEditRequest(headers: Record<string, unknown>): boolean {
  const value = headers[DEMO_EDIT_HEADER];
  return value === "1" || value === "true";
}

/** Methods a demo visitor may use. Everything else is refused up front. */
const READ_METHODS = new Set(["GET", "HEAD", "OPTIONS"]);

export function isDemoRequest(headers: Record<string, unknown>): boolean {
  const value = headers[DEMO_HEADER];
  return value === "1" || value === "true";
}

export function isReadMethod(method: string): boolean {
  return READ_METHODS.has(method.toUpperCase());
}

interface DemoUser {
  id: string;
  email: string;
  name: string;
}

/**
 * Cached because it's looked up on every demo request and changes roughly
 * never. The TTL is short and applies to misses as well as hits, so seeding
 * the demo on a running server starts working within a minute rather than
 * needing a restart.
 */
let cached: { at: number; user: DemoUser | null } | null = null;
const TTL_MS = 60_000;

export async function demoUser(): Promise<DemoUser | null> {
  if (cached && Date.now() - cached.at < TTL_MS) return cached.user;
  const [row] = await db
    .select({ id: schema.user.id, email: schema.user.email, name: schema.user.name })
    .from(schema.user)
    .where(and(eq(schema.user.isDemo, true), eq(schema.user.role, "user")))
    // the tour account is the oldest demo row; the seed creates it before the
    // friend accounts that exist only to populate its friends list
    .orderBy(asc(schema.user.createdAt))
    .limit(1);
  cached = { at: Date.now(), user: row ?? null };
  return cached.user;
}

/** Called by the seed so a freshly seeded demo is live immediately. */
export function clearDemoCache(): void {
  cached = null;
}

/**
 * "…and this row's user isn't a demo account", as a SQL fragment.
 *
 * Seeded ratings and play times are invented, so they must not move the
 * averages real players see. A correlated NOT EXISTS rather than a fetched id
 * list: it's one statement instead of a round trip per aggregate, and it
 * stays correct if the demo is reseeded mid-request.
 */
export function notDemoUser(userIdColumn: PgColumn) {
  return sql`NOT EXISTS (
    SELECT 1 FROM ${schema.user}
    WHERE ${schema.user.id} = ${userIdColumn} AND ${schema.user.isDemo}
  )`;
}
