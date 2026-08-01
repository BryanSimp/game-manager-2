import { and, asc, eq, sql } from "drizzle-orm";
import { BUILTIN_CATEGORIES, isBuiltinCategory, type CategoryView } from "@gm/shared";
import { db, schema } from "../db/index.js";

/**
 * Categories are half built-in, half user-defined. Built-ins live in
 * `BUILTIN_CATEGORIES` and can be recoloured through preferences but never
 * removed; custom ones are rows the user owns. Both resolve to the same
 * `CategoryView`, so the UI renders a chip without caring which it is.
 *
 * `user_games.status` holds either a built-in key or a custom category id,
 * which is why renaming a custom category doesn't touch any game rows.
 */
export async function listCategories(userId: string): Promise<CategoryView[]> {
  const [prefs] = await db
    .select({ statusColors: schema.userPreferences.statusColors })
    .from(schema.userPreferences)
    .where(eq(schema.userPreferences.userId, userId));
  const colors = (prefs?.statusColors as Record<string, string> | null) ?? {};

  const customs = await db
    .select()
    .from(schema.customCategories)
    .where(eq(schema.customCategories.userId, userId))
    .orderBy(asc(schema.customCategories.sortOrder), asc(schema.customCategories.name));

  const counts = await db
    .select({ status: schema.userGames.status, count: sql<number>`count(*)::int` })
    .from(schema.userGames)
    .where(eq(schema.userGames.userId, userId))
    .groupBy(schema.userGames.status);
  const byStatus = new Map(counts.map((c) => [c.status, c.count]));

  const builtIns: CategoryView[] = BUILTIN_CATEGORIES.map((c, i) => ({
    key: c.key,
    label: c.label,
    color: colors[c.key] ?? c.color,
    builtIn: true,
    sortOrder: i,
    count: byStatus.get(c.key) ?? 0,
  }));

  const custom: CategoryView[] = customs.map((c, i) => ({
    key: c.id,
    label: c.name,
    color: c.color ?? "#71717a",
    builtIn: false,
    // after every built-in, preserving the user's own ordering
    sortOrder: BUILTIN_CATEGORIES.length + (c.sortOrder || i),
    count: byStatus.get(c.id) ?? 0,
  }));

  return [...builtIns, ...custom].sort((a, b) => a.sortOrder - b.sortOrder);
}

/**
 * Is this a category the user may file a game under? Guards every write that
 * accepts a status, since the column is plain text now.
 */
export async function isValidCategory(userId: string, key: string): Promise<boolean> {
  if (isBuiltinCategory(key)) return true;
  // a custom category only counts for the user who owns it, so match on both
  // — otherwise one user could file games under another's category id
  if (!UUID_RE.test(key)) return false;
  const [row] = await db
    .select({ id: schema.customCategories.id })
    .from(schema.customCategories)
    .where(
      and(eq(schema.customCategories.id, key), eq(schema.customCategories.userId, userId)),
    );
  return !!row;
}

// a non-uuid custom key can't exist, and passing one to a uuid column throws
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
