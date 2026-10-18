import { and, eq, ilike, isNotNull } from "drizzle-orm";
import {
  GAME_LINK_ROLE_META,
  PROGRESS_BASIS_LABELS,
  type CategoryView,
  type GameLinkRole,
  type ProgressBasis,
} from "@gm/shared";
import { db, schema } from "../db/index.js";
import { logEvent } from "./analytics.js";
import { upsertGameFromIgdb } from "./catalog.js";
import { listCategories } from "./categories.js";
import {
  addGamesToCollection,
  createCollection,
  findCollectionByName,
  type Collection,
} from "./collections.js";
import { communityRatings } from "./community.js";
import { linkGames } from "./game-links.js";
import { igdbConfigured, searchIgdb } from "./igdb.js";
import type { McpCaller } from "./mcp-auth.js";
import { gameTime } from "./progress.js";
import { ServiceError } from "./service-error.js";
import { addTagToEntries, createTag, findTagByName, removeTagFromEntries, type Tag } from "./tags.js";
import { setTimeToBeat } from "./time-to-beat.js";
import { loadMyChecklists } from "../routes/checklists.js";
import { loadCollectionDetail, loadCollections } from "../routes/collections.js";
import { loadDashboard } from "../routes/dashboard.js";
import { gameLinksFor } from "../routes/games.js";
import {
  loadEntryProgress,
  loadLibraryEntries,
  type LoadedLibraryEntry,
} from "../routes/library.js";

/**
 * What the MCP tools (`routes/mcp.ts`) answer, as plain data.
 *
 * Every function here takes the authenticated user's id and nothing reaches
 * past it: they read through the same loaders the web app's own routes use
 * (`loadLibraryEntries`, `loadDashboard`, `loadCollections`…), which are
 * scoped by that id, so a tool can only ever describe the caller's library —
 * and the numbers it gives are the numbers the app shows.
 *
 * The shapes are compact on purpose: a model reads every byte of a tool
 * result, so internal ids are swapped for names (category labels, platform
 * names), times are hours rather than seconds, and fields that only mean
 * something to a UI (cover URLs, colours, sort positions) are left out. The
 * one id kept is a library entry's, because `get_game` takes it.
 *
 * The write tools at the bottom go through the same service functions the
 * web routes do (`services/tags.ts`, `collections.ts`, `game-links.ts`,
 * `time-to-beat.ts`), so validation, ownership and the content filter are
 * the app's own, and each refuses unless the caller's credential allows
 * changes (`requireWrite`).
 */

/** A tool asked for something that isn't there; reported to the model as an error result. */
export class McpToolError extends Error {}

/** Seconds → hours, one decimal. Null stays null: unknown isn't zero. */
function hours(seconds: number | null | undefined): number | null {
  if (seconds == null) return null;
  return Math.round(seconds / 360) / 10;
}

/** A timestamp as a calendar date — the time of day a game was finished is noise. */
function day(value: Date | string | null | undefined): string | null {
  if (!value) return null;
  const date = typeof value === "string" ? new Date(value) : value;
  return Number.isNaN(date.getTime()) ? null : date.toISOString().slice(0, 10);
}

function year(releaseDate: string | null | undefined): number | null {
  if (!releaseDate) return null;
  const y = Number(releaseDate.slice(0, 4));
  return Number.isFinite(y) && y > 0 ? y : null;
}

const fold = (s: string) => s.trim().toLowerCase();

/**
 * A title for comparing as "the same title": case, accents, trademark signs
 * and punctuation don't count, so "Hollow Knight Silksong" is the exact
 * title of "Hollow Knight: Silksong" and "Pokemon" of "Pokémon". Letters in
 * any script survive (`\p{L}`), so a Japanese title isn't folded to nothing.
 */
function titleKey(s: string): string {
  return s
    .normalize("NFKD")
    .replace(/\p{M}/gu, "")
    .toLowerCase()
    .replace(/[™®©]/g, "")
    .replace(/&/g, " and ")
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .trim();
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// The library JSON types platforms and tags as unknown[] (they're built by
// two small select()s in routes/library.ts); these are their real shapes.
interface EntryPlatform {
  name: string;
  abbreviation: string | null;
  parentName: string | null;
  format: "physical" | "digital";
}
interface EntryTag {
  name: string;
}

type Categories = Map<string, CategoryView>;

async function categoriesFor(userId: string): Promise<Categories> {
  const list = await listCategories(userId);
  return new Map(list.map((c) => [c.key, c]));
}

/** A stored status as the name a person would use for it. */
function categoryName(categories: Categories, key: string | null | undefined): string | null {
  if (!key) return null;
  return categories.get(key)?.label ?? "Uncategorized";
}

/**
 * The category a model asked for, by key or by name ("backlog", "Backlog",
 * "Replay someday"). Unknown names are an error that lists the real ones, so
 * the model can correct itself instead of concluding the category is empty.
 */
function resolveCategory(categories: Categories, input: string): CategoryView {
  const wanted = fold(input);
  for (const c of categories.values()) {
    if (c.key === input || fold(c.label) === wanted || fold(c.key) === wanted) return c;
  }
  const names = [...categories.values()].map((c) => c.label).join(", ");
  throw new McpToolError(`No category called "${input}". Categories: ${names}.`);
}

/** Does this entry sit on the named platform? A parent (PC) covers its storefronts. */
function onPlatform(platforms: EntryPlatform[], input: string): boolean {
  const wanted = fold(input);
  return platforms.some(
    (p) =>
      fold(p.name) === wanted ||
      (p.abbreviation !== null && fold(p.abbreviation) === wanted) ||
      (p.parentName !== null && fold(p.parentName) === wanted),
  );
}

function platformsOf(loaded: LoadedLibraryEntry) {
  return (loaded.entry.platforms as EntryPlatform[]).map((p) => ({
    platform: p.name,
    // set for storefronts: Steam is "part of" PC, and counts as a PC game
    ...(p.parentName ? { partOf: p.parentName } : {}),
    format: p.format,
  }));
}

/** One library entry, compactly — the row `list_library` returns. */
function compactEntry(loaded: LoadedLibraryEntry, categories: Categories) {
  const { entry, row } = loaded;
  const game = entry.game;
  const hasList = entry.missionsTotal > 0;
  return {
    id: entry.id,
    title: game.title,
    releaseYear: year(game.releaseDate),
    category: categoryName(categories, entry.status),
    rating: entry.rating,
    platforms: platformsOf(loaded),
    tags: (entry.tags as EntryTag[]).map((t) => t.name),
    startedAt: day(entry.startedAt),
    finishedAt: day(entry.finishedAt),
    completed100: entry.completed100,
    // "endless" games (multiplayer, roguelikes) have no length to finish
    endless: !entry.ttbEnabled,
    steamHours: row.steamPlaytimeMinutes == null ? null : Math.round(row.steamPlaytimeMinutes / 6) / 10,
    timeToBeatHours:
      game.ttbMain === null && game.ttbMainExtra === null && game.ttbCompletionist === null
        ? null
        : {
            main: hours(game.ttbMain),
            mainExtra: hours(game.ttbMainExtra),
            completionist: hours(game.ttbCompletionist),
            source: game.ttbSource,
          },
    // only when there's a mission list to measure against — otherwise there
    // is no honest percentage to give
    progress: hasList
      ? {
          percent: Math.round((entry.missionsDone / entry.missionsTotal) * 100),
          missionsDone: entry.missionsDone,
          missionsTotal: entry.missionsTotal,
          remainingHours: hours(entry.estimatedRemainingSeconds),
        }
      : null,
  };
}

// ---------------------------------------------------------------------------

export async function toolListCategories(userId: string) {
  const list = await listCategories(userId);
  return {
    categories: list.map((c) => ({
      key: c.key,
      name: c.label,
      builtIn: c.builtIn,
      games: c.count,
    })),
  };
}

export const LIBRARY_SORTS = ["title", "rating", "recently_added", "shortest", "longest"] as const;
export type LibrarySort = (typeof LIBRARY_SORTS)[number];

export async function toolListLibrary(
  userId: string,
  args: {
    category?: string;
    platform?: string;
    tag?: string;
    search?: string;
    sort?: LibrarySort;
    limit?: number;
  },
) {
  const [loaded, categories] = await Promise.all([
    loadLibraryEntries(userId),
    categoriesFor(userId),
  ]);
  const category = args.category ? resolveCategory(categories, args.category) : null;
  const search = args.search ? fold(args.search) : null;
  const tag = args.tag ? fold(args.tag) : null;

  let matched = loaded.filter((l) => {
    if (category && l.entry.status !== category.key) return false;
    if (args.platform && !onPlatform(l.entry.platforms as EntryPlatform[], args.platform)) {
      return false;
    }
    if (tag && !(l.entry.tags as EntryTag[]).some((t) => fold(t.name) === tag)) return false;
    if (search && !fold(l.entry.game.title).includes(search)) return false;
    return true;
  });

  const length = (l: LoadedLibraryEntry) => l.entry.game.ttbMain;
  // unknowns sink in every direction: an unknown length isn't "0 hours"
  const byLength = (dir: 1 | -1) => (a: LoadedLibraryEntry, b: LoadedLibraryEntry) => {
    const x = length(a);
    const y = length(b);
    if (x === null || y === null) return x === y ? 0 : x === null ? 1 : -1;
    return (x - y) * dir;
  };
  switch (args.sort ?? "title") {
    case "rating":
      matched = [...matched].sort((a, b) => (b.entry.rating ?? -1) - (a.entry.rating ?? -1));
      break;
    case "recently_added":
      matched = [...matched].sort(
        (a, b) => +new Date(b.entry.createdAt) - +new Date(a.entry.createdAt),
      );
      break;
    case "shortest":
      matched = [...matched].sort(byLength(1));
      break;
    case "longest":
      matched = [...matched].sort(byLength(-1));
      break;
    default:
      // already in title order from the loader
      break;
  }

  const limit = args.limit ?? 100;
  return {
    total: matched.length,
    returned: Math.min(matched.length, limit),
    filters: {
      ...(category ? { category: category.label } : {}),
      ...(args.platform ? { platform: args.platform } : {}),
      ...(args.tag ? { tag: args.tag } : {}),
      ...(args.search ? { search: args.search } : {}),
    },
    games: matched.slice(0, limit).map((l) => compactEntry(l, categories)),
  };
}

interface Titled {
  id: string;
  title: string;
}

type Picked<T> =
  | { kind: "one"; item: T }
  /** several share the exact title — or, with partial lookup on, contain it */
  | { kind: "several"; items: T[] }
  /** with partial lookup off: nothing exact, but these contain the text */
  | { kind: "close"; items: T[] }
  | { kind: "none" };

/**
 * The one item a title means — the lookup `get_game` has always made,
 * shared with the write tools so "the game called X" means the same thing to
 * both. An exact title wins (`titleKey`: case and punctuation aside). With
 * `partial` on — reads — a single title containing the text stands in for
 * one; writes turn it off, because tagging the wrong game is worse than
 * asking again, and get the near misses back to offer instead.
 */
function pickByTitle<T extends Titled>(items: T[], input: string, partial: boolean): Picked<T> {
  const wanted = titleKey(input);
  const exact = wanted ? items.filter((i) => titleKey(i.title) === wanted) : [];
  if (exact.length === 1) return { kind: "one", item: exact[0]! };
  if (exact.length > 1) return { kind: "several", items: exact };
  const text = fold(input);
  const containing = text ? items.filter((i) => fold(i.title).includes(text)) : [];
  if (partial) {
    if (containing.length === 1) return { kind: "one", item: containing[0]! };
    if (containing.length > 1) return { kind: "several", items: containing };
  } else if (containing.length > 0) {
    return { kind: "close", items: containing };
  }
  return { kind: "none" };
}

/** "Title (id …); Title (id …)" — what an ambiguous lookup offers back. */
function withIds(items: Titled[]): string {
  return items
    .slice(0, 15)
    .map((i) => `${i.title} (id ${i.id})`)
    .join("; ");
}

/**
 * Find the entry `get_game` means: by id when it has one, otherwise by title
 * — an exact (case-insensitive) title wins, then a single partial match.
 * Several partial matches come back as an error naming them, so the model can
 * ask again with the id rather than being handed the wrong game.
 */
async function findEntry(userId: string, args: { id?: string; title?: string }) {
  if (args.id) {
    const [loaded] = await loadLibraryEntries(userId, args.id);
    if (!loaded) throw new McpToolError(`No game with id ${args.id} in your library.`);
    return loaded;
  }
  if (!fold(args.title ?? "")) throw new McpToolError("Give either an id or a title.");
  const all = await loadLibraryEntries(userId);
  const picked = pickByTitle(
    all.map((loaded) => ({ id: loaded.entry.id, title: loaded.entry.game.title, loaded })),
    args.title!,
    true,
  );
  if (picked.kind === "one") return picked.item.loaded;
  if (picked.kind === "none" || picked.kind === "close") {
    throw new McpToolError(`Nothing in your library is called "${args.title}".`);
  }
  throw new McpToolError(
    `"${args.title}" matches ${picked.items.length} games — call again with one of these ids: ${withIds(picked.items)}.`,
  );
}

/**
 * One of the user's own collections, by id or by name — an exact name
 * (ignoring case) first, then a single partial match. Never anyone else's,
 * public or not: these tools describe and change the caller's library only.
 */
async function findOwnedCollection(
  userId: string,
  args: { id?: string; name?: string },
): Promise<{ id: string; name: string; isPublic: boolean }> {
  const mine = await db
    .select({
      id: schema.collections.id,
      name: schema.collections.name,
      isPublic: schema.collections.isPublic,
    })
    .from(schema.collections)
    .where(eq(schema.collections.userId, userId));
  if (args.id) {
    const hit = mine.find((c) => c.id === args.id);
    if (!hit) throw new McpToolError(`No collection with id ${args.id} among yours.`);
    return hit;
  }
  const wanted = fold(args.name ?? "");
  if (!wanted) throw new McpToolError("Give either an id or a name.");
  const hit =
    mine.find((c) => fold(c.name) === wanted) ??
    (() => {
      const partial = mine.filter((c) => fold(c.name).includes(wanted));
      return partial.length === 1 ? partial[0] : undefined;
    })();
  if (!hit) {
    const names = mine.map((c) => c.name).sort((a, b) => a.localeCompare(b)).join(", ") || "none";
    throw new McpToolError(`No collection called "${args.name}". Your collections: ${names}.`);
  }
  return hit;
}

export async function toolGetGame(userId: string, args: { id?: string; title?: string }) {
  const loaded = await findEntry(userId, args);
  const { entry } = loaded;
  const [categories, progress, checklists, links] = await Promise.all([
    categoriesFor(userId),
    loadEntryProgress(userId, entry.id),
    loadMyChecklists(userId, entry.game.id),
    gameLinksFor(userId, entry.game.id),
  ]);

  return {
    ...compactEntry(loaded, categories),
    summary: entry.game.summary,
    notes: entry.notes,
    // the Progress tab's numbers, exactly: GET /api/library/:id/progress
    progress: progress
      ? {
          basis: PROGRESS_BASIS_LABELS[progress.basis as ProgressBasis] ?? progress.basis,
          missionList: progress.checklistTitle,
          missionsDone: progress.done,
          missionsTotal: progress.total,
          percent: progress.total > 0 ? progress.percent : null,
          totalHours: hours(progress.totalSeconds),
          remainingHours: hours(progress.remainingSeconds),
        }
      : null,
    checklists: checklists.map((c) => ({
      title: c.title,
      kind: c.kind === "missions" ? "main story" : "extra",
      done: c.doneCount,
      total: c.itemCount,
    })),
    // only the sections that have something in them, named the way the
    // Linked tab names them ("DLC", "Prequels", "Remakes & remasters"…)
    linkedGames: Object.fromEntries(
      links.sections
        .filter((s) => s.links.length > 0)
        .map((s) => [
          GAME_LINK_ROLE_META[s.role].section,
          s.links.map((l) => ({
            title: l.game.title,
            releaseYear: year(l.game.releaseDate),
            inLibrary: l.game.userGameId !== null,
            ...(l.game.userGameId ? { id: l.game.userGameId } : {}),
            category: categoryName(categories, l.game.status),
          })),
        ]),
    ),
  };
}

export async function toolGetDashboard(userId: string) {
  const [dash, categories] = await Promise.all([loadDashboard(userId), categoriesFor(userId)]);
  return {
    totalGames: dash.total,
    byCategory: Object.entries(dash.statusCounts)
      .map(([key, games]) => ({ category: categoryName(categories, key), games }))
      .sort((a, b) => b.games - a.games),
    byPlatform: dash.platformCounts.map((p) => ({ platform: p.name, games: p.count })),
    // the dashboard's own figure: main-story time of every backlog game not
    // marked endless
    backlogHours: hours(dash.backlogSeconds),
    recentlyFinished: dash.recentlyFinished.map((r) => ({
      id: r.id,
      title: r.title,
      finishedAt: day(r.finishedAt),
      rating: r.rating,
    })),
  };
}

function collectionTimeOf(time: {
  totalSeconds: number;
  remainingSeconds: number;
  counted: number;
  unknown: number;
  endless: number;
  finished: number;
}) {
  return {
    totalHours: hours(time.totalSeconds),
    remainingHours: hours(time.remainingSeconds),
    // the totals are short by these — say so rather than look complete
    gamesWithUnknownLength: time.unknown,
    endlessGames: time.endless,
  };
}

export async function toolListCollections(userId: string) {
  const rows = await loadCollections(userId);
  return {
    collections: rows.map((c) => ({
      id: c.id,
      name: c.name,
      description: c.description,
      games: c.total,
      finished: c.finished,
      public: c.isPublic,
      ...collectionTimeOf(c.time),
    })),
  };
}

export async function toolGetCollection(userId: string, args: { id?: string; name?: string }) {
  const { id } = await findOwnedCollection(userId, args);

  const [detail, categories] = await Promise.all([
    loadCollectionDetail(userId, id),
    categoriesFor(userId),
  ]);
  // yours only: the endpoint would also open someone's published collection,
  // but these tools describe the caller's own library and nothing else
  if (!detail || !detail.isOwner) {
    throw new McpToolError(`No collection with id ${id} among yours.`);
  }

  const inOrder = [...detail.games].sort(
    (a, b) => a.sortOrder - b.sortOrder || a.title.localeCompare(b.title),
  );
  const titleOf = new Map(detail.games.map((g) => [g.gameId, g.title]));
  return {
    id: detail.id,
    name: detail.name,
    description: detail.description,
    public: detail.isPublic,
    ...collectionTimeOf(detail.time),
    // the collection's list order — the numbered run the List tab shows
    games: inOrder.map((g, i) => ({
      order: i + 1,
      title: g.title,
      releaseYear: year(g.releaseDate),
      inLibrary: g.userGameId !== null,
      ...(g.userGameId ? { id: g.userGameId } : {}),
      category: g.userGameId ? categoryName(categories, g.status) : null,
      finished: g.finished,
      hours: hours(g.ttbSeconds),
      remainingHours: hours(g.remainingSeconds),
    })),
    // each named graph's arrows, as "A → B" — what plays or happens before what
    graphs: detail.graphs.map((graph) => ({
      name: graph.name,
      arrows: graph.links.map(
        (l) =>
          `${titleOf.get(l.fromGameId) ?? "?"} → ${titleOf.get(l.toGameId) ?? "?"}` +
          (l.label ? ` (${l.label})` : ""),
      ),
    })),
  };
}

/** The categories a "what should I play next?" question picks from. */
export const BACKLOG_CANDIDATE_CATEGORIES = ["backlog", "shelved", "wishlist"] as const;

export async function toolGetBacklogCandidates(
  userId: string,
  args: {
    categories?: Array<(typeof BACKLOG_CANDIDATE_CATEGORIES)[number]>;
    platform?: string;
    maxHours?: number;
    limit?: number;
  },
) {
  const wanted = new Set<string>(args.categories?.length ? args.categories : BACKLOG_CANDIDATE_CATEGORIES);
  const [loaded, categories] = await Promise.all([
    loadLibraryEntries(userId),
    categoriesFor(userId),
  ]);
  const picked = loaded.filter(
    (l) =>
      wanted.has(l.entry.status) &&
      (!args.platform || onPlatform(l.entry.platforms as EntryPlatform[], args.platform)),
  );
  const community = await communityRatings(picked.map((l) => l.entry.game.id));

  const candidates = picked
    .map((l) => {
      const { entry } = l;
      // the same "how much is left" a collection total uses: the chosen
      // basis, pro-rated by a mission list when there is one
      const time = gameTime({
        ttb: entry.game,
        basis: entry.progressBasis,
        customSeconds: entry.progressCustomSeconds,
        status: entry.status,
        completed100: entry.completed100,
        ttbEnabled: entry.ttbEnabled,
        missions: { total: entry.missionsTotal, done: entry.missionsDone },
      });
      const rating = community.get(entry.game.id);
      return {
        remaining: time.remainingSeconds,
        row: {
          id: entry.id,
          title: entry.game.title,
          releaseYear: year(entry.game.releaseDate),
          category: categoryName(categories, entry.status),
          platforms: platformsOf(l),
          tags: (entry.tags as EntryTag[]).map((t) => t.name),
          yourRating: entry.rating,
          communityRating: rating ? { average: rating.average, raters: rating.count } : null,
          hoursRemaining: hours(time.remainingSeconds),
          mainStoryHours: hours(entry.game.ttbMain),
          completionistHours: hours(entry.game.ttbCompletionist),
          endless: time.endless,
          startedAt: day(entry.startedAt),
          progressPercent:
            entry.missionsTotal > 0
              ? Math.round((entry.missionsDone / entry.missionsTotal) * 100)
              : null,
          addedAt: day(entry.createdAt),
        },
      };
    })
    .filter((c) => args.maxHours === undefined || (c.remaining !== null && c.remaining <= args.maxHours * 3600))
    // shortest first; unknown lengths (and endless games) after every known one
    .sort((a, b) => {
      if (a.remaining === null || b.remaining === null) {
        return a.remaining === b.remaining ? a.row.title.localeCompare(b.row.title) : a.remaining === null ? 1 : -1;
      }
      return a.remaining - b.remaining;
    });

  const limit = args.limit ?? 100;
  return {
    total: candidates.length,
    returned: Math.min(candidates.length, limit),
    categories: [...wanted].map((key) => categoryName(categories, key)),
    candidates: candidates.slice(0, limit).map((c) => c.row),
  };
}

// ---------------------------------------------------------------------------
// Writes
//
// Seven tools, all of which only add: tags and tag assignments, collections
// and the games in them, links between games, and the user's own
// time-to-beat figures. `untag_games` is the one that takes anything away,
// and it removes an assignment, never a tag. Nothing here deletes, renames,
// recategorises, rates, publishes or touches the account — that's the whole
// list, and adding to it is a decision, not a refactor.

/** The most games one write may name — the same cap as `PUT /api/library/:id/tags`. */
export const MAX_GAMES_PER_WRITE = 100;

/**
 * How many titles one call may look up on IGDB when they're in neither the
 * library nor the catalog. IGDB is throttled to ~3 requests a second, so this
 * keeps a call to a few seconds; the rest come back asking to be sent again.
 */
const IGDB_LOOKUPS_PER_CALL = 20;

/** Who's calling, and whether their credential allows changes. */
export interface McpAccess {
  userId: string;
  via: McpCaller["via"];
  canWrite: boolean;
}

export const READ_ONLY_KEY_MESSAGE =
  'This key is read-only. Create a key with "Allow changes" on under Preferences → API keys in Game Manager, and use it instead of this one.';
export const READ_ONLY_CONNECTION_MESSAGE =
  'This connection is read-only. To let it make changes, remove the Game Manager connector and add it again, then tick "Allow changes" on Game Manager\'s consent screen.';

/** Refuse a write, saying how to get one, unless the credential allows it. */
function requireWrite(access: McpAccess): void {
  if (access.canWrite) return;
  throw new McpToolError(
    access.via === "api_key" ? READ_ONLY_KEY_MESSAGE : READ_ONLY_CONNECTION_MESSAGE,
  );
}

/** A game a write tool couldn't place, and why — returned rather than thrown. */
interface Miss {
  input: string;
  reason: string;
}

interface LibraryRow {
  /** the library entry's id */
  id: string;
  gameId: string;
  title: string;
}

/** The user's library as the write tools need it: entry id, game id, title. */
async function libraryIndex(userId: string): Promise<LibraryRow[]> {
  return db
    .select({ id: schema.userGames.id, gameId: schema.userGames.gameId, title: schema.games.title })
    .from(schema.userGames)
    .innerJoin(schema.games, eq(schema.games.id, schema.userGames.gameId))
    .where(eq(schema.userGames.userId, userId));
}

function libraryMiss(input: string, picked: Picked<LibraryRow>): string {
  if (picked.kind === "several") {
    return `"${input}" matches ${picked.items.length} games in your library — call again with one of these ids: ${withIds(picked.items)}.`;
  }
  if (picked.kind === "close") {
    return `Nothing in your library is called exactly "${input}". Did you mean: ${withIds(picked.items)}? Call again with the id or the exact title.`;
  }
  return `Nothing in your library is called "${input}".`;
}

/** Every way the write tools accept an owned game: its entry id or its catalog id. */
function indexById(library: LibraryRow[]): Map<string, LibraryRow> {
  const byId = new Map<string, LibraryRow>();
  for (const row of library) {
    byId.set(row.id, row);
    byId.set(row.gameId, row);
  }
  return byId;
}

/**
 * A library entry for each reference — an entry id (or the catalog id of a
 * game the user owns), or an exact title. For the tools that only make sense
 * on games you own: tags and your own play times.
 */
function resolveEntries(library: LibraryRow[], refs: string[]) {
  const byId = indexById(library);
  const found: LibraryRow[] = [];
  const missing: Miss[] = [];
  for (const raw of refs) {
    const input = raw.trim();
    if (!input) continue;
    if (UUID.test(input)) {
      const row = byId.get(input);
      if (row) found.push(row);
      else missing.push({ input, reason: `No game with id ${input} in your library.` });
      continue;
    }
    const picked = pickByTitle(library, input, false);
    if (picked.kind === "one") found.push(picked.item);
    else missing.push({ input, reason: libraryMiss(input, picked) });
  }
  return { found, missing };
}

interface ResolvedGame {
  gameId: string;
  title: string;
}

const yearOf = (seconds: number | undefined) =>
  seconds ? new Date(seconds * 1000).getUTCFullYear() : null;

/**
 * Resolves references to *any* game — owned or not — for the tools where a
 * game you don't own is allowed, as it is in the web app: collections (a
 * reading list, not an inventory) and links (noting a DLC exists before you
 * buy it). In order: an id (a library entry's, or a catalog game's); an
 * `igdb:<id>` reference; then an exact title in the library, the shared
 * catalog, and finally IGDB — whose game is pulled into the catalog the way
 * the web app's search-and-add does. Several exact matches come back as an
 * error listing `igdb:<id>` references to pass instead.
 */
async function gameResolver(userId: string) {
  const library = await libraryIndex(userId);
  const byId = indexById(library);
  let igdbLeft = IGDB_LOOKUPS_PER_CALL;
  let igdbOn: boolean | null = null;
  const igdbReady = async () => (igdbOn ??= await igdbConfigured());

  async function fromIgdb(igdbId: number): Promise<ResolvedGame | string> {
    const [known] = await db
      .select({ id: schema.games.id, title: schema.games.title })
      .from(schema.games)
      .where(eq(schema.games.igdbId, igdbId));
    if (known) return { gameId: known.id, title: known.title };
    if (!(await igdbReady())) {
      return `igdb:${igdbId} isn't in the catalog, and IGDB isn't set up on this server to fetch it.`;
    }
    try {
      const gameId = await upsertGameFromIgdb(igdbId);
      const [row] = await db
        .select({ title: schema.games.title })
        .from(schema.games)
        .where(eq(schema.games.id, gameId));
      return { gameId, title: row?.title ?? `igdb:${igdbId}` };
    } catch {
      return `IGDB has no game igdb:${igdbId}.`;
    }
  }

  async function resolve(raw: string): Promise<ResolvedGame | Miss> {
    const input = raw.trim();
    const igdbRef = /^igdb:(\d+)$/i.exec(input);
    if (igdbRef) {
      const got = await fromIgdb(Number(igdbRef[1]));
      return typeof got === "string" ? { input, reason: got } : got;
    }
    if (UUID.test(input)) {
      const owned = byId.get(input);
      if (owned) return { gameId: owned.gameId, title: owned.title };
      const [game] = await db
        .select({ id: schema.games.id, title: schema.games.title })
        .from(schema.games)
        .where(eq(schema.games.id, input));
      if (game) return { gameId: game.id, title: game.title };
      return { input, reason: `No game with id ${input} in your library or the catalog.` };
    }

    const picked = pickByTitle(library, input, false);
    if (picked.kind === "one") return { gameId: picked.item.gameId, title: picked.item.title };
    if (picked.kind === "several") return { input, reason: libraryMiss(input, picked) };
    const near = picked.kind === "close" ? ` In your library: ${withIds(picked.items)}.` : "";

    // the shared catalog: IGDB-backed rows only, so a title can't land on
    // someone else's hand-typed manual entry
    const key = titleKey(input);
    if (key) {
      const pattern = `%${key.split(" ").join("%")}%`;
      const rows = await db
        .select({
          id: schema.games.id,
          title: schema.games.title,
          igdbId: schema.games.igdbId,
          releaseDate: schema.games.releaseDate,
        })
        .from(schema.games)
        .where(and(isNotNull(schema.games.igdbId), ilike(schema.games.title, pattern)))
        .limit(50);
      const exact = rows.filter((r) => titleKey(r.title) === key);
      if (exact.length === 1) return { gameId: exact[0]!.id, title: exact[0]!.title };
      if (exact.length > 1) {
        const options = exact
          .slice(0, 10)
          .map((r) => `${r.title} (${year(r.releaseDate) ?? "year unknown"}, igdb:${r.igdbId})`)
          .join("; ");
        return { input, reason: `"${input}" is several games — call again with one of: ${options}.` };
      }
    }

    if (!(await igdbReady())) {
      return { input, reason: `Nothing in your library or the catalog is called "${input}".${near}` };
    }
    if (igdbLeft <= 0) {
      return {
        input,
        reason: `Not looked up: one call can search IGDB for ${IGDB_LOOKUPS_PER_CALL} titles, and this one already has. Send the rest in another call.`,
      };
    }
    igdbLeft -= 1;
    const results = await searchIgdb(input, 10).catch(() => null);
    if (!results) return { input, reason: `Couldn't search IGDB for "${input}" just now.` };
    const exact = results.filter((g) => titleKey(g.name) === key);
    if (exact.length === 1) {
      const got = await fromIgdb(exact[0]!.id);
      return typeof got === "string" ? { input, reason: got } : got;
    }
    const describe = (g: (typeof results)[number]) =>
      `${g.name} (${yearOf(g.first_release_date) ?? "year unknown"}, igdb:${g.id})`;
    if (exact.length > 1) {
      return {
        input,
        reason: `"${input}" is several games — call again with one of: ${exact.slice(0, 10).map(describe).join("; ")}.`,
      };
    }
    const closest = results.slice(0, 3).map(describe).join("; ");
    return {
      input,
      reason: `No game is called exactly "${input}".${near}${closest ? ` Closest on IGDB: ${closest} — pass one of those igdb: references, or the exact title.` : ""}`,
    };
  }

  return { resolve };
}

/** Resolve each reference, keeping the ones that worked in the order given. */
async function resolveGames(userId: string, refs: string[]) {
  const resolver = await gameResolver(userId);
  const found: ResolvedGame[] = [];
  const missing: Miss[] = [];
  for (const raw of refs) {
    if (!raw.trim()) continue;
    const got = await resolver.resolve(raw);
    if ("reason" in got) missing.push(got);
    else found.push(got);
  }
  return { found, missing };
}

function tagSummary(tag: Tag) {
  return { name: tag.name, color: tag.color, group: tag.groupName };
}

/** The user's tag with this name, made (with `extra`) if they don't have one yet. */
async function tagNamed(userId: string, name: string, extra: { color?: string; group?: string }) {
  const existing = await findTagByName(userId, name);
  if (existing) return { tag: existing, created: false };
  try {
    const tag = await createTag(userId, {
      name,
      color: extra.color ?? null,
      groupName: extra.group ?? null,
    });
    return { tag, created: true };
  } catch (err) {
    // two calls racing to make the same tag: the winner's is the answer
    if (err instanceof ServiceError && err.status === 409) {
      const tag = await findTagByName(userId, name);
      if (tag) return { tag, created: false };
    }
    throw err;
  }
}

export async function toolCreateTag(
  access: McpAccess,
  args: { name: string; color?: string; group?: string },
) {
  requireWrite(access);
  const { tag, created } = await tagNamed(access.userId, args.name, args);
  // an existing tag is returned as it is: renaming or restyling tags isn't
  // something these tools do
  const differs =
    !created &&
    ((args.color !== undefined && args.color.toLowerCase() !== tag.color?.toLowerCase()) ||
      (args.group !== undefined && fold(args.group) !== fold(tag.groupName ?? "")));
  logEvent("mcp_write", access.userId, { tool: "create_tag", created });
  return {
    created,
    tag: tagSummary(tag),
    ...(differs
      ? { note: "You already had this tag, so it was left as it was — its colour and group weren't changed." }
      : {}),
  };
}

export async function toolTagGames(
  access: McpAccess,
  args: { tag: string; group?: string; games: string[] },
) {
  requireWrite(access);
  const { found, missing } = resolveEntries(await libraryIndex(access.userId), args.games);
  const { tag, created } = await tagNamed(access.userId, args.tag, { group: args.group });
  const result = await addTagToEntries(
    access.userId,
    tag.id,
    found.map((f) => f.id),
  );
  logEvent("mcp_write", access.userId, {
    tool: "tag_games",
    tagCreated: created,
    tagged: result.added.length,
    alreadyHad: result.already.length,
    notFound: missing.length,
  });
  return {
    tag: tagSummary(tag),
    tagCreated: created,
    tagged: result.added.length,
    alreadyHad: result.already.length,
    notFound: missing,
  };
}

export async function toolUntagGames(access: McpAccess, args: { tag: string; games: string[] }) {
  requireWrite(access);
  const tag = await findTagByName(access.userId, args.tag);
  if (!tag) {
    const all = await db
      .select({ name: schema.tags.name })
      .from(schema.tags)
      .where(eq(schema.tags.userId, access.userId));
    const names = all.map((t) => t.name).sort((a, b) => a.localeCompare(b));
    throw new McpToolError(
      `You have no tag called "${args.tag}". Your tags: ${names.slice(0, 60).join(", ") || "none"}.`,
    );
  }
  const { found, missing } = resolveEntries(await libraryIndex(access.userId), args.games);
  const result = await removeTagFromEntries(
    access.userId,
    tag.id,
    found.map((f) => f.id),
  );
  logEvent("mcp_write", access.userId, {
    tool: "untag_games",
    removed: result.removed.length,
    didNotHaveIt: result.notTagged.length,
    notFound: missing.length,
  });
  return {
    tag: tag.name,
    removed: result.removed.length,
    didNotHaveIt: result.notTagged.length,
    notFound: missing,
  };
}

/** Resolve games and append them to one of the user's collections. */
async function fillCollection(userId: string, collectionId: string, refs: string[]) {
  const { found, missing } = await resolveGames(userId, refs);
  const result = await addGamesToCollection(
    userId,
    collectionId,
    found.map((f) => f.gameId),
  );
  return { ...result, missing };
}

export async function toolCreateCollection(
  access: McpAccess,
  args: { name: string; description?: string; accentColor?: string; games?: string[] },
) {
  requireWrite(access);
  let collection: Collection | null = await findCollectionByName(access.userId, args.name);
  let created = false;
  if (!collection) {
    try {
      // "private", never "preference": publishing is a deliberate act, so a
      // collection made over MCP starts private whatever the user's publish
      // mode says, and nothing here can make it public
      collection = await createCollection(
        access.userId,
        {
          name: args.name,
          description: args.description ?? null,
          accentColor: args.accentColor ?? null,
        },
        "private",
      );
      created = true;
    } catch (err) {
      if (!(err instanceof ServiceError && err.status === 409)) throw err;
      collection = await findCollectionByName(access.userId, args.name);
      if (!collection) throw err;
    }
  }

  const filled = args.games?.length
    ? await fillCollection(access.userId, collection.id, args.games)
    : null;
  logEvent("mcp_write", access.userId, {
    tool: "create_collection",
    created,
    added: filled?.added.length ?? 0,
    alreadyIn: filled?.already.length ?? 0,
    notFound: filled?.missing.length ?? 0,
  });
  const keptAsItWas =
    !created && (args.description !== undefined || args.accentColor !== undefined)
      ? " Its description and colour were left as they were."
      : "";
  return {
    created,
    collection: { id: collection.id, name: collection.name, public: collection.isPublic },
    added: filled?.added.length ?? 0,
    alreadyIn: filled?.already.length ?? 0,
    notFound: filled?.missing ?? [],
    ...(created
      ? {}
      : {
          note: `You already had a collection called "${collection.name}", so that one was used.${keptAsItWas}`,
        }),
  };
}

export async function toolAddGamesToCollection(
  access: McpAccess,
  args: { collectionId?: string; collectionName?: string; games: string[] },
) {
  requireWrite(access);
  const collection = await findOwnedCollection(access.userId, {
    id: args.collectionId,
    name: args.collectionName,
  });
  const filled = await fillCollection(access.userId, collection.id, args.games);
  logEvent("mcp_write", access.userId, {
    tool: "add_games_to_collection",
    added: filled.added.length,
    alreadyIn: filled.already.length,
    notFound: filled.missing.length,
  });
  return {
    collection: { id: collection.id, name: collection.name },
    added: filled.added.length,
    alreadyIn: filled.already.length,
    notFound: filled.missing,
    gamesInCollection: filled.total,
  };
}

/** A link said as a sentence, so the result reads back what was recorded. */
const LINK_SENTENCE: Record<GameLinkRole, (game: string, related: string) => string> = {
  dlc: (game, related) => `"${related}" is DLC for "${game}"`,
  prequel: (game, related) => `"${related}" comes before "${game}"`,
  sequel: (game, related) => `"${related}" follows "${game}"`,
  remake: (game, related) => `"${related}" is a remake or remaster of "${game}"`,
  base_game: (game, related) => `"${game}" is DLC for "${related}"`,
  original: (game, related) => `"${game}" is a remake or remaster of "${related}"`,
};

export async function toolLinkGames(
  access: McpAccess,
  args: { game: string; relatedGame: string; role: GameLinkRole },
) {
  requireWrite(access);
  const resolver = await gameResolver(access.userId);
  const game = await resolver.resolve(args.game);
  if ("reason" in game) throw new McpToolError(game.reason);
  const related = await resolver.resolve(args.relatedGame);
  if ("reason" in related) throw new McpToolError(related.reason);

  const link = await linkGames(access.userId, game.gameId, related.gameId, args.role);
  logEvent("mcp_write", access.userId, { tool: "link_games", role: args.role, created: link.created });
  const meta = GAME_LINK_ROLE_META[args.role];
  return {
    created: link.created,
    link: LINK_SENTENCE[args.role](game.title, related.title),
    // where it shows on each game's Linked tab: the related game is listed
    // under `game`'s section for this role, and the other way round
    shownUnder: {
      [game.title]: meta.section,
      [related.title]: GAME_LINK_ROLE_META[meta.inverse].section,
    },
    ...(link.created ? {} : { note: "They were already linked this way, so nothing changed." }),
  };
}

export async function toolSetTimeToBeat(
  access: McpAccess,
  args: {
    game: string;
    mainHours?: number | null;
    mainExtraHours?: number | null;
    completionistHours?: number | null;
  },
) {
  requireWrite(access);
  const seconds = (h: number | null) => (h === null ? null : Math.round(h * 3600));
  // only the fields given: an omitted one keeps what was there
  const input: Record<string, number | null> = {};
  if (args.mainHours !== undefined) input.ttbMain = seconds(args.mainHours);
  if (args.mainExtraHours !== undefined) input.ttbMainExtra = seconds(args.mainExtraHours);
  if (args.completionistHours !== undefined) input.ttbCompletionist = seconds(args.completionistHours);
  if (Object.keys(input).length === 0) {
    throw new McpToolError(
      "Give at least one of mainHours, mainExtraHours and completionistHours (null clears one).",
    );
  }

  const { found, missing } = resolveEntries(await libraryIndex(access.userId), [args.game]);
  const entry = found[0];
  if (!entry) throw new McpToolError(missing[0]?.reason ?? "Give a game id or title.");

  const { times, cleared } = await setTimeToBeat(access.userId, entry.id, input);
  logEvent("mcp_write", access.userId, {
    tool: "set_time_to_beat",
    fields: Object.keys(input).length,
    cleared,
  });
  return {
    game: entry.title,
    // what's stored now, after main <= main+extras <= completionist was enforced
    yourTimeToBeatHours: cleared
      ? null
      : {
          main: hours(times.ttbMain),
          mainExtra: hours(times.ttbMainExtra),
          completionist: hours(times.ttbCompletionist),
        },
    cleared,
  };
}
