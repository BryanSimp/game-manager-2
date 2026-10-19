import { and, asc, eq } from "drizzle-orm";
import { alias } from "drizzle-orm/pg-core";
import { EXTRA_LIST_KIND, GAME_LINK_ROLE_META, MAIN_LIST_KIND, type OwnershipFormat } from "@gm/shared";
import { db, schema } from "../db/index.js";
import { logEvent } from "./analytics.js";
import {
  deleteChecklist,
  editChecklistEntries,
  loadChecklistItems,
  updateChecklist,
  type ChecklistTemplate,
} from "./checklists.js";
import {
  deleteCollection,
  orderCollection,
  removeGamesFromCollection,
  updateCollection,
} from "./collections.js";
import { ownTimes } from "./community.js";
import { unlinkGames } from "./game-links.js";
import {
  deleteLibraryEntry,
  setEntryPlatforms,
  updateLibraryEntries,
  updateLibraryEntry,
  type EntryUpdate,
  type Ownership,
} from "./library-entries.js";
import {
  CHECKLIST_KIND_INPUTS,
  LINK_SENTENCE,
  McpToolError,
  UUID,
  categoriesFor,
  compactEntry,
  findOwnedCollection,
  fold,
  gameResolver,
  hours,
  libraryIndex,
  listKindName,
  listNames,
  listsOf,
  ownedEntry,
  pickByTitle,
  pickList,
  requireWrite,
  resolveCategory,
  resolveEntries,
  tagSummary,
  titleKey,
  withIds,
  type LibraryRow,
  type McpAccess,
  type Miss,
} from "./mcp-tools.js";
import { deleteTag, findTagByName, tagUsage, updateTag, type Tag } from "./tags.js";
import { loadMyChecklists } from "../routes/checklists.js";
import { gameLinksFor } from "../routes/games.js";
import { loadEntryProgress, loadLibraryEntries } from "../routes/library.js";

/**
 * The MCP tools that change or remove what's already there — the half of
 * `services/mcp-tools.ts`'s write tools that aren't additive. Phase 34
 * opened them up after a real session tidying a 594-game library hit every
 * one of these walls: a category that couldn't be fixed, finish dates before
 * start dates, forty mistaken tags only the web app could delete, a wrong
 * link with no undo, a mission list in the wrong order.
 *
 * Three rules, the same as the additive tools: every one checks the
 * credential allows changes (`requireWrite`), goes through the service the
 * matching web route uses (so validation and ownership are the app's own),
 * and touches nothing but the caller's library. A fourth for these: **a
 * delete shows before it removes.** `delete_game`, `delete_tags`,
 * `delete_checklist` and `delete_collection` answer a call without
 * `confirm: true` with what *would* go, and change nothing — so the model
 * can put that in front of the user before it's gone. Still not here:
 * publishing, and anything on the account.
 */

/** Equal as the tools report them — arrays and nulls included. */
function sameValue(a: unknown, b: unknown): boolean {
  return JSON.stringify(a) === JSON.stringify(b);
}

/** Long text, cut to something a result can carry. */
function clip(text: string | null, max = 300): string | null {
  if (text === null || text.length <= max) return text;
  return `${text.slice(0, max)}…`;
}

const PREVIEW_NOTE =
  "Nothing was deleted. Tell the user what this would remove, and call again with confirm: true once they've agreed.";

// ---------------------------------------------------------------------------
// Games

interface PlatformRow {
  id: string;
  name: string;
  abbreviation: string | null;
  parentName: string | null;
}

async function platformRows(): Promise<PlatformRow[]> {
  const parent = alias(schema.platforms, "parent_platform");
  return db
    .select({
      id: schema.platforms.id,
      name: schema.platforms.name,
      abbreviation: schema.platforms.abbreviation,
      parentName: parent.name,
    })
    .from(schema.platforms)
    .leftJoin(parent, eq(schema.platforms.parentPlatformId, parent.id))
    .orderBy(asc(schema.platforms.sortOrder), asc(schema.platforms.name));
}

/**
 * The platform a name means: its full name first ("Game Boy Advance"), then
 * its abbreviation ("GBA") — punctuation and case aside, like titles. Two
 * platforms answering to the same thing is an error naming both rather than
 * a guess.
 */
function findPlatform(rows: PlatformRow[], input: string): PlatformRow | string {
  const key = titleKey(input);
  const byName = rows.filter((r) => titleKey(r.name) === key);
  const byAbbreviation = rows.filter((r) => r.abbreviation !== null && titleKey(r.abbreviation) === key);
  const hits = byName.length > 0 ? byName : byAbbreviation;
  if (hits.length === 1) return hits[0]!;
  if (hits.length > 1) {
    return `"${input}" could be ${hits.map((h) => `"${h.name}"`).join(" or ")} — use the full name.`;
  }
  const close = key ? rows.filter((r) => titleKey(r.name).includes(key) || (r.abbreviation && titleKey(r.abbreviation).includes(key))) : [];
  return close.length > 0
    ? `No platform called "${input}". Did you mean: ${close.slice(0, 8).map((r) => r.name).join(", ")}?`
    : `No platform called "${input}". Platforms: ${rows.map((r) => r.name).join(", ")}.`;
}

/** A platform as the tools name it: "Steam (PC)" for a storefront. */
function platformLabel(p: { platform: string; partOf?: string; format: string }): string {
  return `${p.platform}${p.partOf ? ` (${p.partOf})` : ""}, ${p.format}`;
}

export const PLATFORM_MODES = ["add", "replace", "remove"] as const;

export async function toolUpdateGame(
  access: McpAccess,
  args: {
    game: string;
    category?: string;
    rating?: number | null;
    startedAt?: string | null;
    finishedAt?: string | null;
    notes?: string | null;
    completed100?: boolean;
    endless?: boolean;
    platforms?: Array<{ platform: string; format?: OwnershipFormat }>;
    platformMode?: (typeof PLATFORM_MODES)[number];
  },
) {
  requireWrite(access);
  const fields: EntryUpdate = {};
  if (args.rating !== undefined) fields.rating = args.rating;
  if (args.startedAt !== undefined) fields.startedAt = args.startedAt;
  if (args.finishedAt !== undefined) fields.finishedAt = args.finishedAt;
  if (args.notes !== undefined) fields.notes = args.notes;
  if (args.completed100 !== undefined) fields.completed100 = args.completed100;
  if (args.endless !== undefined) fields.ttbEnabled = !args.endless;
  if (args.category === undefined && Object.keys(fields).length === 0 && args.platforms === undefined) {
    throw new McpToolError(
      "Nothing to change: give at least one of category, rating, startedAt, finishedAt, notes, completed100, endless or platforms.",
    );
  }

  const entry = await ownedEntry(access.userId, args.game);
  const categories = await categoriesFor(access.userId);
  if (args.category !== undefined) fields.status = resolveCategory(categories, args.category).key;

  // every platform is resolved before anything is written, so a typo in the
  // third one can't leave the first two half-applied
  const mode = args.platformMode ?? "add";
  let ownership: Ownership[] | null = null;
  if (args.platforms !== undefined) {
    const rows = await platformRows();
    ownership = [];
    for (const p of args.platforms) {
      const hit = findPlatform(rows, p.platform);
      if (typeof hit === "string") throw new McpToolError(hit);
      if (mode !== "remove" && !p.format) {
        throw new McpToolError(`Say whether "${hit.name}" is physical or digital (format).`);
      }
      // removing ignores format, so either value stands in
      ownership.push({ platformId: hit.id, format: p.format ?? "digital" });
    }
    if (mode !== "replace" && ownership.length === 0) {
      throw new McpToolError(`Name at least one platform to ${mode}, or use platformMode "replace" with [] to clear them.`);
    }
  }

  const [before] = await loadLibraryEntries(access.userId, entry.id);
  let stamped: Array<"startedAt" | "finishedAt"> = [];
  if (Object.keys(fields).length > 0) {
    ({ stamped } = await updateLibraryEntry(access.userId, entry.id, fields));
  }
  if (ownership) await setEntryPlatforms(access.userId, entry.id, ownership, mode);
  const [after] = await loadLibraryEntries(access.userId, entry.id);

  const was = compactEntry(before!, categories);
  const now = compactEntry(after!, categories);
  const compared = {
    category: [was.category, now.category],
    rating: [was.rating, now.rating],
    startedAt: [was.startedAt, now.startedAt],
    finishedAt: [was.finishedAt, now.finishedAt],
    notes: [before!.entry.notes, after!.entry.notes],
    completed100: [was.completed100, now.completed100],
    endless: [was.endless, now.endless],
    platforms: [was.platforms.map(platformLabel), now.platforms.map(platformLabel)],
  } as const;
  // compared in full, reported clipped: a long note edited near its end
  // still counts as changed
  const changed = Object.fromEntries(
    Object.entries(compared)
      .filter(([, [from, to]]) => !sameValue(from, to))
      .map(([key, [from, to]]) =>
        key === "notes" ? [key, { from: clip(from as string | null), to: clip(to as string | null) }] : [key, { from, to }],
      ),
  );

  const notes: string[] = [];
  for (const field of stamped) {
    notes.push(
      field === "startedAt"
        ? "startedAt was set to today, as the app does the first time a game becomes Playing — pass startedAt to give the real date."
        : "finishedAt was set to today, as the app does the first time a game becomes Finished — pass finishedAt to give the real date.",
    );
  }
  if (now.startedAt && now.finishedAt && now.finishedAt < now.startedAt) {
    notes.push(`Its finish date (${now.finishedAt}) is still before its start date (${now.startedAt}) — set one of them to fix it.`);
  }
  if (args.endless !== undefined && now.endless) {
    notes.push("Marked endless, so it no longer counts toward backlog hours.");
  }

  logEvent("mcp_write", access.userId, {
    tool: "update_game",
    fields: Object.keys(changed).length,
    platformMode: ownership ? mode : null,
  });
  return {
    game: entry.title,
    id: entry.id,
    changed,
    ...(Object.keys(changed).length === 0 ? { unchanged: true } : {}),
    ...(notes.length > 0 ? { note: notes.join(" ") } : {}),
  };
}

export async function toolUpdateGames(
  access: McpAccess,
  args: { games: string[]; category?: string; endless?: boolean; completed100?: boolean },
) {
  requireWrite(access);
  if (args.category === undefined && args.endless === undefined && args.completed100 === undefined) {
    throw new McpToolError("Nothing to change: give category, endless or completed100.");
  }
  const categories = await categoriesFor(access.userId);
  const category = args.category !== undefined ? resolveCategory(categories, args.category) : null;
  const { found, missing } = resolveEntries(await libraryIndex(access.userId), args.games);
  const ids = [...new Set(found.map((f) => f.id))];
  const { updated } = await updateLibraryEntries(access.userId, ids, {
    status: category?.key,
    ttbEnabled: args.endless === undefined ? undefined : !args.endless,
    completed100: args.completed100,
  });

  const titleOf = new Map(found.map((f) => [f.id, f.title]));
  const moved = updated.filter(
    (r) =>
      (category !== null && r.status !== category.key) ||
      (args.endless !== undefined && r.ttbEnabled === args.endless) ||
      (args.completed100 !== undefined && r.completed100 !== args.completed100),
  );
  const stampColumn = category?.key === "playing" ? "startedAt" : category?.key === "finished" ? "finishedAt" : null;
  const stamped = stampColumn ? updated.filter((r) => r[stampColumn] === null).length : 0;

  logEvent("mcp_write", access.userId, {
    tool: "update_games",
    changed: moved.length,
    unchanged: updated.length - moved.length,
    notFound: missing.length,
  });
  return {
    set: {
      ...(category ? { category: category.label } : {}),
      ...(args.endless !== undefined ? { endless: args.endless } : {}),
      ...(args.completed100 !== undefined ? { completed100: args.completed100 } : {}),
    },
    changed: moved.length,
    changedGames: moved.slice(0, 50).map((r) => titleOf.get(r.id)),
    // named, and already that way
    unchanged: updated.length - moved.length,
    notFound: missing,
    ...(stamped > 0
      ? {
          note: `${stamped} of them had no ${stampColumn} and got today's date, as the app does when a game first becomes ${category!.label} — update_game sets the real date.`,
        }
      : {}),
  };
}

export async function toolDeleteGame(access: McpAccess, args: { game: string; confirm?: boolean }) {
  requireWrite(access);
  const entry = await ownedEntry(access.userId, args.game);
  const [[loaded], categories, lists, own, links, inCollections] = await Promise.all([
    loadLibraryEntries(access.userId, entry.id),
    categoriesFor(access.userId),
    loadMyChecklists(access.userId, entry.gameId),
    ownTimes(access.userId, [entry.gameId]),
    gameLinksFor(access.userId, entry.gameId),
    db
      .select({ name: schema.collections.name })
      .from(schema.collectionGames)
      .innerJoin(schema.collections, eq(schema.collections.id, schema.collectionGames.collectionId))
      .where(and(eq(schema.collections.userId, access.userId), eq(schema.collectionGames.gameId, entry.gameId))),
  ]);
  const row = compactEntry(loaded!, categories);
  const linkCount = links.sections.reduce((n, s) => n + s.links.length, 0);
  const summary = {
    game: entry.title,
    id: entry.id,
    releaseYear: row.releaseYear,
    category: row.category,
    // what goes with the entry
    removes: {
      rating: row.rating,
      platforms: row.platforms.map(platformLabel),
      tags: row.tags,
      startedAt: row.startedAt,
      finishedAt: row.finishedAt,
      hasNotes: !!loaded!.entry.notes,
    },
    // kept, because they belong to the game rather than the entry — they're
    // back if the game is added again
    keeps: {
      checklists: lists.map((l) => `${l.title} (${l.doneCount}/${l.itemCount} ticked)`),
      collections: inCollections.map((c) => c.name),
      linkedGames: linkCount,
      yourTimeToBeat: own.has(entry.gameId),
    },
  };

  if (!args.confirm) {
    return { deleted: false, ...summary, note: PREVIEW_NOTE };
  }
  await deleteLibraryEntry(access.userId, entry.id);
  logEvent("mcp_write", access.userId, { tool: "delete_game", tags: row.tags.length, platforms: row.platforms.length });
  return {
    deleted: true,
    ...summary,
    note: "Removed from the library. Its checklists, links, collections and play time are kept, and come back if the game is added again.",
  };
}

// ---------------------------------------------------------------------------
// Tags

/** The user's tag with this name, or an error naming the tags they do have. */
async function tagOrError(userId: string, name: string): Promise<Tag> {
  const tag = await findTagByName(userId, name);
  if (tag) return tag;
  const all = await db
    .select({ name: schema.tags.name })
    .from(schema.tags)
    .where(eq(schema.tags.userId, userId));
  const names = all.map((t) => t.name).sort((a, b) => a.localeCompare(b));
  throw new McpToolError(`You have no tag called "${name}". Your tags: ${names.slice(0, 60).join(", ") || "none"}.`);
}

export async function toolListTags(userId: string, args: { group?: string }) {
  const tags = await db
    .select()
    .from(schema.tags)
    .where(eq(schema.tags.userId, userId))
    .orderBy(asc(schema.tags.groupName), asc(schema.tags.name));
  const shown = args.group === undefined ? tags : tags.filter((t) => fold(t.groupName ?? "") === fold(args.group!));
  const usage = await tagUsage(
    userId,
    shown.map((t) => t.id),
  );
  const groups = [...new Set(tags.map((t) => t.groupName).filter((g): g is string => !!g))];
  return {
    total: shown.length,
    groups,
    tags: shown.map((t) => ({ ...tagSummary(t), games: usage.get(t.id) ?? 0 })),
  };
}

export async function toolUpdateTag(
  access: McpAccess,
  args: { tag: string; name?: string; color?: string | null; group?: string | null },
) {
  requireWrite(access);
  if (args.name === undefined && args.color === undefined && args.group === undefined) {
    throw new McpToolError("Nothing to change: give a new name, color or group.");
  }
  const tag = await tagOrError(access.userId, args.tag);
  const updated = await updateTag(access.userId, tag.id, {
    ...(args.name !== undefined ? { name: args.name } : {}),
    ...(args.color !== undefined ? { color: args.color } : {}),
    ...(args.group !== undefined ? { groupName: args.group } : {}),
  });
  const games = (await tagUsage(access.userId, [tag.id])).get(tag.id) ?? 0;
  logEvent("mcp_write", access.userId, { tool: "update_tag", games });
  return { before: tagSummary(tag), tag: tagSummary(updated), games };
}

export async function toolDeleteTags(
  access: McpAccess,
  args: { tags?: string[]; group?: string; confirm?: boolean },
) {
  requireWrite(access);
  if (!args.tags?.length && args.group === undefined) {
    throw new McpToolError("Name the tags to delete, or a group to delete every tag in.");
  }
  const picked = new Map<string, Tag>();
  const notFound: Miss[] = [];
  for (const name of args.tags ?? []) {
    const tag = await findTagByName(access.userId, name);
    if (tag) picked.set(tag.id, tag);
    else notFound.push({ input: name, reason: `You have no tag called "${name}".` });
  }
  if (args.group !== undefined) {
    const inGroup = await db.select().from(schema.tags).where(eq(schema.tags.userId, access.userId));
    const hits = inGroup.filter((t) => fold(t.groupName ?? "") === fold(args.group!));
    if (hits.length === 0) notFound.push({ input: `group "${args.group}"`, reason: "None of your tags is in that group." });
    for (const t of hits) picked.set(t.id, t);
  }
  const usage = await tagUsage(access.userId, [...picked.keys()]);
  const listed = [...picked.values()]
    .sort((a, b) => a.name.localeCompare(b.name))
    .map((t) => ({ ...tagSummary(t), games: usage.get(t.id) ?? 0 }));
  const assignments = listed.reduce((n, t) => n + t.games, 0);

  if (!args.confirm || picked.size === 0) {
    return {
      deleted: 0,
      wouldDelete: listed,
      // how many tag-on-game assignments would go; the games themselves stay
      wouldUntag: assignments,
      notFound,
      ...(picked.size > 0 ? { note: PREVIEW_NOTE } : {}),
    };
  }
  for (const t of picked.values()) await deleteTag(access.userId, t.id);
  logEvent("mcp_write", access.userId, { tool: "delete_tags", deleted: picked.size, untagged: assignments });
  return { deleted: picked.size, tags: listed, untagged: assignments, notFound };
}

// ---------------------------------------------------------------------------
// Links

export async function toolUnlinkGames(access: McpAccess, args: { game: string; relatedGame: string }) {
  requireWrite(access);
  // a link is between catalog games that already exist: nothing to look up
  // on IGDB, so nothing new is pulled into the catalog
  const resolver = await gameResolver(access.userId, { igdb: false });
  const game = await resolver.resolve(args.game);
  if ("reason" in game) throw new McpToolError(game.reason);

  // the other end among the games linked to this one, so "A Link to the
  // Past" can't mean anything this game isn't actually linked to
  const links = await gameLinksFor(access.userId, game.gameId);
  const linked = links.sections.flatMap((s) =>
    s.links.map((l) => ({ id: l.game.id, title: l.game.title, userGameId: l.game.userGameId, role: s.role })),
  );
  const describe = () =>
    linked.length > 0
      ? `"${game.title}" is linked to: ${linked.map((l) => `${l.title} (${GAME_LINK_ROLE_META[l.role].section}, id ${l.id})`).join("; ")}.`
      : `"${game.title}" isn't linked to anything.`;
  const input = args.relatedGame.trim();
  let relatedId: string | null = null;
  if (UUID.test(input)) {
    relatedId = linked.find((l) => l.id === input || l.userGameId === input)?.id ?? null;
  } else {
    const picked = pickByTitle(
      [...new Map(linked.map((l) => [l.id, l])).values()],
      input,
      false,
    );
    if (picked.kind === "one") relatedId = picked.item.id;
    else if (picked.kind === "several") {
      throw new McpToolError(`"${input}" is ${picked.items.length} of the linked games — call again with the id: ${withIds(picked.items)}.`);
    }
  }
  if (!relatedId) throw new McpToolError(`"${game.title}" isn't linked to "${input}". ${describe()}`);

  const relatedTitle = linked.find((l) => l.id === relatedId)!.title;
  const removed = await unlinkGames(access.userId, game.gameId, relatedId);
  logEvent("mcp_write", access.userId, { tool: "unlink_games", removed: removed.length });
  return {
    removed: removed.length,
    unlinked: removed.map((r) => (r.role ? LINK_SENTENCE[r.role](game.title, relatedTitle) : `"${game.title}" ↔ "${relatedTitle}"`)),
    note: "The link is gone from both games' Linked tabs. link_games can link them again another way.",
  };
}

// ---------------------------------------------------------------------------
// Checklists

/** A game's list for these tools: the entry, the chosen list, and its siblings. */
async function gameList(userId: string, game: string, list: string | undefined) {
  const entry = await ownedEntry(userId, game);
  const lists = await listsOf(userId, entry.gameId);
  return { entry, lists, checklist: pickList(entry.title, lists, list) };
}

function listSummary(c: ChecklistTemplate) {
  return {
    title: c.title,
    kind: listKindName(c.kind),
    sequential: c.sequential,
    public: c.isPublic,
    source: c.source ?? c.sourceUrl,
  };
}

export async function toolUpdateChecklist(
  access: McpAccess,
  args: {
    game: string;
    list?: string;
    title?: string;
    kind?: (typeof CHECKLIST_KIND_INPUTS)[number];
    sequential?: boolean;
    source?: string | null;
  },
) {
  requireWrite(access);
  if (args.title === undefined && args.kind === undefined && args.sequential === undefined && args.source === undefined) {
    throw new McpToolError("Nothing to change: give a new title, kind, sequential or source.");
  }
  const { entry, lists, checklist } = await gameList(access.userId, args.game, args.list);
  if (args.title !== undefined) {
    const clash = lists.find((l) => l.id !== checklist.id && fold(l.title) === fold(args.title!));
    if (clash) {
      throw new McpToolError(`"${entry.title}" already has a list called "${clash.title}" — pick another title. Its checklists: ${listNames(lists)}.`);
    }
  }
  const kind = args.kind === undefined ? undefined : args.kind === "main_story" ? MAIN_LIST_KIND : EXTRA_LIST_KIND;
  if (kind === MAIN_LIST_KIND && checklist.kind !== MAIN_LIST_KIND) {
    const main = lists.find((l) => l.kind === MAIN_LIST_KIND);
    if (main) {
      throw new McpToolError(
        `"${entry.title}" already has a main story list, "${main.title}" — a game has only one. Make that one an extra first (update_checklist with kind "extra"), or add these items to it.`,
      );
    }
  }
  const updated = await updateChecklist(access.userId, checklist.id, {
    title: args.title,
    kind,
    sequential: args.sequential,
    source: args.source,
  });

  const before = listSummary(checklist);
  const after = listSummary(updated);
  const changed = Object.fromEntries(
    (Object.keys(after) as Array<keyof typeof after>)
      .filter((k) => !sameValue(before[k], after[k]))
      .map((k) => [k, { from: before[k], to: after[k] }]),
  );
  const notes: string[] = [];
  if (checklist.kind === MAIN_LIST_KIND && updated.kind !== MAIN_LIST_KIND) {
    notes.push("It was the game's main story list, so the game has no progress percentage now until another list becomes the main story.");
  }
  if (checklist.kind !== MAIN_LIST_KIND && updated.kind === MAIN_LIST_KIND) {
    notes.push("It's the main story list now: the game's progress percentage and hours remaining come from it.");
  }
  if (updated.isPublic && (args.title !== undefined || args.source !== undefined)) {
    notes.push("The list is published, so the change is public too.");
  }
  const progress = await loadEntryProgress(access.userId, entry.id);
  logEvent("mcp_write", access.userId, { tool: "update_checklist", fields: Object.keys(changed).length });
  return {
    game: entry.title,
    list: after,
    changed,
    gameProgress:
      progress && progress.total > 0
        ? { mainList: progress.checklistTitle, percent: progress.percent, remainingHours: hours(progress.remainingSeconds) }
        : null,
    ...(notes.length > 0 ? { note: notes.join(" ") } : {}),
  };
}

export async function toolEditChecklistItems(
  access: McpAccess,
  args: {
    game: string;
    list?: string;
    edit?: Array<{ number: number; text?: string; chapter?: string | null }>;
    remove?: number[];
    order?: number[];
  },
) {
  requireWrite(access);
  if (!args.edit?.length && !args.remove?.length && !args.order?.length) {
    throw new McpToolError("Nothing to change: give edit, remove or order.");
  }
  const { entry, checklist } = await gameList(access.userId, args.game, args.list);
  const items = await loadChecklistItems(access.userId, checklist.id);

  // every number is checked against the list as it stands before anything
  // is written: a stray one means the caller is working from a stale copy
  const problems: string[] = [];
  const idOf = (n: number, what: string) => {
    const it = items[n - 1];
    if (!it) problems.push(`${what} #${n}: "${checklist.title}" has ${items.length} items, numbered 1 to ${items.length}.`);
    return it?.id;
  };
  const twice = (ns: number[]) => ns.filter((n, i) => ns.indexOf(n) !== i);
  const removing = new Set(args.remove ?? []);
  for (const n of twice(args.remove ?? [])) problems.push(`#${n} is in remove twice.`);
  for (const n of twice((args.edit ?? []).map((e) => e.number))) problems.push(`#${n} is edited twice — put both changes in one edit.`);
  for (const n of twice(args.order ?? [])) problems.push(`#${n} is in order twice.`);
  for (const e of args.edit ?? []) {
    if (removing.has(e.number)) problems.push(`#${e.number} is both edited and removed.`);
    if (e.text === undefined && e.chapter === undefined) problems.push(`The edit for #${e.number} changes nothing — give text or chapter.`);
  }
  for (const n of args.order ?? []) if (removing.has(n)) problems.push(`#${n} is both removed and in order.`);
  const edits = (args.edit ?? []).map((e) => ({ id: idOf(e.number, "edit"), text: e.text, category: e.chapter }));
  const remove = (args.remove ?? []).map((n) => idOf(n, "remove"));
  const order = (args.order ?? []).map((n) => idOf(n, "order"));
  if (problems.length > 0) throw new McpToolError(`Nothing was changed. ${problems.join(" ")}`);

  const result = await editChecklistEntries(access.userId, checklist.id, {
    edits: edits.map((e) => ({ ...e, id: e.id! })),
    remove: remove as string[],
    order: order as string[],
  });
  const left = items.filter((_, i) => !removing.has(i + 1));
  const progress = await loadEntryProgress(access.userId, entry.id);
  logEvent("mcp_write", access.userId, {
    tool: "edit_checklist_items",
    edited: result.edited,
    removed: result.removed,
    reordered: result.reordered,
  });
  return {
    game: entry.title,
    list: checklist.title,
    edited: result.edited,
    removed: (args.remove ?? []).map((n) => ({ number: n, text: items[n - 1]!.text })),
    reordered: result.reordered,
    listProgress: { done: left.filter((it) => it.completedAt).length, total: result.total },
    gameProgress:
      progress && progress.total > 0
        ? { mainList: progress.checklistTitle, percent: progress.percent, remainingHours: hours(progress.remainingSeconds) }
        : null,
    ...(result.removed > 0 || result.reordered
      ? { note: "Item numbers have changed — get_checklist shows the new ones." }
      : {}),
  };
}

export async function toolDeleteChecklist(
  access: McpAccess,
  args: { game: string; list?: string; confirm?: boolean },
) {
  requireWrite(access);
  const { entry, checklist } = await gameList(access.userId, args.game, args.list);
  const items = await loadChecklistItems(access.userId, checklist.id);
  const summary = {
    game: entry.title,
    list: listSummary(checklist),
    items: items.length,
    ticked: items.filter((it) => it.completedAt).length,
  };
  const notes: string[] = [];
  if (checklist.kind === MAIN_LIST_KIND) notes.push("It's the main story list, so the game's progress percentage goes with it.");
  if (checklist.isPublic) notes.push("It's published: it leaves the public lists, though copies other people made stay theirs.");

  if (!args.confirm) {
    return { deleted: false, ...summary, note: [PREVIEW_NOTE, ...notes].join(" ") };
  }
  await deleteChecklist(access.userId, checklist.id);
  logEvent("mcp_write", access.userId, { tool: "delete_checklist", kind: checklist.kind, items: items.length });
  return { deleted: true, ...summary, ...(notes.length > 0 ? { note: notes.join(" ") } : {}) };
}

// ---------------------------------------------------------------------------
// Collections

interface CollectionGame {
  /** the catalog game's id */
  id: string;
  title: string;
}

async function gamesIn(collectionId: string): Promise<CollectionGame[]> {
  return db
    .select({ id: schema.games.id, title: schema.games.title })
    .from(schema.collectionGames)
    .innerJoin(schema.games, eq(schema.games.id, schema.collectionGames.gameId))
    .where(eq(schema.collectionGames.collectionId, collectionId))
    .orderBy(asc(schema.collectionGames.sortOrder), asc(schema.games.title));
}

/**
 * Games named the way the collection tools take them, found among the
 * collection's own games: a catalog id, the user's library id for one, or an
 * exact title.
 */
function resolveInCollection(games: CollectionGame[], library: LibraryRow[], refs: string[]) {
  const byEntry = new Map(library.map((l) => [l.id, l.gameId]));
  const found: CollectionGame[] = [];
  const missing: Miss[] = [];
  for (const raw of refs) {
    const input = raw.trim();
    if (!input) continue;
    if (UUID.test(input)) {
      const gameId = byEntry.get(input) ?? input;
      const hit = games.find((g) => g.id === gameId);
      if (hit) found.push(hit);
      else missing.push({ input, reason: `No game with id ${input} is in this collection.` });
      continue;
    }
    const picked = pickByTitle(games, input, false);
    if (picked.kind === "one") found.push(picked.item);
    else if (picked.kind === "several") {
      missing.push({ input, reason: `"${input}" is ${picked.items.length} games in this collection — use one of these ids: ${withIds(picked.items)}.` });
    } else if (picked.kind === "close") {
      missing.push({ input, reason: `Nothing in this collection is called exactly "${input}". Did you mean: ${withIds(picked.items)}?` });
    } else {
      missing.push({ input, reason: `Nothing in this collection is called "${input}".` });
    }
  }
  return { found, missing };
}

export async function toolRemoveGamesFromCollection(
  access: McpAccess,
  args: { collectionId?: string; collectionName?: string; games: string[] },
) {
  requireWrite(access);
  const collection = await findOwnedCollection(access.userId, { id: args.collectionId, name: args.collectionName });
  const { found, missing } = resolveInCollection(await gamesIn(collection.id), await libraryIndex(access.userId), args.games);
  const result = await removeGamesFromCollection(
    access.userId,
    collection.id,
    found.map((g) => g.id),
  );
  logEvent("mcp_write", access.userId, {
    tool: "remove_games_from_collection",
    removed: result.removed.length,
    notFound: missing.length,
  });
  const gone = new Set(result.removed);
  return {
    collection: { id: collection.id, name: collection.name },
    removed: result.removed.length,
    removedGames: found.filter((g) => gone.has(g.id)).map((g) => g.title),
    notFound: missing,
    gamesInCollection: result.total,
    ...(collection.isPublic ? { note: "The collection is published, so the change is public too." } : {}),
  };
}

export async function toolUpdateCollection(
  access: McpAccess,
  args: {
    collectionId?: string;
    collectionName?: string;
    name?: string;
    description?: string | null;
    accentColor?: string | null;
    order?: string[];
  },
) {
  requireWrite(access);
  if (args.name === undefined && args.description === undefined && args.accentColor === undefined && !args.order?.length) {
    throw new McpToolError("Nothing to change: give a new name, description, accentColor or order.");
  }
  const owned = await findOwnedCollection(access.userId, { id: args.collectionId, name: args.collectionName });

  // the order is resolved in full before anything is written: a list with a
  // hole in it doesn't say where the missing game goes
  let orderIds: string[] | null = null;
  if (args.order?.length) {
    const { found, missing } = resolveInCollection(await gamesIn(owned.id), await libraryIndex(access.userId), args.order);
    if (missing.length > 0) {
      throw new McpToolError(`Nothing was changed — couldn't place: ${missing.map((m) => m.reason).join(" ")}`);
    }
    orderIds = found.map((g) => g.id);
  }

  const before = await db.select().from(schema.collections).where(eq(schema.collections.id, owned.id));
  const fields = {
    ...(args.name !== undefined ? { name: args.name } : {}),
    ...(args.description !== undefined ? { description: args.description } : {}),
    ...(args.accentColor !== undefined ? { accentColor: args.accentColor } : {}),
  };
  // never `isPublic`: publishing stays a deliberate act in the app
  const updated = Object.keys(fields).length > 0 ? await updateCollection(access.userId, owned.id, fields) : before[0]!;
  if (orderIds) await orderCollection(access.userId, owned.id, orderIds);

  const was = before[0]!;
  const changed = Object.fromEntries(
    (["name", "description", "accentColor"] as const)
      .filter((k) => fields[k] !== undefined && was[k] !== updated[k])
      .map((k) => [k, { from: was[k], to: updated[k] }]),
  );
  const games = orderIds ? await gamesIn(owned.id) : null;
  logEvent("mcp_write", access.userId, {
    tool: "update_collection",
    fields: Object.keys(changed).length,
    ordered: orderIds?.length ?? 0,
  });
  return {
    collection: { id: updated.id, name: updated.name, public: updated.isPublic },
    changed,
    ...(games ? { order: games.slice(0, 100).map((g, i) => `${i + 1}. ${g.title}`) } : {}),
    ...(updated.isPublic ? { note: "The collection is published, so the change is public too." } : {}),
  };
}

export async function toolDeleteCollection(
  access: McpAccess,
  args: { collectionId?: string; collectionName?: string; confirm?: boolean },
) {
  requireWrite(access);
  // the exact name or the id: a partial match is fine for reading, not this
  const owned = await findOwnedCollection(access.userId, { id: args.collectionId, name: args.collectionName }, { exact: true });
  const [games, graphs] = await Promise.all([
    gamesIn(owned.id),
    db
      .select({ name: schema.collectionGraphs.name })
      .from(schema.collectionGraphs)
      .where(eq(schema.collectionGraphs.collectionId, owned.id)),
  ]);
  const summary = {
    collection: { id: owned.id, name: owned.name, public: owned.isPublic },
    games: games.length,
    graphs: graphs.map((g) => g.name),
  };
  if (!args.confirm) {
    return {
      deleted: false,
      ...summary,
      note: `${PREVIEW_NOTE} The games stay in the library; only the collection, its order and its graphs go.`,
    };
  }
  await deleteCollection(access.userId, owned.id);
  logEvent("mcp_write", access.userId, { tool: "delete_collection", games: games.length });
  return {
    deleted: true,
    ...summary,
    note: owned.isPublic
      ? "Deleted. It's gone from the public collections too; copies other people made stay theirs."
      : "Deleted. The games are still in the library.",
  };
}
