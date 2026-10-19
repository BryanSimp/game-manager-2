import { and, asc, eq, sql } from "drizzle-orm";
import { MAIN_LIST_KIND, type ChecklistKind } from "@gm/shared";
import { db, schema } from "../db/index.js";
import { logEvent } from "./analytics.js";
import { inspectAll } from "./content-filter.js";
import { publishModeFor } from "./preferences.js";
import { ServiceError } from "./service-error.js";

/**
 * Making a progress list and adding entries to it — shared by the web routes
 * (`routes/checklists.ts`) and the MCP `create_checklist` tool, so both hold
 * a list to the same limits, the same content filter and the same
 * one-main-story-list-per-game rule.
 */

export const CHECKLIST_TITLE_MAX = 200;
export const CHECKLIST_ENTRY_MAX = 500;
export const CHECKLIST_CHAPTER_MAX = 100;
/** The most entries one request may write — a long story's worth. */
export const MAX_CHECKLIST_ENTRIES_PER_WRITE = 500;

export type ChecklistTemplate = typeof schema.checklistTemplates.$inferSelect;

/** One entry as a caller hands it over. `category` is the entry's chapter. */
export interface ChecklistEntryInput {
  text: string;
  category?: string | null;
}

/** Where a new list lands among this user's lists for the game. */
export async function nextPosition(userId: string, gameId: string): Promise<number> {
  const [row] = await db
    .select({ max: sql<number>`coalesce(max(${schema.checklistTemplates.position}), 0)::int` })
    .from(schema.checklistTemplates)
    .where(
      and(
        eq(schema.checklistTemplates.gameId, gameId),
        eq(schema.checklistTemplates.authorUserId, userId),
      ),
    );
  return (row?.max ?? 0) + 1;
}

/**
 * Your main-story list for a game, if you have one. You get one per game.
 *
 * It's the list `estimateProgress` divides the how-long-to-beat figure
 * across, so a second one would mean two different answers to "how much is
 * left". Extra lists are unlimited precisely because they're untimed.
 * Duplicates from before this rule still exist, which is why the estimate
 * keeps its own oldest-wins tiebreak rather than trusting this alone — and
 * why this returns the oldest too.
 */
export async function mainListOf(userId: string, gameId: string): Promise<ChecklistTemplate | null> {
  const [row] = await db
    .select()
    .from(schema.checklistTemplates)
    .where(
      and(
        eq(schema.checklistTemplates.gameId, gameId),
        eq(schema.checklistTemplates.authorUserId, userId),
        eq(schema.checklistTemplates.kind, MAIN_LIST_KIND),
      ),
    )
    .orderBy(asc(schema.checklistTemplates.createdAt))
    .limit(1);
  return row ?? null;
}

export async function hasMainList(userId: string, gameId: string): Promise<boolean> {
  return (await mainListOf(userId, gameId)) !== null;
}

/** Trimmed, with blank entries dropped and a blank chapter meaning none. */
function cleanEntries(entries: ChecklistEntryInput[]): Array<{ text: string; category: string | null }> {
  return entries
    .map((e) => ({ text: e.text.trim(), category: e.category?.trim() || null }))
    .filter((e) => e.text.length > 0);
}

/** Refuse text that shouldn't be shared, saying which rule it hit. */
function rejectBadContent(userId: string, texts: Array<string | null | undefined>): void {
  const issue = inspectAll(texts);
  if (!issue) return;
  logEvent("content_blocked", userId, { surface: "checklist", kind: issue.kind });
  throw new ServiceError(400, issue.message);
}

/**
 * Make a list for a game, with its entries in the order given.
 *
 * `visibility` says who decides whether it starts published, as with
 * collections:
 *  - `"preference"` — the web app's rule: published at once under the
 *    `always` publish mode, private otherwise.
 *  - `"private"` — always private. The MCP tool uses this: publishing is a
 *    deliberate act, and a model building lists on your behalf isn't making it.
 *
 * `sequential` (ticking entry N fills in 1..N-1) only ever applies to a main
 * story list — it's the only one whose order means anything, and the only one
 * the Progress tab shows the switch for.
 */
export async function createChecklist(
  userId: string,
  gameId: string,
  input: {
    title: string;
    kind: ChecklistKind;
    entries?: ChecklistEntryInput[];
    sequential?: boolean;
  },
  visibility: "preference" | "private",
): Promise<{ checklist: ChecklistTemplate; entries: number }> {
  const [game] = await db
    .select({ id: schema.games.id })
    .from(schema.games)
    .where(eq(schema.games.id, gameId));
  if (!game) throw new ServiceError(404, "Game not found");

  const title = input.title.trim();
  if (!title) throw new ServiceError(400, "Title is required");
  const entries = cleanEntries(input.entries ?? []);
  // every entry goes through the filter alongside the title, so there is
  // nothing left unscanned for "publish automatically" to expose
  rejectBadContent(userId, [title, ...entries.flatMap((e) => [e.text, e.category])]);

  if (input.kind === MAIN_LIST_KIND && (await hasMainList(userId, game.id))) {
    throw new ServiceError(409, "You already have a main story list for this game");
  }

  const isPublic = visibility === "preference" && (await publishModeFor(userId)) === "always";
  const position = await nextPosition(userId, game.id);
  // the list and its entries together, so a failure between the two can't
  // leave an empty list behind
  const checklist = await db.transaction(async (tx) => {
    const [tpl] = await tx
      .insert(schema.checklistTemplates)
      .values({
        gameId: game.id,
        authorUserId: userId,
        title,
        kind: input.kind,
        sequential: input.kind === MAIN_LIST_KIND && input.sequential === true,
        isPublic,
        position,
      })
      .returning();
    if (entries.length > 0) {
      await tx
        .insert(schema.checklistItems)
        .values(entries.map((e, i) => ({ templateId: tpl!.id, position: i, ...e })));
    }
    return tpl!;
  });
  return { checklist, entries: entries.length };
}

/** What makes two entries "the same entry": chapter and text, ignoring case. */
const entryKey = (e: { text: string; category: string | null }) =>
  `${(e.category ?? "").toLowerCase()}\u0000${e.text.toLowerCase()}`;

/**
 * Append entries to the end of one of your lists, in the order given.
 *
 * With `skipExisting`, an entry the list already has (same chapter and text,
 * ignoring case) is counted in `already` instead of added — the MCP tool's
 * rule, so sending the same call twice doesn't double the list. It counts
 * occurrences rather than collapsing them: a first call may add "Mask Shard"
 * four times, and repeating it adds none, because the list already has four.
 * The web app adds what you typed, every time.
 */
export async function addChecklistEntries(
  userId: string,
  templateId: string,
  input: ChecklistEntryInput[],
  options: { skipExisting?: boolean } = {},
): Promise<{
  checklist: ChecklistTemplate;
  added: Array<{ id: string; position: number }>;
  already: number;
  total: number;
}> {
  const [checklist] = await db
    .select()
    .from(schema.checklistTemplates)
    .where(
      and(
        eq(schema.checklistTemplates.id, templateId),
        eq(schema.checklistTemplates.authorUserId, userId),
      ),
    );
  if (!checklist) throw new ServiceError(404, "Checklist not found");

  const entries = cleanEntries(input);
  if (entries.length === 0) throw new ServiceError(400, "Item text is required");
  rejectBadContent(userId, entries.flatMap((e) => [e.text, e.category]));

  const existing = await db
    .select({
      text: schema.checklistItems.text,
      category: schema.checklistItems.category,
      position: schema.checklistItems.position,
    })
    .from(schema.checklistItems)
    .where(eq(schema.checklistItems.templateId, checklist.id));

  let fresh = entries;
  if (options.skipExisting) {
    const onList = new Map<string, number>();
    for (const e of existing) onList.set(entryKey(e), (onList.get(entryKey(e)) ?? 0) + 1);
    fresh = entries.filter((e) => {
      const left = onList.get(entryKey(e)) ?? 0;
      if (left === 0) return true;
      onList.set(entryKey(e), left - 1);
      return false;
    });
  }

  const start = existing.reduce((max, e) => Math.max(max, e.position), -1) + 1;
  const added =
    fresh.length === 0
      ? []
      : await db
          .insert(schema.checklistItems)
          .values(fresh.map((e, i) => ({ templateId: checklist.id, position: start + i, ...e })))
          .returning({ id: schema.checklistItems.id, position: schema.checklistItems.position });
  return {
    checklist,
    added,
    already: entries.length - fresh.length,
    total: existing.length + added.length,
  };
}
