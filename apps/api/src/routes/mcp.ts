import type { FastifyInstance, FastifyReply } from "fastify";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { WebStandardStreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js";
import { z } from "zod";
import { env } from "../env.js";
import { toFetchRequest, sendFetchResponse } from "../plugins/fetch-bridge.js";
import { mcpRateLimit } from "../plugins/rate-limits.js";
import { GAME_LINK_ROLES, GAME_LINK_ROLE_META, MCP_SCOPE } from "@gm/shared";
import { authenticateMcp, type McpAuth, type McpCaller } from "../services/mcp-auth.js";
import { PROTECTED_RESOURCE_METADATA_URL } from "../services/oauth.js";
import {
  CHECKLIST_CHAPTER_MAX,
  CHECKLIST_ENTRY_MAX,
  CHECKLIST_TITLE_MAX,
  MAX_CHECKLIST_ENTRIES_PER_WRITE,
} from "../services/checklists.js";
import {
  BACKLOG_CANDIDATE_CATEGORIES,
  CHECKLIST_KIND_INPUTS,
  LIBRARY_SORTS,
  MAX_GAMES_PER_WRITE,
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
 * Ring am I?" — and, when you've allowed it, tidies it up and records progress:
 * tags, collections, progress checklists and ticking them off, links between
 * games, your own play times. It lives under `/api` so the
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
 * app's write routes. What it can change is therefore exactly the nine
 * write tools below, and only when the credential was granted changes: a key
 * made with "Allow changes", or a token with `library:write`. Every caller
 * sees every tool listed; a read-only one gets an error result from a write
 * tool that says how to get a key or connection that can make changes.
 *
 * **Two ways in**, told apart by prefix in `services/mcp-auth.ts`: a
 * personal API key (Claude Code) or an OAuth access token granted
 * `library:read` (claude.ai's custom connector, see `services/oauth.ts`).
 */

const INSTRUCTIONS = `Game Manager is the user's personal video game library. Everything these tools return or change belongs to the signed-in user and nobody else.

Reading is always allowed. Changes are limited to nine tools — create_tag, tag_games, untag_games, create_collection, add_games_to_collection, create_checklist, tick_checklist_items, link_games and set_time_to_beat — and they only work when the user allowed changes for this connection (an API key made with "Allow changes" on, or "Allow changes" ticked when connecting); otherwise they return an error saying how to allow them. They add tags, collections, progress checklists, linked games and the user's own time-to-beat figures, untag_games takes a tag off games, and tick_checklist_items ticks checklist items off (or back on). Nothing here can delete a game, tag, collection or checklist, rename anything, change a game's category, rating, notes, platforms or dates, or publish a collection or checklist. Only make changes the user asked for, and tell them what changed.

Every game in the library is filed under one category: the built-ins are Uncategorized, Wishlist, Backlog, Playing, Finished, Shelved and Dropped, and the user may have custom ones too (list_categories). Games are owned on one or more platforms, each physical or digital; PC storefronts like Steam are "part of" PC, so filtering by PC includes them. Ratings are out of 5 in half stars. Times are in hours. "Time to beat" comes from IGDB, the user's own figure or a community average. A progress percentage exists only when the user keeps a main story checklist (mission list) for the game.

For "what should I play next?", start with get_backlog_candidates. To look at one game in depth, call get_game with the id from any other tool's results. The write tools take a game as its id from another tool's results or its exact title.

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
// every write only adds, removes an assignment (untag_games) or a tick
// (tick_checklist_items with done: false), and doing one twice changes
// nothing more than doing it once
const WRITE = {
  readOnlyHint: false,
  destructiveHint: false,
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

/** What each link role says the related game is, from GAME_LINK_ROLE_META's own hints. */
const LINK_ROLE_GUIDE = GAME_LINK_ROLES.map(
  (role) => `${role}: ${GAME_LINK_ROLE_META[role].hint.replace(/this game|this one/g, "game")}`,
).join("; ");

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
      description:
        "List games in the user's library, optionally filtered. Each game has its id (for get_game), title, release year, category, the user's rating (out of 5), platforms with physical/digital format, tags, started/finished dates, Steam hours played, time-to-beat hours (main story / main+extras / completionist) and mission-list progress when there is one. Filters combine (AND). Returns at most `limit` games plus the total that matched.",
      inputSchema: {
        category: z
          .string()
          .optional()
          .describe('Category name or key, e.g. "Playing", "backlog", or a custom category\'s name.'),
        platform: z
          .string()
          .optional()
          .describe('Platform name or abbreviation, e.g. "Switch", "PS5", "Steam". "PC" includes PC storefronts.'),
        tag: z.string().optional().describe("Tag name, exact (case-insensitive)."),
        search: z.string().optional().describe("Text the title contains (case-insensitive)."),
        sort: z
          .enum(LIBRARY_SORTS)
          .optional()
          .describe("Order: title (default), rating (highest first), recently_added, shortest or longest main story."),
        limit: z.number().int().min(1).max(500).optional().describe("Most games to return (default 100)."),
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
        "One of the user's checklists for a game in their library, item by item: each item's number (from 1, in the order the game's Progress tab shows them), text, chapter, and whether it's ticked and when, plus done/total and whether ticking an item also ticks the ones before it (sequential). Use it to find what tick_checklist_items should tick — by number when the user describes items rather than naming them (\"the first three Act 1 missions\"). get_game names a game's checklists.",
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
        'Make a tag the user can put on games, e.g. "Co-op" in the group "Mode", or "Zelda" in "Franchise". If the user already has a tag with that name (ignoring case) it\'s returned unchanged — this never renames or restyles a tag. Use tag_games to put it on games (tag_games also makes the tag if it\'s missing).',
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
        "Add one tag to games in the user's library, keeping every other tag they already have. The tag is made first if the user doesn't have it (with the optional group). Games must be in the library. Returns how many games got the tag, how many already had it, and each game that couldn't be found with the reason (an ambiguous or near-miss title comes back with ids to use instead).",
      inputSchema: {
        tag: z.string().trim().min(1).max(60).describe("The tag's name (matched ignoring case)."),
        group: z
          .string()
          .trim()
          .min(1)
          .max(60)
          .optional()
          .describe('Group for the tag if it has to be made, e.g. "Franchise".'),
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
        "Make a progress checklist for a game in the user's library — a list on the game's Progress tab that the user ticks off as they play — or add items to one they already have. Two kinds: main_story is the story's missions, chapters or bosses in play order; a game has at most one, and it's what the Progress tab divides the game's time to beat across, so it gives the game its progress percentage and hours remaining. extra (the default) is anything else — collectibles, side quests, endings, trophies — as many lists as the user likes, untimed. Items can sit under chapters (acts, areas, regions). If the game already has a list with this title (ignoring case), the items are appended to it and items it already has are skipped, so repeating a call adds nothing twice; asking for a second main story list is refused, naming the one the game has. Lists are always private (only the user can publish one, from the web app) and start with nothing ticked — tick_checklist_items ticks items once the user has done them. Build a list from what the user gave you or a source you can name, and tell the user where the items came from: a mission list recalled from memory is easy to get wrong.",
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
      description: `Record how two games relate, as on a game's Linked tab. \`role\` says what relatedGame is to game — ${LINK_ROLE_GUIDE}. A link is stored once and shows on both games (a prequel on one is the sequel on the other; DLC on one is the base game on the other), so link each pair once. Neither game has to be owned. Linking the same pair the same way again changes nothing; any other link between the same two games is refused, naming where the existing one is, and a game can't be linked to itself.`,
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
        "Record how long a game in the user's library took them: main story, main + extras, completionist, in hours. This is the user's own figure, and it also feeds the community average other players see — so only set it when the user states it, or a reliable source gives it; never guess. It's what the game shows when IGDB has no figure of its own. Stored the way the app stores them: sorted so main ≤ main + extras ≤ completionist, and when only two figures are known they're kept as main story and main + extras — so give all three when you know them. The result shows what was stored. Clearing all three removes the user's figure.",
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
