import type { FastifyInstance, FastifyReply } from "fastify";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { WebStandardStreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js";
import { z } from "zod";
import { env } from "../env.js";
import { toFetchRequest, sendFetchResponse } from "../plugins/fetch-bridge.js";
import { mcpRateLimit } from "../plugins/rate-limits.js";
import { GAME_LINK_ROLES, MCP_SCOPE, OWNERSHIP_FORMATS, type GameLinkRole } from "@gm/shared";
import { authenticateMcp, type McpAuth, type McpCaller } from "../services/mcp-auth.js";
import { PROTECTED_RESOURCE_METADATA_URL } from "../services/oauth.js";
import {
  CHECKLIST_CHAPTER_MAX,
  CHECKLIST_ENTRY_MAX,
  CHECKLIST_SOURCE_MAX,
  CHECKLIST_TITLE_MAX,
  MAX_CHECKLIST_ENTRIES_PER_WRITE,
} from "../services/checklists.js";
import {
  PLATFORM_MODES,
  toolDeleteChecklist,
  toolDeleteCollection,
  toolDeleteGame,
  toolDeleteTags,
  toolEditChecklistItems,
  toolListTags,
  toolRemoveGamesFromCollection,
  toolUnlinkGames,
  toolUpdateChecklist,
  toolUpdateCollection,
  toolUpdateGame,
  toolUpdateGames,
  toolUpdateTag,
} from "../services/mcp-edit-tools.js";
import {
  BACKLOG_CANDIDATE_CATEGORIES,
  CHECKLIST_KIND_INPUTS,
  LIBRARY_FIELDS,
  LIBRARY_PAGE_MAX,
  LIBRARY_SORTS,
  MAX_GAMES_PER_WRITE,
  TTB_SOURCES,
  McpToolError,
  toolAddGamesToCollection,
  toolCreateChecklist,
  toolCreateCollection,
  toolCreateTag,
  toolGetBacklogCandidates,
  toolGetCollection,
  toolGetDashboard,
  toolGetAchievements,
  toolGetChecklist,
  toolGetGame,
  toolLinkGames,
  toolListCategories,
  toolListCollections,
  toolListLibrary,
  toolSetTimeToBeat,
  toolTagGames,
  toolTickChecklistItems,
  toolUntagGames,
  type McpAccess,
} from "../services/mcp-tools.js";
import { ServiceError } from "../services/service-error.js";
import { MAX_TTB_SECONDS } from "../services/time-to-beat.js";

/**
 * An MCP server over Streamable HTTP, at `POST /api/mcp`.
 *
 * This is how Claude (Claude Code, and claude.ai as a custom connector)
 * reads your library — "what should I play next?", "how far through Elden
 * Ring am I?" — and, when you've allowed it, organises it and records
 * progress: categories, ratings, dates and platforms, tags, collections,
 * progress checklists and ticking them off, links between games, your own
 * play times — and fixes or removes what's wrong. It lives under `/api` so the
 * routing that already sends `/api/*` to this server (Traefik's
 * `PathPrefix(/api)`, the self-host nginx, the Vite proxy) carries it
 * without changes.
 *
 * **Stateless.** Every request builds a fresh `McpServer` whose tools are
 * closed over the caller, answers, and is thrown away — there are no MCP
 * sessions to store, expire or mix up between users, and any API process
 * can answer any request. That's also why GET (the optional server-to-client
 * SSE stream) and DELETE (session teardown) are a 405.
 *
 * **Reads always, writes by permission.** The credential that reaches this
 * route works nowhere else — neither an API key nor an OAuth access token is
 * a session (see `auth.ts`), so neither can be replayed against the web
 * app's write routes. What it can change is therefore exactly the write
 * tools below — the additive ones in `services/mcp-tools.ts`, the editing
 * and deleting ones in `services/mcp-edit-tools.ts` — and only when the
 * credential was granted changes: a key made with "Allow changes", or a
 * token with `library:write`. Every caller sees every tool listed; a
 * read-only one gets an error result from a write tool that says how to get
 * a key or connection that can make changes.
 *
 * **Two ways in**, told apart by prefix in `services/mcp-auth.ts`: a
 * personal API key (Claude Code) or an OAuth access token granted
 * `library:read` (claude.ai's custom connector, see `services/oauth.ts`).
 */

const INSTRUCTIONS = `Game Manager is the user's personal video game library. Everything these tools return or change belongs to the signed-in user and nobody else.

Reading is always allowed. Changes only work when the user allowed them for this connection (an API key made with "Allow changes" on, or "Allow changes" ticked when connecting); otherwise every write tool returns an error saying how to allow them. With changes allowed you can add — tags, collections, progress checklists, linked games, the user's own time-to-beat figures, ticks on checklist items — and edit or remove: a game's category, rating, dates, notes, platforms and endless flag (update_game, or update_games for many at once), tags (update_tag, delete_tags), links (unlink_games), checklists and their items (update_checklist, edit_checklist_items, delete_checklist), collections (update_collection, remove_games_from_collection, delete_collection) and games in the library (delete_game). Nothing here publishes anything or touches the account. Only make changes the user asked for, and tell them what changed. The four delete tools answer a call without confirm: true with what would go and change nothing: show the user that, and confirm only once they've agreed.

Every game in the library is filed under one category: the built-ins are Uncategorized, Wishlist, Backlog, Playing, Finished, Shelved and Dropped, and the user may have custom ones too (list_categories). Games are owned on one or more platforms, each physical or digital; PC storefronts like Steam are "part of" PC, so filtering by PC includes them. Ratings are out of 5 in half stars. Times are in hours. "Time to beat" is the user's own figure when they've set one (it overrides IGDB's, for them only), otherwise IGDB's, otherwise a community average; its source says which. Games marked endless (multiplayer, live-service) have no length and stay out of backlog hours. A progress percentage exists only when the user keeps a main story checklist (mission list) for the game.

For "what should I play next?", start with get_backlog_candidates. To look at one game in depth, call get_game with the id from any other tool's results. The write tools take a game as its id from another tool's results or its exact title. list_library pages through a large library (pass nextOffset back as offset), can cut each row down with fields (["tags"] returns id, title and tags), and finds what's missing without listing everything: missingTagGroup, hasTags, hasTimeToBeat, hasChecklist, hasPlatform, endless, timeToBeatSource. list_tags shows the user's tags by group with how many games each is on.

To record progress ("I just beat Margit"), get_game names the game's checklists, get_checklist shows one item by item with numbers, and tick_checklist_items ticks items by text or number. get_achievements shows the user's Steam achievements for a game, so you can tick the items their unlocks show they've done. Only tick what the user says they've done or what their unlocked achievements show.`;

/** A tool's result: compact JSON as text, or the error a model can act on. */
async function run(fn: () => Promise<unknown>) {
  try {
    const data = await fn();
    return { content: [{ type: "text" as const, text: JSON.stringify(data) }] };
  } catch (err) {
    // a refusal the model can act on: something wasn't there, or a write
    // the app's own rules turned down (a duplicate link, a filtered name…)
    if (err instanceof McpToolError || err instanceof ServiceError) {
      return { isError: true, content: [{ type: "text" as const, text: err.message }] };
    }
    throw err;
  }
}

const READ_ONLY = { readOnlyHint: true, destructiveHint: false, openWorldHint: false } as const;
// the additive writes only add, remove an assignment (untag_games) or a tick
// (tick_checklist_items with done: false), and doing one twice changes
// nothing more than doing it once
const WRITE = {
  readOnlyHint: false,
  destructiveHint: false,
  idempotentHint: true,
  openWorldHint: false,
} as const;
// the edits and deletes overwrite or remove what was there — which a client
// may want to confirm with the user — but the same call twice still lands
// in the same place (the second delete finds nothing to delete)
const DESTRUCTIVE = {
  readOnlyHint: false,
  destructiveHint: true,
  idempotentHint: true,
  openWorldHint: false,
} as const;

/**
 * How many write-tool calls one HTTP request may carry. The MCP limiter
 * (`mcpRateLimit`) counts requests, and the transport accepts a JSON-RPC
 * batch of up to 100 messages in one — so without this a single request
 * could be a hundred writes of a hundred games each. Clients send one tool
 * call per request anyway; this makes that the rule for writes.
 */
const WRITES_PER_REQUEST = 1;

/** A game, the way every write tool takes one. */
const gameRef = z.string().trim().min(1).max(300);
const gameList = (what: string) =>
  z
    .array(gameRef)
    .min(1)
    .max(MAX_GAMES_PER_WRITE)
    .describe(
      `${what}, up to ${MAX_GAMES_PER_WRITE}: each a library id from the other tools, or the game's exact title.`,
    );
const hoursField = (what: string) =>
  z
    .number()
    .min(0)
    .max(MAX_TTB_SECONDS / 3600)
    .nullable()
    .optional()
    .describe(`${what} in hours. null clears it; leave it out to keep what's there.`);

/** A checklist item: just its text, or its text under a chapter. */
const checklistItem = z.union([
  z.string().trim().min(1).max(CHECKLIST_ENTRY_MAX),
  z.object({
    text: z
      .string()
      .trim()
      .min(1)
      .max(CHECKLIST_ENTRY_MAX)
      .describe("The item: a mission, boss, collectible, ending…"),
    chapter: z
      .string()
      .trim()
      .max(CHECKLIST_CHAPTER_MAX)
      .optional()
      .describe('The chapter, act or area it sits under, e.g. "Act 1" or "Limgrave".'),
  }),
]);

/** Which of a game's checklists, the way get_checklist and tick_checklist_items take it. */
const listRef = z
  .string()
  .trim()
  .min(1)
  .max(CHECKLIST_TITLE_MAX)
  .optional()
  .describe(
    "The checklist's title, as get_game names it (ignoring case). Can be left out when the game has only one checklist.",
  );

/** What each link role says relatedGame is to game — spelled out per role, so a new one can't go undescribed. */
const LINK_ROLE_HINTS: Record<GameLinkRole, string> = {
  base_game: "the game `game` is DLC for",
  original: "the game `game` remakes or remasters",
  included_in: "a compilation, collection or bundle `game` is part of",
  dlc: "DLC or an expansion for `game`",
  prequel: "comes before `game`",
  sequel: "follows `game`",
  remake: "a remake or remaster of `game`",
  contains: "a game included in `game`, which is a compilation, collection or bundle",
};
const LINK_ROLE_GUIDE = GAME_LINK_ROLES.map((role) => `${role}: ${LINK_ROLE_HINTS[role]}`).join("; ");

/** Who a delete tool's `confirm` is for. */
const confirmField = z
  .boolean()
  .optional()
  .describe(
    "Leave out (or false) to see what would be deleted without deleting anything. true deletes — only once the user has agreed to what the preview showed.",
  );

/** Which of the user's collections, the way the collection tools take it. */
const collectionRef = {
  collectionId: z.string().uuid().optional().describe("The collection's id, from list_collections."),
  collectionName: z.string().optional().describe("The collection's name, if you don't have its id."),
};

/** One MCP server, for one request, for one caller. */
export function buildMcpServer(caller: McpCaller): McpServer {
  const userId = caller.user.id;
  const access: McpAccess = { userId, via: caller.via, canWrite: caller.canWrite };
  let writes = 0;
  /** A write tool's result: the per-request cap, then the tool (which checks permission). */
  const write = (fn: () => Promise<unknown>) =>
    run(() => {
      writes += 1;
      if (writes > WRITES_PER_REQUEST) {
        throw new McpToolError("Send one change per request — this one already made one.");
      }
      return fn();
    });

  const server = new McpServer(
    { name: "game-manager", title: "Game Manager", version: "0.1.0" },
    { instructions: INSTRUCTIONS },
  );

  server.registerTool(
    "list_library",
    {
      title: "List library",
      description: `List games in the user's library, optionally filtered, a page at a time. Each game has its id (for get_game), title, release year, category, the user's rating (out of 5), platforms with physical/digital format, tags, started/finished dates, whether it's 100% complete and whether it's marked endless, Steam hours played, time-to-beat hours (main story / main+extras / completionist, with their source) and mission-list progress when there is one. Filters combine (AND). Returns \`total\` (every game that matched), up to \`limit\` of them starting at \`offset\`, and \`nextOffset\` for the next page (null on the last). To walk the whole library, call again with offset = nextOffset until it's null. \`fields\` cuts each row down to id, title and the fields named — use it for big libraries, where full rows are large. To find games missing something, use the has*/missing* filters rather than listing everything: e.g. missingTagGroup "Genre" for games with no Genre tag, hasTimeToBeat false, hasChecklist false, hasPlatform false.`,
      inputSchema: {
        category: z
          .union([z.string(), z.array(z.string()).min(1).max(20)])
          .optional()
          .describe('Category name or key, or a list of them (any of), e.g. "Playing", "backlog", or a custom category\'s name.'),
        platform: z
          .string()
          .optional()
          .describe('Platform name or abbreviation, e.g. "Switch", "PS5", "Steam". "PC" includes PC storefronts.'),
        tag: z.string().optional().describe("Tag name, exact (case-insensitive)."),
        search: z.string().optional().describe("Text the title contains (case-insensitive)."),
        hasTags: z.boolean().optional().describe("false for games with no tags at all; true for games with at least one."),
        missingTagGroup: z
          .string()
          .optional()
          .describe('Only games with no tag in this tag group (case-insensitive), e.g. "Genre". list_tags shows the groups.'),
        hasTimeToBeat: z
          .boolean()
          .optional()
          .describe("false for games with no time-to-beat figure from anywhere; true for games with one."),
        timeToBeatSource: z
          .enum(TTB_SOURCES)
          .optional()
          .describe("Only games whose time to beat comes from here: yours (the user's own figure), igdb, manual (old hand-entered catalog figures) or community."),
        hasChecklist: z
          .boolean()
          .optional()
          .describe("false for games with no checklist of the user's (main story or extra); true for games with one."),
        hasPlatform: z.boolean().optional().describe("false for games not filed under any platform; true for games on at least one."),
        endless: z.boolean().optional().describe("true for games marked endless (no length); false for the rest."),
        sort: z
          .enum(LIBRARY_SORTS)
          .optional()
          .describe("Order: title (default), rating (highest first), recently_added, shortest or longest main story. Ties go by title, so pages are stable."),
        offset: z.number().int().min(0).optional().describe("Skip this many matching games (default 0) — pass nextOffset from the last page."),
        limit: z
          .number()
          .int()
          .min(1)
          .max(LIBRARY_PAGE_MAX)
          .optional()
          .describe(`Most games to return (default 100, at most ${LIBRARY_PAGE_MAX}).`),
        fields: z
          .array(z.enum(LIBRARY_FIELDS))
          .max(LIBRARY_FIELDS.length)
          .optional()
          .describe("Only these fields on each row, besides id and title (always included). Leave out for full rows."),
      },
      annotations: { title: "List library", ...READ_ONLY },
    },
    (args) => run(() => toolListLibrary(userId, args)),
  );

  server.registerTool(
    "get_game",
    {
      title: "Get game",
      description:
        "One game from the user's library in full: everything list_library returns plus the IGDB summary, the user's notes, mission-list progress (percent, missions done of total, hours remaining on the chosen time-to-beat basis — the same figures as the game's Progress tab), every checklist with done/total counts, and linked games (DLC, prequels, sequels, remakes, base game, original). Pass the id from another tool, or a title.",
      inputSchema: {
        id: z.string().uuid().optional().describe("The game's library id, from list_library and the other tools."),
        title: z
          .string()
          .optional()
          .describe("The game's title, if you don't have its id. An exact title wins; several partial matches return their ids to choose from."),
      },
      annotations: { title: "Get game", ...READ_ONLY },
    },
    (args) => run(() => toolGetGame(userId, args)),
  );

  server.registerTool(
    "get_dashboard",
    {
      title: "Get dashboard",
      description:
        "The user's dashboard stats: total games, games per category and per platform, total backlog hours (main story of every Backlog game not marked endless) and the most recently finished games with their ratings.",
      inputSchema: {},
      annotations: { title: "Get dashboard", ...READ_ONLY },
    },
    () => run(() => toolGetDashboard(userId)),
  );

  server.registerTool(
    "list_collections",
    {
      title: "List collections",
      description:
        "The user's collections — series, marathons and reading lists of games, which may include games they don't own. Each has its id (for get_collection), name, description, game count, how many the user has finished, total and remaining hours, and how many games have no known length.",
      inputSchema: {},
      annotations: { title: "List collections", ...READ_ONLY },
    },
    () => run(() => toolListCollections(userId)),
  );

  server.registerTool(
    "get_collection",
    {
      title: "Get collection",
      description:
        "One of the user's collections with its games in play order (the collection's numbered list), each with whether the user owns it, its category in their library, whether it's finished, and hours total/remaining. Also lists each named graph's arrows (e.g. play order vs story order) as \"A → B\". Pass the id from list_collections, or a name.",
      inputSchema: {
        id: z.string().uuid().optional().describe("The collection's id, from list_collections."),
        name: z.string().optional().describe("The collection's name, if you don't have its id."),
      },
      annotations: { title: "Get collection", ...READ_ONLY },
    },
    (args) => run(() => toolGetCollection(userId, args)),
  );

  server.registerTool(
    "list_categories",
    {
      title: "List categories",
      description:
        "Every category the user can file a game under — the seven built-ins and their custom ones — with how many games each holds. Use the names with list_library's category filter.",
      inputSchema: {},
      annotations: { title: "List categories", ...READ_ONLY },
    },
    () => run(() => toolListCategories(userId)),
  );

  server.registerTool(
    "list_tags",
    {
      title: "List tags",
      description:
        "Every tag the user has, by group (e.g. Genre, Franchise, Mode), each with its name, group, colour and how many games carry it — plus the list of groups. Use it before update_tag or delete_tags, and to find a group's name for list_library's missingTagGroup filter. Tags on no games show 0.",
      inputSchema: {
        group: z.string().optional().describe("Only the tags in this group (case-insensitive)."),
      },
      annotations: { title: "List tags", ...READ_ONLY },
    },
    (args) => run(() => toolListTags(userId, args)),
  );

  server.registerTool(
    "get_backlog_candidates",
    {
      title: "Get backlog candidates",
      description:
        "Games the user could play next: everything in Backlog, Shelved and Wishlist (or the subset you name), shortest remaining first. Each has hours remaining (pro-rated by mission progress when there is any), main-story and completionist hours, platforms, tags, the user's rating and the community average rating, whether it's marked endless, and when it was added. Games with no known length come last. Use this for \"what should I play next?\" questions.",
      inputSchema: {
        categories: z
          .array(z.enum(BACKLOG_CANDIDATE_CATEGORIES))
          .optional()
          .describe("Which of backlog, shelved and wishlist to include (default: all three)."),
        platform: z
          .string()
          .optional()
          .describe('Only games on this platform, e.g. "Switch" or "PC" (PC includes Steam and other stores).'),
        maxHours: z
          .number()
          .positive()
          .optional()
          .describe("Only games with at most this many hours remaining (drops games of unknown length)."),
        limit: z.number().int().min(1).max(500).optional().describe("Most games to return (default 100)."),
      },
      annotations: { title: "Get backlog candidates", ...READ_ONLY },
    },
    (args) => run(() => toolGetBacklogCandidates(userId, args)),
  );

  server.registerTool(
    "get_checklist",
    {
      title: "Get checklist",
      description:
        "One of the user's checklists for a game in their library, item by item: each item's number (from 1, in the order the game's Progress tab shows them), text, chapter, and whether it's ticked and when, plus done/total, where the list came from (source) and whether ticking an item also ticks the ones before it (sequential). edit_checklist_items takes the same numbers. Use it to find what tick_checklist_items should tick — by number when the user describes items rather than naming them (\"the first three Act 1 missions\"). get_game names a game's checklists.",
      inputSchema: {
        game: gameRef.describe("A game in the user's library: its library id, or its exact title."),
        list: listRef,
      },
      annotations: { title: "Get checklist", ...READ_ONLY },
    },
    (args) => run(() => toolGetChecklist(userId, args)),
  );

  server.registerTool(
    "get_achievements",
    {
      title: "Get achievements",
      description:
        "The Steam achievements for a game in the user's library, synced from their linked Steam account: each one's name, description, whether the user has unlocked it and on what day — unlocked first, newest first, then locked ones by name — plus how many of how many are unlocked and their Steam hours. Empty, with a note, when the game isn't matched to a Steam app or hasn't been synced. Compare with get_checklist to tick items the user's unlocks show they've done: tick_checklist_items' steamAchievements option ticks items named exactly like an unlocked achievement, and items worded differently can be ticked by number.",
      inputSchema: {
        game: gameRef.describe("A game in the user's library: its library id, or its exact title."),
        unlocked: z
          .boolean()
          .optional()
          .describe("true for only the unlocked achievements, false for only the locked ones; leave it out for all."),
      },
      annotations: { title: "Get achievements", ...READ_ONLY },
    },
    (args) => run(() => toolGetAchievements(userId, args)),
  );

  // ---- writes: listed for everyone, refused unless the credential allows
  // changes (each tool checks), one per request

  server.registerTool(
    "create_tag",
    {
      title: "Create tag",
      description:
        'Make a tag the user can put on games, e.g. "Co-op" in the group "Mode", or "Zelda" in "Franchise". If the user already has a tag with that name (ignoring case) it\'s returned unchanged — update_tag renames or restyles one. Use tag_games to put it on games (tag_games also makes the tag if it\'s missing).',
      inputSchema: {
        name: z.string().trim().min(1).max(60).describe("The tag's name."),
        color: z
          .string()
          .regex(/^#[0-9a-fA-F]{6}$/, "A hex colour like #8b5cf6")
          .optional()
          .describe("Hex colour like #8b5cf6, for a new tag."),
        group: z
          .string()
          .trim()
          .min(1)
          .max(60)
          .optional()
          .describe('Group the tag sits under, e.g. "Franchise", "Mode" or "Mood", for a new tag.'),
      },
      annotations: { title: "Create tag", ...WRITE },
    },
    (args) => write(() => toolCreateTag(access, args)),
  );

  server.registerTool(
    "tag_games",
    {
      title: "Tag games",
      description:
        "Add one tag to games in the user's library, keeping every other tag they already have. The tag is made first if the user doesn't have it (with the optional group and colour; an existing tag's group and colour are left alone — update_tag changes them). Games must be in the library. Returns how many games got the tag, how many already had it, and each game that couldn't be found with the reason (an ambiguous or near-miss title comes back with ids to use instead).",
      inputSchema: {
        tag: z.string().trim().min(1).max(60).describe("The tag's name (matched ignoring case)."),
        group: z
          .string()
          .trim()
          .min(1)
          .max(60)
          .optional()
          .describe('Group for the tag if it has to be made, e.g. "Franchise".'),
        color: z
          .string()
          .regex(/^#[0-9a-fA-F]{6}$/, "A hex colour like #8b5cf6")
          .optional()
          .describe("Hex colour like #8b5cf6 for the tag if it has to be made."),
        games: gameList("Games to tag"),
      },
      annotations: { title: "Tag games", ...WRITE },
    },
    (args) => write(() => toolTagGames(access, args)),
  );

  server.registerTool(
    "untag_games",
    {
      title: "Untag games",
      description:
        "Take one tag off games in the user's library. Only removes the tag from those games — the tag itself, and its use on every other game, stays. Returns how many games lost the tag, how many didn't have it, and any that couldn't be found.",
      inputSchema: {
        tag: z.string().trim().min(1).max(60).describe("The tag's name (matched ignoring case)."),
        games: gameList("Games to untag"),
      },
      annotations: { title: "Untag games", ...WRITE },
    },
    (args) => write(() => toolUntagGames(access, args)),
  );

  server.registerTool(
    "create_collection",
    {
      title: "Create collection",
      description:
        "Make a collection — a series, marathon or reading list of games — optionally starting it with games in order. Always private: only the user can publish it, from the web app. Games don't have to be owned: a title that isn't in the library is looked up in the shared catalog and then on IGDB, and an ambiguous one comes back with igdb:<id> references to pass instead. If the user already has a collection with that name (ignoring case), that one is used, unchanged, and the games are added to it.",
      inputSchema: {
        name: z.string().trim().min(1).max(100).describe("The collection's name."),
        description: z.string().max(2000).optional().describe("A line or two about it."),
        accentColor: z
          .string()
          .regex(/^#[0-9a-fA-F]{6}$/, "A hex colour like #8b5cf6")
          .optional()
          .describe("Hex colour like #8b5cf6."),
        games: z
          .array(gameRef)
          .max(MAX_GAMES_PER_WRITE)
          .optional()
          .describe(
            `Games to start with, in play order, up to ${MAX_GAMES_PER_WRITE}: library ids, igdb:<id> references, or exact titles.`,
          ),
      },
      annotations: { title: "Create collection", ...WRITE },
    },
    (args) => write(() => toolCreateCollection(access, args)),
  );

  server.registerTool(
    "add_games_to_collection",
    {
      title: "Add games to collection",
      description:
        "Append games to one of the user's collections, in the order given, after the games already in it. Games already in the collection keep their place. Games don't have to be owned (see create_collection for how titles are looked up). Returns how many were added, how many were already there, and any that couldn't be found.",
      inputSchema: {
        collectionId: z.string().uuid().optional().describe("The collection's id, from list_collections."),
        collectionName: z.string().optional().describe("The collection's name, if you don't have its id."),
        games: z
          .array(gameRef)
          .min(1)
          .max(MAX_GAMES_PER_WRITE)
          .describe(
            `Games to append, in order, up to ${MAX_GAMES_PER_WRITE}: library ids, igdb:<id> references, or exact titles.`,
          ),
      },
      annotations: { title: "Add games to collection", ...WRITE },
    },
    (args) => write(() => toolAddGamesToCollection(access, args)),
  );

  server.registerTool(
    "create_checklist",
    {
      title: "Create checklist",
      description:
        "Make a progress checklist for a game in the user's library — a list on the game's Progress tab that the user ticks off as they play — or add items to one they already have. Two kinds: main_story is the story's missions, chapters or bosses in play order; a game has at most one, and it's what the Progress tab divides the game's time to beat across, so it gives the game its progress percentage and hours remaining. extra (the default) is anything else — collectibles, side quests, endings, trophies — as many lists as the user likes, untimed. Items can sit under chapters (acts, areas, regions). If the game already has a list with this title (ignoring case), the items are appended to it and items it already has are skipped, so repeating a call adds nothing twice; asking for a second main story list is refused, naming the one the game has. Lists are always private (only the user can publish one, from the web app) and start with nothing ticked — tick_checklist_items ticks items once the user has done them. Build a list from what the user gave you or a source you can name, pass that as source, and tell the user where the items came from: a mission list recalled from memory is easy to get wrong. update_checklist and edit_checklist_items fix a list afterwards.",
      inputSchema: {
        game: gameRef.describe("A game in the user's library: its library id, or its exact title."),
        title: z
          .string()
          .trim()
          .min(1)
          .max(CHECKLIST_TITLE_MAX)
          .describe(
            'The list\'s name, e.g. "Main story", "Bosses" or "Riddler trophies". An existing list with this name is added to.',
          ),
        kind: z
          .enum(CHECKLIST_KIND_INPUTS)
          .optional()
          .describe("main_story for the story in play order (one per game; it drives the progress estimate), or extra (default) for anything else."),
        items: z
          .array(checklistItem)
          .min(1)
          .max(MAX_CHECKLIST_ENTRIES_PER_WRITE)
          .describe(
            `Up to ${MAX_CHECKLIST_ENTRIES_PER_WRITE} items, in order: each a string, or { text, chapter } to put it under a chapter. Repeats are kept (several "Mask Shard" entries are several entries).`,
          ),
        sequential: z
          .boolean()
          .optional()
          .describe("Main story lists only: ticking an item also ticks every item before it, for a story played in order. Off by default; the user can switch it in the app."),
        source: z
          .string()
          .trim()
          .min(1)
          .max(CHECKLIST_SOURCE_MAX)
          .optional()
          .describe(
            "Where the items came from: a URL, or a short description (\"the user's own list\", \"the game's manual\"). Shown under the list in the app and returned by get_checklist. Fills in an existing list's source only if it has none.",
          ),
      },
      annotations: { title: "Create checklist", ...WRITE },
    },
    (args) => write(() => toolCreateChecklist(access, args)),
  );

  server.registerTool(
    "tick_checklist_items",
    {
      title: "Tick checklist items",
      description:
        "Record progress on one of the user's checklists for a game in their library: tick items off as done or, with done: false, untick them. Use it when the user says they did something (\"I just beat Margit\", \"mark the first three Act 1 missions done\") or asks you to tick what their Steam achievements show. Name items by their exact text (case and punctuation aside), by number from get_checklist, or both; with steamAchievements, every item named exactly like a Steam achievement the user has unlocked for the game is ticked too. Nothing is guessed: text that matches no item comes back in notFound with the closest items and their numbers, and text that matches several items (repeats like \"Mask Shard\") comes back with their numbers to choose from — call again by number. On a sequential main story list, ticking an item also ticks every unticked item before it, as the app does; unticking clears only the items named. Only tick what the user says they've done, or what their unlocked achievements show. Returns what changed, the list's done/total, and the game's progress percentage and hours remaining.",
      inputSchema: {
        game: gameRef.describe("A game in the user's library: its library id, or its exact title."),
        list: listRef,
        items: z
          .array(checklistItem)
          .max(MAX_CHECKLIST_ENTRIES_PER_WRITE)
          .optional()
          .describe(
            "Items by their exact text: each a string, or { text, chapter } to say which chapter's item when the same text is under several.",
          ),
        numbers: z
          .array(z.number().int().min(1))
          .max(MAX_CHECKLIST_ENTRIES_PER_WRITE)
          .optional()
          .describe("Items by their number on the list, from 1 — the numbers get_checklist shows."),
        steamAchievements: z
          .boolean()
          .optional()
          .describe(
            "Also tick every item whose text is exactly the name of a Steam achievement the user has unlocked for this game. Ticking only.",
          ),
        done: z.boolean().optional().describe("true (the default) ticks the items; false unticks them."),
      },
      annotations: { title: "Tick checklist items", ...WRITE },
    },
    (args) => write(() => toolTickChecklistItems(access, args)),
  );

  server.registerTool(
    "link_games",
    {
      title: "Link games",
      description: `Record how two games relate, as on a game's Linked tab. \`role\` says what relatedGame is to game — ${LINK_ROLE_GUIDE}. A link is stored once and shows on both games (a prequel on one is the sequel on the other; DLC on one is the base game on the other; a game a compilation contains is included_in it), so link each pair once. Use contains/included_in for compilations and bundles (Halo: The Master Chief Collection contains Halo 3) rather than dlc or remake. Neither game has to be owned. Linking the same pair the same way again changes nothing; any other link between the same two games is refused, naming where the existing one is — unlink_games removes it first — and a game can't be linked to itself.`,
      inputSchema: {
        game: gameRef.describe("The game whose Linked tab this is: a library id, igdb:<id>, or exact title."),
        relatedGame: gameRef.describe("The game being linked to it: a library id, igdb:<id>, or exact title."),
        role: z.enum(GAME_LINK_ROLES).describe("What relatedGame is to game."),
      },
      annotations: { title: "Link games", ...WRITE },
    },
    (args) => write(() => toolLinkGames(access, args)),
  );

  server.registerTool(
    "set_time_to_beat",
    {
      title: "Set time to beat",
      description:
        "Record how long a game in the user's library took them, or should take them: main story, main + extras, completionist, in hours. This is the user's own figure: from then on it's what they see for the game in place of IGDB's (only they do — everyone else still sees IGDB's), it drives their progress estimate and backlog hours, and it feeds the community average other players see for games IGDB has no figure for. So only set it when the user states it, or asks you to override IGDB's with a figure from a reliable source; never guess. Each figure is stored in the field you give it in (main 6 and completionist 14 stay main 6 and completionist 14), as long as main ≤ main + extras ≤ completionist; figures out of that order are sorted, and the result says so (reordered) so you can check. The result shows what was stored, where the figure the user sees now comes from (source) and IGDB's figure beside it. Clearing all three removes the user's figure, and the game goes back to IGDB's.",
      inputSchema: {
        game: gameRef.describe("A library id, or the game's exact title."),
        mainHours: hoursField("Main story"),
        mainExtraHours: hoursField("Main story plus extras"),
        completionistHours: hoursField("Everything (100%)"),
      },
      annotations: { title: "Set time to beat", ...WRITE },
    },
    (args) => write(() => toolSetTimeToBeat(access, args)),
  );

  // ---- edits and deletes (services/mcp-edit-tools.ts): the same permission
  // and one-per-request cap, and the deletes preview unless confirmed

  const calendarDay = z.iso.date("A date like 2026-08-15").nullable().optional();

  server.registerTool(
    "update_game",
    {
      title: "Update game",
      description:
        "Change a game in the user's library: its category, rating, started/finished dates, notes, whether it's 100% complete, whether it's endless, and which platforms it's owned on. Only the fields given change; null clears rating, dates or notes. Rules are the app's: the category must exist (list_categories); ratings are 0.5 to 5 in half stars; a finish date before the start date is refused; moving a game to Playing or Finished for the first time stamps today's date unless you give one, as the app does. Marking a game endless (online and live-service games with no real length — IGDB's hours for those are often nonsense) takes it out of backlog hours and time totals. Platforms are named like \"Game Boy Advance\", \"GBA\", \"Switch\" or \"Steam\", each physical or digital; platformMode says whether they're added to what the game has (default), replace it, or are removed. Returns each field that changed, from → to.",
      inputSchema: {
        game: gameRef.describe("A game in the user's library: its library id, or its exact title."),
        category: z.string().min(1).max(100).optional().describe('Category name or key, e.g. "Finished" or a custom category\'s name.'),
        rating: z
          .number()
          .min(0.5)
          .max(5)
          .multipleOf(0.5)
          .nullable()
          .optional()
          .describe("Out of 5 in half stars (0.5, 1 … 5). null clears it."),
        startedAt: calendarDay.describe("When the user started it, YYYY-MM-DD. null clears it."),
        finishedAt: calendarDay.describe("When the user finished it, YYYY-MM-DD; not before startedAt. null clears it."),
        notes: z.string().max(10_000).nullable().optional().describe("The user's notes on the game — replaces what's there. null clears them."),
        completed100: z.boolean().optional().describe("Whether the user has 100%-completed it."),
        endless: z
          .boolean()
          .optional()
          .describe("true for a game with no length to finish (multiplayer, live-service): it leaves backlog hours and time totals."),
        platforms: z
          .array(
            z.object({
              platform: z.string().trim().min(1).max(100).describe('Platform name or abbreviation, e.g. "Game Boy Advance", "GBA", "Steam".'),
              format: z.enum(OWNERSHIP_FORMATS).optional().describe("physical or digital — required unless removing."),
            }),
          )
          .max(20)
          .optional()
          .describe("Platforms the game is owned on; see platformMode."),
        platformMode: z
          .enum(PLATFORM_MODES)
          .optional()
          .describe("add (default): on these as well as its current platforms. replace: exactly these ([] clears them all). remove: off these, whatever the format."),
      },
      annotations: { title: "Update game", ...DESTRUCTIVE },
    },
    (args) => write(() => toolUpdateGame(access, args)),
  );

  server.registerTool(
    "update_games",
    {
      title: "Update games",
      description: `Set the category, endless flag or 100% flag on many games in the user's library at once — the app's bulk-edit bar. E.g. mark a list of online games endless so their junk IGDB hours leave backlog totals, or move games to Shelved. Moving games to Playing or Finished stamps today's start or finish date on those without one, as the app does (update_game sets real dates). Returns how many changed, how many already were that way, and any games that couldn't be found.`,
      inputSchema: {
        games: gameList("Games to change"),
        category: z.string().min(1).max(100).optional().describe("Category name or key to move them all to."),
        endless: z.boolean().optional().describe("true marks them all endless (no length); false unmarks them."),
        completed100: z.boolean().optional().describe("Whether they're all 100%-completed."),
      },
      annotations: { title: "Update games", ...DESTRUCTIVE },
    },
    (args) => write(() => toolUpdateGames(access, args)),
  );

  server.registerTool(
    "delete_game",
    {
      title: "Delete game",
      description:
        "Remove a game from the user's library — e.g. a duplicate entry. Without confirm: true nothing is deleted: the result shows the entry (category, rating, platforms, tags, dates) that would go, and what stays because it belongs to the game rather than the entry (its checklists, links, collections and the user's own play time, all back if the game is added again). Show the user that, then call again with confirm: true once they agree. Pass the library id when two entries share a title.",
      inputSchema: {
        game: gameRef.describe("A game in the user's library: its library id (best, for duplicates), or its exact title."),
        confirm: confirmField,
      },
      annotations: { title: "Delete game", ...DESTRUCTIVE },
    },
    (args) => write(() => toolDeleteGame(access, args)),
  );

  server.registerTool(
    "update_tag",
    {
      title: "Update tag",
      description:
        "Rename one of the user's tags, change its colour, or move it to another group (or out of any group with null). The tag stays on every game it's on. Renaming onto a name the user already has is refused. list_tags shows the tags.",
      inputSchema: {
        tag: z.string().trim().min(1).max(60).describe("The tag's current name (matched ignoring case)."),
        name: z.string().trim().min(1).max(60).optional().describe("Its new name."),
        color: z
          .string()
          .regex(/^#[0-9a-fA-F]{6}$/, "A hex colour like #8b5cf6")
          .nullable()
          .optional()
          .describe("Hex colour like #8b5cf6; null clears it."),
        group: z.string().trim().min(1).max(60).nullable().optional().describe('Group, e.g. "Genre"; null takes it out of its group.'),
      },
      annotations: { title: "Update tag", ...DESTRUCTIVE },
    },
    (args) => write(() => toolUpdateTag(access, args)),
  );

  server.registerTool(
    "delete_tags",
    {
      title: "Delete tags",
      description: `Delete tags the user has, by name, or every tag in a group. A deleted tag comes off every game it was on; the games stay. Without confirm: true nothing is deleted: the result lists each tag that would go and how many games carry it. Show the user that, then call again with confirm: true once they agree. Up to ${MAX_GAMES_PER_WRITE} tags per call.`,
      inputSchema: {
        tags: z
          .array(z.string().trim().min(1).max(60))
          .max(MAX_GAMES_PER_WRITE)
          .optional()
          .describe("Tag names (matched ignoring case)."),
        group: z.string().trim().min(1).max(60).optional().describe("Delete every tag in this group as well."),
        confirm: confirmField,
      },
      annotations: { title: "Delete tags", ...DESTRUCTIVE },
    },
    (args) => write(() => toolDeleteTags(access, args)),
  );

  server.registerTool(
    "unlink_games",
    {
      title: "Unlink games",
      description:
        "Remove the link between two games, whichever way it was recorded — it goes from both games' Linked tabs. Use it to undo a wrong link, or before linking the pair another way (link_games refuses a second link between the same two games). relatedGame is matched among the games linked to game, so an error lists what game is actually linked to.",
      inputSchema: {
        game: gameRef.describe("One of the two games: a library id, catalog id or exact title."),
        relatedGame: gameRef.describe("The game linked to it: an id or its exact title."),
      },
      annotations: { title: "Unlink games", ...DESTRUCTIVE },
    },
    (args) => write(() => toolUnlinkGames(access, args)),
  );

  server.registerTool(
    "update_checklist",
    {
      title: "Update checklist",
      description:
        "Change one of the user's checklists for a game: its title, its kind (main_story — the one list a game's progress percentage comes from — or extra), whether it's sequential (main story only: ticking an item ticks the ones before it), or where its items came from (source). A game has one main story list, so making a list the main story is refused while another is; make that one an extra first. Turning the main story list into an extra takes the game's progress percentage with it. edit_checklist_items changes the items.",
      inputSchema: {
        game: gameRef.describe("A game in the user's library: its library id, or its exact title."),
        list: listRef,
        title: z.string().trim().min(1).max(CHECKLIST_TITLE_MAX).optional().describe("Its new title."),
        kind: z.enum(CHECKLIST_KIND_INPUTS).optional().describe("main_story or extra."),
        sequential: z.boolean().optional().describe("Main story lists only."),
        source: z
          .string()
          .trim()
          .min(1)
          .max(CHECKLIST_SOURCE_MAX)
          .nullable()
          .optional()
          .describe("Where the items came from: a URL or a short description. null clears it."),
      },
      annotations: { title: "Update checklist", ...DESTRUCTIVE },
    },
    (args) => write(() => toolUpdateChecklist(access, args)),
  );

  server.registerTool(
    "edit_checklist_items",
    {
      title: "Edit checklist items",
      description:
        "Fix the items on one of the user's checklists: edit an item's text or chapter, remove items, and put items in a new order — all in one call, applied together or not at all. Items are named by their numbers from get_checklist, as the list stands before this call (so a call that removes #3 and edits #7 means the #7 get_checklist showed). order lists items in their new order; items it leaves out keep their order after the ones it names — so [1, 2, 12] moves item 12 to third, and a full list of numbers sets the whole order. Removing an item removes its tick. To add items, use create_checklist with the list's title. Returns what changed; numbers change after a remove or reorder, so call get_checklist again before another edit.",
      inputSchema: {
        game: gameRef.describe("A game in the user's library: its library id, or its exact title."),
        list: listRef,
        edit: z
          .array(
            z.object({
              number: z.number().int().min(1).describe("The item's number from get_checklist."),
              text: z.string().trim().min(1).max(CHECKLIST_ENTRY_MAX).optional().describe("Its new text."),
              chapter: z
                .string()
                .trim()
                .max(CHECKLIST_CHAPTER_MAX)
                .nullable()
                .optional()
                .describe("Its new chapter; null (or \"\") takes it out of any chapter."),
            }),
          )
          .max(MAX_CHECKLIST_ENTRIES_PER_WRITE)
          .optional()
          .describe("Items to change."),
        remove: z
          .array(z.number().int().min(1))
          .max(MAX_CHECKLIST_ENTRIES_PER_WRITE)
          .optional()
          .describe("Numbers of items to remove."),
        order: z
          .array(z.number().int().min(1))
          .max(MAX_CHECKLIST_ENTRIES_PER_WRITE)
          .optional()
          .describe("Item numbers in their new order; ones left out follow, in their current order."),
      },
      annotations: { title: "Edit checklist items", ...DESTRUCTIVE, idempotentHint: false },
    },
    (args) => write(() => toolEditChecklistItems(access, args)),
  );

  server.registerTool(
    "delete_checklist",
    {
      title: "Delete checklist",
      description:
        "Delete one of the user's checklists for a game, with its items and ticks. Without confirm: true nothing is deleted: the result shows the list, how many items it has and how many are ticked. Show the user that, then call again with confirm: true once they agree. Deleting the main story list takes the game's progress percentage with it.",
      inputSchema: {
        game: gameRef.describe("A game in the user's library: its library id, or its exact title."),
        list: listRef,
        confirm: confirmField,
      },
      annotations: { title: "Delete checklist", ...DESTRUCTIVE },
    },
    (args) => write(() => toolDeleteChecklist(access, args)),
  );

  server.registerTool(
    "remove_games_from_collection",
    {
      title: "Remove games from collection",
      description:
        "Take games out of one of the user's collections — off its list and every graph, with any arrows that touched them. The games stay in the library. Games are matched among the collection's own games, by id or exact title. Returns how many were removed and any that weren't in it.",
      inputSchema: {
        ...collectionRef,
        games: gameList("Games to remove"),
      },
      annotations: { title: "Remove games from collection", ...DESTRUCTIVE },
    },
    (args) => write(() => toolRemoveGamesFromCollection(access, args)),
  );

  server.registerTool(
    "update_collection",
    {
      title: "Update collection",
      description:
        "Rename one of the user's collections, change its description or colour, or reorder its games. order lists the collection's games (ids or exact titles) in their new play order; games it leaves out follow in their current order — every game named must be in the collection, or nothing changes. Graphs keep their own layouts. Renaming onto a name the user already has is refused. Never publishes: that's the user's call, in the app.",
      inputSchema: {
        ...collectionRef,
        name: z.string().trim().min(1).max(100).optional().describe("Its new name."),
        description: z.string().max(2000).nullable().optional().describe("A line or two about it; null clears it."),
        accentColor: z
          .string()
          .regex(/^#[0-9a-fA-F]{6}$/, "A hex colour like #8b5cf6")
          .nullable()
          .optional()
          .describe("Hex colour like #8b5cf6; null clears it."),
        order: z
          .array(gameRef)
          .max(500)
          .optional()
          .describe("The collection's games in their new order: ids or exact titles."),
      },
      annotations: { title: "Update collection", ...DESTRUCTIVE },
    },
    (args) => write(() => toolUpdateCollection(access, args)),
  );

  server.registerTool(
    "delete_collection",
    {
      title: "Delete collection",
      description:
        "Delete one of the user's collections, with its order and graphs. The games stay in the library. Named by id or exact name (no partial matches). Without confirm: true nothing is deleted: the result shows the collection, how many games it lists and its graphs. Show the user that, then call again with confirm: true once they agree.",
      inputSchema: {
        ...collectionRef,
        confirm: confirmField,
      },
      annotations: { title: "Delete collection", ...DESTRUCTIVE },
    },
    (args) => write(() => toolDeleteCollection(access, args)),
  );

  return server;
}

/**
 * A refusal an MCP client can act on. The `WWW-Authenticate` header is the
 * MCP authorization spec's starting point: it names the protected-resource
 * metadata, from which claude.ai finds the authorization server and begins
 * the OAuth flow. Claude Code with an API key just sees the 401.
 */
function refuse(reply: FastifyReply, result: Exclude<McpAuth, { ok: true }>) {
  const metadata = `resource_metadata="${PROTECTED_RESOURCE_METADATA_URL}"`;
  if (result.status === 403) {
    return reply
      .status(403)
      .header(
        "www-authenticate",
        `Bearer error="insufficient_scope", scope="${MCP_SCOPE}", ${metadata}`,
      )
      .send({ error: "insufficient_scope", message: `This token wasn't granted ${MCP_SCOPE}.` });
  }
  return reply
    .status(401)
    .header(
      "www-authenticate",
      result.presented ? `Bearer error="invalid_token", ${metadata}` : `Bearer ${metadata}`,
    )
    .send({
      error: "unauthorized",
      message:
        "Send a Game Manager API key or an OAuth access token as `Authorization: Bearer <credential>`.",
    });
}

export function registerMcpRoutes(app: FastifyInstance): void {
  app.route({
    method: ["GET", "POST", "DELETE"],
    url: "/api/mcp",
    config: mcpRateLimit,
    async handler(request, reply) {
      const result = await authenticateMcp(request.headers.authorization);
      if (!result.ok) return refuse(reply, result);
      const { caller } = result;
      // the activity log (server.ts onResponse) counts MCP use like any other
      request.sessionUser = caller.user;

      if (request.method !== "POST") {
        return reply
          .status(405)
          .header("allow", "POST")
          .send({
            jsonrpc: "2.0",
            error: { code: -32000, message: "This server is stateless: only POST is supported." },
            id: null,
          });
      }

      const server = buildMcpServer(caller);
      // no session ids, and plain JSON responses rather than an SSE stream:
      // every tool answers in one go, so there's nothing to stream
      const transport = new WebStandardStreamableHTTPServerTransport({
        sessionIdGenerator: undefined,
        enableJsonResponse: true,
      });
      try {
        await server.connect(transport);
        const response = await transport.handleRequest(toFetchRequest(request, env.BETTER_AUTH_URL), {
          parsedBody: request.body,
        });
        return await sendFetchResponse(reply, response);
      } finally {
        await server.close();
      }
    },
  });
}
