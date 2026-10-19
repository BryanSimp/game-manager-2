import { and, asc, eq, inArray, sql } from "drizzle-orm";
import { MAIN_LIST_KIND, type ChecklistKind } from "@gm/shared";
import { db, schema } from "../db/index.js";
import { logEvent } from "./analytics.js";
import { inspectAll } from "./content-filter.js";
import { publishModeFor } from "./preferences.js";
import { ServiceError } from "./service-error.js";

/**
 * Making a progress list, adding entries to it and ticking them off — shared
 * by the web routes (`routes/checklists.ts`) and the MCP `create_checklist`
 * and `tick_checklist_items` tools, so both hold a list to the same limits,
 * the same content filter, the same one-main-story-list-per-game rule and the
 * same own-lists-only rule for progress.
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

/** One entry on a list, with whether this user has ticked it. */
export interface ChecklistItemState {
  id: string;
  position: number;
  text: string;
  category: string | null;
  completedAt: Date | null;
}

/**
 * A list's entries with this user's ticks, in the order the Progress tab
 * draws them: by position, then text. `GET /api/checklists/:id` returns this,
 * and the MCP tools number entries from it, so "item 12" is the twelfth row
 * on screen.
 */
export async function loadChecklistItems(
  userId: string,
  templateId: string,
): Promise<ChecklistItemState[]> {
  return db
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
        eq(schema.userChecklistItems.userId, userId),
      ),
    )
    .where(eq(schema.checklistItems.templateId, templateId))
    .orderBy(asc(schema.checklistItems.position), asc(schema.checklistItems.text));
}

/** Tick or untick entries already known to be on one of the user's lists; how many rows changed. */
async function writeTicks(userId: string, itemIds: string[], done: boolean): Promise<number> {
  if (itemIds.length === 0) return 0;
  if (done) {
    const inserted = await db
      .insert(schema.userChecklistItems)
      .values(itemIds.map((itemId) => ({ userId, itemId })))
      .onConflictDoNothing()
      .returning({ itemId: schema.userChecklistItems.itemId });
    return inserted.length;
  }
  const deleted = await db
    .delete(schema.userChecklistItems)
    .where(
      and(
        eq(schema.userChecklistItems.userId, userId),
        inArray(schema.userChecklistItems.itemId, itemIds),
      ),
    )
    .returning({ itemId: schema.userChecklistItems.itemId });
  return deleted.length;
}

/**
 * Tick (or untick) entries on one of your own lists — `PUT
 * /api/checklists/:id/items/check` and the MCP `tick_checklist_items` tool.
 *
 * Own lists only: progress on someone's published list means adopting it
 * first. The ids are re-checked against the template, so a caller can't tick
 * off someone else's list by guessing ids — ones that aren't on this list are
 * dropped, not refused. Exactly the ids given are written; a sequential
 * list's fill-in is worked out by the caller (`throughLastTarget`), because
 * the web app sends the filled-in ids itself.
 *
 * `matched` is how many of the ids were on the list; `changed` how many of
 * those weren't already in the state asked for.
 */
export async function setChecklistItemsDone(
  userId: string,
  templateId: string,
  itemIds: string[],
  done: boolean,
): Promise<{ checklist: ChecklistTemplate; matched: number; changed: number }> {
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
  if (itemIds.length === 0) return { checklist, matched: 0, changed: 0 };

  const onList = await db
    .select({ id: schema.checklistItems.id })
    .from(schema.checklistItems)
    .where(
      and(
        eq(schema.checklistItems.templateId, checklist.id),
        inArray(schema.checklistItems.id, itemIds),
      ),
    );
  const changed = await writeTicks(
    userId,
    onList.map((it) => it.id),
    done,
  );
  return { checklist, matched: onList.length, changed };
}

/** One entry, by its id alone — `PUT /api/checklists/items/:itemId/check`. Own lists only. */
export async function setChecklistItemDone(
  userId: string,
  itemId: string,
  done: boolean,
): Promise<{ changed: number }> {
  const [row] = await db
    .select({
      itemId: schema.checklistItems.id,
      authorUserId: schema.checklistTemplates.authorUserId,
    })
    .from(schema.checklistItems)
    .innerJoin(
      schema.checklistTemplates,
      eq(schema.checklistItems.templateId, schema.checklistTemplates.id),
    )
    .where(eq(schema.checklistItems.id, itemId));
  if (!row || row.authorUserId !== userId) throw new ServiceError(404, "Item not found");
  return { changed: await writeTicks(userId, [row.itemId], done) };
}

/**
 * Does ticking an entry on this list also tick everything before it? Only on
 * a sequential main story list — you can't have reached mission 15 without
 * 1–14. The Progress tab only draws the switch on the main story list, so a
 * sequential flag on an extra (settable only through the raw PATCH) isn't
 * something anyone chose to see fill in.
 */
export function fillsInSequence(checklist: Pick<ChecklistTemplate, "kind" | "sequential">): boolean {
  return checklist.kind === MAIN_LIST_KIND && checklist.sequential;
}

/**
 * The unticked entries before the last of `targets`, in list order — what a
 * sequential list fills in when those targets are ticked. The Progress tab
 * does the same for one entry (`items.slice(0, index + 1)`); several targets
 * fill in through the furthest one.
 */
export function throughLastTarget(items: ChecklistItemState[], targets: ReadonlySet<string>): string[] {
  let last = -1;
  items.forEach((it, i) => {
    if (targets.has(it.id)) last = i;
  });
  return items
    .slice(0, last + 1)
    .filter((it) => !it.completedAt && !targets.has(it.id))
    .map((it) => it.id);
}
