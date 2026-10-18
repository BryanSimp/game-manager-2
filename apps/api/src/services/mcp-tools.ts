import {
  GAME_LINK_ROLE_META,
  PROGRESS_BASIS_LABELS,
  type CategoryView,
  type ProgressBasis,
} from "@gm/shared";
import { listCategories } from "./categories.js";
import { communityRatings } from "./community.js";
import { gameTime } from "./progress.js";
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
 * Nothing here writes. The shapes are compact on purpose: a model reads every
 * byte of a tool result, so internal ids are swapped for names (category
 * labels, platform names), times are hours rather than seconds, and fields
 * that only mean something to a UI (cover URLs, colours, sort positions)
 * are left out. The one id kept is a library entry's, because `get_game`
 * takes it.
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
  const wanted = fold(args.title ?? "");
  if (!wanted) throw new McpToolError("Give either an id or a title.");
  const all = await loadLibraryEntries(userId);
  const exact = all.filter((l) => fold(l.entry.game.title) === wanted);
  if (exact.length === 1) return exact[0]!;
  const partial = exact.length > 1 ? exact : all.filter((l) => fold(l.entry.game.title).includes(wanted));
  if (partial.length === 1) return partial[0]!;
  if (partial.length === 0) {
    throw new McpToolError(`Nothing in your library is called "${args.title}".`);
  }
  const options = partial
    .slice(0, 15)
    .map((l) => `${l.entry.game.title} (id ${l.entry.id})`)
    .join("; ");
  throw new McpToolError(
    `"${args.title}" matches ${partial.length} games — call again with one of these ids: ${options}.`,
  );
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
  let id = args.id;
  if (!id) {
    const wanted = fold(args.name ?? "");
    if (!wanted) throw new McpToolError("Give either an id or a name.");
    const mine = await loadCollections(userId);
    const hit =
      mine.find((c) => fold(c.name) === wanted) ??
      (() => {
        const partial = mine.filter((c) => fold(c.name).includes(wanted));
        return partial.length === 1 ? partial[0] : undefined;
      })();
    if (!hit) {
      const names = mine.map((c) => c.name).join(", ") || "none";
      throw new McpToolError(`No collection called "${args.name}". Your collections: ${names}.`);
    }
    id = hit.id;
  }

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
