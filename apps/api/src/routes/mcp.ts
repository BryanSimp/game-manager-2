import type { FastifyInstance, FastifyReply } from "fastify";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { WebStandardStreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js";
import { z } from "zod";
import { env } from "../env.js";
import { toFetchRequest, sendFetchResponse } from "../plugins/fetch-bridge.js";
import { mcpRateLimit } from "../plugins/rate-limits.js";
import { MCP_SCOPE } from "@gm/shared";
import { authenticateMcp, type McpAuth } from "../services/mcp-auth.js";
import { PROTECTED_RESOURCE_METADATA_URL } from "../services/oauth.js";
import {
  BACKLOG_CANDIDATE_CATEGORIES,
  LIBRARY_SORTS,
  McpToolError,
  toolGetBacklogCandidates,
  toolGetCollection,
  toolGetDashboard,
  toolGetGame,
  toolListCategories,
  toolListCollections,
  toolListLibrary,
} from "../services/mcp-tools.js";

/**
 * A read-only MCP server over Streamable HTTP, at `POST /api/mcp`.
 *
 * This is how Claude (Claude Code, and claude.ai as a custom connector)
 * reads your library: "what should I play next?", "how far through Elden
 * Ring am I?". It lives under `/api` so the routing that already sends
 * `/api/*` to this server (Traefik's `PathPrefix(/api)`, the self-host
 * nginx, the Vite proxy) carries it without changes.
 *
 * **Stateless.** Every request builds a fresh `McpServer` whose tools are
 * closed over the caller's user id, answers, and is thrown away — there are
 * no MCP sessions to store, expire or mix up between users, and any API
 * process can answer any request. That's also why GET (the optional
 * server-to-client SSE stream) and DELETE (session teardown) are a 405.
 *
 * **Read-only.** Two independent reasons: no tool here writes anything, and
 * the credential that reaches this route works nowhere else — neither an API
 * key nor an OAuth access token is a session (see `auth.ts`), so neither can
 * be replayed against the routes that do write.
 *
 * **Two ways in**, told apart by prefix in `services/mcp-auth.ts`: a
 * personal API key (Claude Code) or an OAuth access token granted
 * `library:read` (claude.ai's custom connector, see `services/oauth.ts`).
 */

const INSTRUCTIONS = `Game Manager is the user's personal video game library. Everything these tools return belongs to the signed-in user and nobody else, and every tool only reads — nothing here can change the library.

Every game in the library is filed under one category: the built-ins are Uncategorized, Wishlist, Backlog, Playing, Finished, Shelved and Dropped, and the user may have custom ones too (list_categories). Games are owned on one or more platforms, each physical or digital; PC storefronts like Steam are "part of" PC, so filtering by PC includes them. Ratings are out of 5 in half stars. Times are in hours. "Time to beat" comes from IGDB, the user's own figure or a community average. A progress percentage exists only when the user keeps a mission list for the game.

For "what should I play next?", start with get_backlog_candidates. To look at one game in depth, call get_game with the id from any other tool's results.`;

/** A tool's result: compact JSON as text, or the error a model can act on. */
async function run(fn: () => Promise<unknown>) {
  try {
    const data = await fn();
    return { content: [{ type: "text" as const, text: JSON.stringify(data) }] };
  } catch (err) {
    if (err instanceof McpToolError) {
      return { isError: true, content: [{ type: "text" as const, text: err.message }] };
    }
    throw err;
  }
}

const READ_ONLY = { readOnlyHint: true, destructiveHint: false, openWorldHint: false } as const;

/** One MCP server, for one request, for one user. */
export function buildMcpServer(userId: string): McpServer {
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

      const server = buildMcpServer(caller.user.id);
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
