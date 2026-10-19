/**
 * The MCP endpoint, end to end: who may call it, that one user can never see
 * another's library through it, what each tool answers, which credentials
 * may use the write tools (and that those only ever touch the caller's own
 * games, tags, collections and checklists), and the OAuth flow claude.ai's connector
 * takes to get in (discovery, registration, login with two-factor, consent
 * with and without "Allow changes", tokens, disconnecting).
 *
 * Unlike the other check scripts this needs a database — migrated, with
 * DATABASE_URL and BETTER_AUTH_SECRET set as for `pnpm dev:api`:
 *
 *   pnpm --filter @gm/api check:mcp
 *
 * It drives the real app in-process (`buildServer()` + `inject`), so the
 * auth, rate limits and routing under test are the production ones. A few
 * throwaway accounts (`mcp-check-…@example.test`) get a small library each
 * and are deleted afterwards along with the catalog rows and OAuth clients
 * made for them, so it's safe to point at a dev database — but a scratch one
 * is better. It signs in over HTTP once, which counts against better-auth's
 * 5-a-minute sign-in limit like any other sign-in.
 */
import { createHash, randomBytes } from "node:crypto";
import { and, eq, ilike, inArray } from "drizzle-orm";
import { base32 } from "@better-auth/utils/base32";
import { createOTP } from "@better-auth/utils/otp";
import { MCP_SCOPE, MCP_WRITE_SCOPE } from "@gm/shared";
import { auth } from "../src/auth.js";
import { db, schema } from "../src/db/index.js";
import { env } from "../src/env.js";
import { buildServer } from "../src/server.js";
import { flushEvents } from "../src/services/analytics.js";
import {
  MCP_RESOURCE,
  OAUTH_ISSUER,
  PROTECTED_RESOURCE_METADATA_URL,
  hashOAuthToken,
} from "../src/services/oauth.js";

const app = await buildServer({ logger: false });
const run = randomBytes(4).toString("hex");
const PASSWORD = "mcp-check-password-123";

let passed = 0;
let failed = 0;
function check(name: string, ok: boolean, detail?: unknown) {
  if (ok) {
    passed += 1;
    console.log(`  ok   ${name}`);
  } else {
    failed += 1;
    console.error(`  FAIL ${name}${detail === undefined ? "" : `\n         ${JSON.stringify(detail)}`}`);
  }
}

// ---- fixtures -------------------------------------------------------------

const createdUsers: string[] = [];
const createdClients: string[] = [];
const createdGames: string[] = [];
const createdPlatforms: string[] = [];

/** Sign up through better-auth (server-side, so no sign-up rate limit) and keep the session cookie. */
async function makeUser(label: string) {
  const email = `mcp-check-${label}-${run}@example.test`;
  const res = await auth.api.signUpEmail({
    body: { email, password: PASSWORD, name: `MCP ${label}` },
    asResponse: true,
  });
  const setCookie = res.headers.get("set-cookie") ?? "";
  // the __Secure- prefix appears when BETTER_AUTH_URL is https
  const cookie = /(?:__Secure-)?better-auth\.session_token=[^;]+/.exec(setCookie)?.[0];
  if (!cookie) throw new Error(`no session cookie for ${email}`);
  const [row] = await db.select().from(schema.user).where(eq(schema.user.email, email));
  createdUsers.push(row!.id);
  return { id: row!.id, cookie };
}

async function makeGame(title: string, extra: Partial<typeof schema.games.$inferInsert> = {}) {
  const [game] = await db
    .insert(schema.games)
    .values({ title: `${title} ${run}`, ...extra })
    .returning();
  createdGames.push(game!.id);
  return game!;
}

async function makePlatform(name: string, parentPlatformId?: string) {
  const [p] = await db
    .insert(schema.platforms)
    .values({ name: `${name} ${run}`, abbreviation: name, parentPlatformId })
    .returning();
  createdPlatforms.push(p!.id);
  return p!;
}

async function file(
  userId: string,
  gameId: string,
  status: string,
  extra: Partial<typeof schema.userGames.$inferInsert> = {},
) {
  const [entry] = await db
    .insert(schema.userGames)
    .values({ userId, gameId, status, ...extra })
    .returning();
  return entry!;
}

// ---- helpers --------------------------------------------------------------

const MCP_HEADERS = {
  "content-type": "application/json",
  accept: "application/json, text/event-stream",
};

let rpcId = 0;
async function rpc(key: string | null, method: string, params: Record<string, unknown> = {}) {
  const res = await app.inject({
    method: "POST",
    url: "/api/mcp",
    headers: { ...MCP_HEADERS, ...(key ? { authorization: `Bearer ${key}` } : {}) },
    payload: { jsonrpc: "2.0", id: ++rpcId, method, params },
  });
  return res;
}

/** Call a tool and parse its JSON text result. */
async function tool(key: string, name: string, args: Record<string, unknown> = {}) {
  const res = await rpc(key, "tools/call", { name, arguments: args });
  const body = res.json() as {
    result?: { isError?: boolean; content: Array<{ type: string; text: string }> };
    error?: unknown;
  };
  if (!body.result) throw new Error(`${name}: ${res.statusCode} ${res.body}`);
  const text = body.result.content[0]?.text ?? "";
  return {
    isError: body.result.isError === true,
    text,
    data: body.result.isError ? null : (JSON.parse(text) as any),
  };
}

async function asUser(cookie: string, method: "GET" | "POST" | "PUT" | "DELETE", url: string, payload?: unknown) {
  return app.inject({
    method,
    url,
    headers: { cookie, ...(payload ? { "content-type": "application/json" } : {}) },
    ...(payload ? { payload: payload as Record<string, unknown> } : {}),
  });
}

// ---- OAuth helpers --------------------------------------------------------

const CLAUDE_CALLBACK = "https://claude.ai/api/mcp/auth_callback";
// better-auth checks Origin on cookie-carrying POSTs, as a browser would send it
const ORIGIN = env.CORS_ORIGINS[0] ?? env.BETTER_AUTH_URL;

/** Dynamic client registration, the way claude.ai does it: unauthenticated. */
async function registerClient(redirectUris: string[], scope?: string) {
  const res = await app.inject({
    method: "POST",
    url: "/api/auth/oauth2/register",
    headers: { "content-type": "application/json" },
    payload: {
      client_name: `Claude ${run}`,
      redirect_uris: redirectUris,
      grant_types: ["authorization_code", "refresh_token"],
      response_types: ["code"],
      token_endpoint_auth_method: "none",
      ...(scope ? { scope } : {}),
    },
  });
  const clientId = res.statusCode < 300 ? (res.json().client_id as string) : null;
  if (clientId) createdClients.push(clientId);
  return { res, clientId };
}

function pkce() {
  const verifier = randomBytes(32).toString("base64url");
  return { verifier, challenge: createHash("sha256").update(verifier).digest("base64url") };
}

function authorizePath(clientId: string, challenge: string, scope: string) {
  const q = new URLSearchParams({
    response_type: "code",
    client_id: clientId,
    redirect_uri: CLAUDE_CALLBACK,
    scope,
    state: "st4te",
    code_challenge: challenge,
    code_challenge_method: "S256",
    resource: MCP_RESOURCE,
  });
  return `/api/auth/oauth2/authorize?${q}`;
}

/** The signed query a redirect to /login or /oauth/consent carries. */
const signedQueryOf = (location: string) => location.slice(location.indexOf("?") + 1);

/** `scope` narrows what's granted — the consent page leaving "Allow changes" unticked. */
async function consent(cookie: string, location: string, accept: boolean, scope?: string) {
  const res = await app.inject({
    method: "POST",
    url: "/api/auth/oauth2/consent",
    headers: {
      cookie,
      origin: ORIGIN,
      accept: "application/json",
      "content-type": "application/json",
    },
    payload: { accept, oauth_query: signedQueryOf(location), ...(scope ? { scope } : {}) },
  });
  return res.json() as { redirect?: boolean; url?: string };
}

async function exchange(clientId: string, params: Record<string, string>) {
  const res = await app.inject({
    method: "POST",
    url: "/api/auth/oauth2/token",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    payload: new URLSearchParams({ client_id: clientId, ...params }).toString(),
  });
  return { status: res.statusCode, body: res.json() as Record<string, unknown> };
}

/**
 * A signed-in user connects the client: authorize → consent (when it hasn't
 * been given yet) → code → token. Returns the token response.
 */
async function connect(
  cookie: string,
  clientId: string,
  scope = `${MCP_SCOPE} offline_access`,
  consentScope?: string,
) {
  const { verifier, challenge } = pkce();
  const authorize = await app.inject({
    method: "GET",
    url: authorizePath(clientId, challenge, scope),
    headers: { cookie },
  });
  let location = String(authorize.headers.location ?? "");
  if (location.startsWith("/oauth/consent")) {
    location = (await consent(cookie, location, true, consentScope)).url ?? "";
  }
  const code = location ? new URL(location).searchParams.get("code") : null;
  if (!code) throw new Error(`no code: ${authorize.statusCode} ${location}`);
  return exchange(clientId, {
    grant_type: "authorization_code",
    code,
    redirect_uri: CLAUDE_CALLBACK,
    code_verifier: verifier,
    resource: MCP_RESOURCE,
  });
}

/** Turn two-factor on for a user, returning a function that makes a current code. */
async function enableTwoFactor(cookie: string) {
  const headers = new Headers({ cookie, origin: ORIGIN });
  const { totpURI } = await auth.api.enableTwoFactor({ body: { password: PASSWORD }, headers });
  const encoded = new URL(totpURI).searchParams.get("secret") ?? "";
  const secret = new TextDecoder().decode(base32.decode(encoded));
  const code = () => createOTP(secret, { digits: 6, period: 30 }).totp();
  await auth.api.verifyTOTP({ body: { code: await code() }, headers });
  return code;
}

// ---- the checks -----------------------------------------------------------

try {
  const alice = await makeUser("alice");
  const bob = await makeUser("bob");

  const pc = await makePlatform("PC");
  const steam = await makePlatform("Steam", pc.id);

  // alice: a game she's playing with a half-ticked mission list, its DLC,
  // two backlog games of different lengths, a wishlist game, a finished one,
  // and one in a custom category
  const hollow = await makeGame("Hollow Knight", {
    releaseDate: "2017-02-24",
    ttbMain: 27 * 3600,
    ttbMainExtra: 40 * 3600,
    ttbCompletionist: 60 * 3600,
    ttbSource: "igdb",
    summary: "A bug's quest.",
  });
  const hollowDlc = await makeGame("Hollow Knight - Godmaster", { ttbMain: 5 * 3600 });
  const shortOne = await makeGame("Short Backlog Game", { ttbMain: 4 * 3600 });
  const longOne = await makeGame("Long Backlog Game", { ttbMain: 80 * 3600 });
  const wish = await makeGame("Wishlist Game");
  const done = await makeGame("Finished Game", { ttbMain: 10 * 3600 });
  const odd = await makeGame("Custom Category Game");
  // in the shared catalog, not in alice's library — collections and links may
  // still name them (IGDB-backed, so a title finds them)
  const igdbBase = 900_000_000 + Math.floor(Math.random() * 90_000_000);
  const notOwned = await makeGame("Not Owned Game", { igdbId: igdbBase + 1, releaseDate: "2020-05-01" });
  const catalogOnly = await makeGame("Catalog Only: Game", { igdbId: igdbBase + 2 });
  const byIgdb = await makeGame("Found By Igdb Ref", { igdbId: igdbBase + 3 });

  const [custom] = await db
    .insert(schema.customCategories)
    .values({ userId: alice.id, name: `Replay someday ${run}` })
    .returning();

  const aHollow = await file(alice.id, hollow.id, "playing", {
    rating: "4.5",
    notes: "Stuck on the Mantis Lords.",
    steamPlaytimeMinutes: 750,
    startedAt: new Date("2026-09-01T12:00:00Z"),
  });
  await file(alice.id, hollowDlc.id, "backlog");
  await file(alice.id, shortOne.id, "backlog");
  await file(alice.id, longOne.id, "backlog");
  await file(alice.id, wish.id, "wishlist");
  await file(alice.id, done.id, "finished", {
    rating: "3.0",
    finishedAt: new Date("2026-10-01T12:00:00Z"),
  });
  await file(alice.id, odd.id, custom!.id);

  await db.insert(schema.userGamePlatforms).values([
    { userGameId: aHollow.id, platformId: steam.id, format: "digital" },
  ]);
  const [tag] = await db
    .insert(schema.tags)
    .values({ userId: alice.id, name: `metroidvania-${run}` })
    .returning();
  await db.insert(schema.userGameTags).values({ userGameId: aHollow.id, tagId: tag!.id });

  // a 4-mission list, two ticked → 50%, half of 27h left
  const [list] = await db
    .insert(schema.checklistTemplates)
    .values({ gameId: hollow.id, authorUserId: alice.id, title: "Main quest", kind: "missions" })
    .returning();
  const items = await db
    .insert(schema.checklistItems)
    .values([1, 2, 3, 4].map((n) => ({ templateId: list!.id, position: n, text: `Boss ${n}` })))
    .returning();
  await db.insert(schema.userChecklistItems).values(
    items.slice(0, 2).map((i) => ({ userId: alice.id, itemId: i.id })),
  );
  await db.insert(schema.userGameLinks).values({
    userId: alice.id,
    gameId: hollow.id,
    relatedGameId: hollowDlc.id,
    kind: "dlc",
  });

  // bob: a game of his own, and his own collection — none of it may ever
  // reach alice
  const bobsGame = await makeGame("Bob's Secret Game", { ttbMain: 3 * 3600 });
  const bSecret = await file(bob.id, bobsGame.id, "backlog", { notes: "bob's private notes" });

  // collections through the real routes, so they get their graphs
  const created = await asUser(alice.cookie, "POST", "/api/collections", {
    name: `Hollow run ${run}`,
  });
  const aliceCollection = (created.json() as { id: string }).id;
  for (const g of [hollow, hollowDlc]) {
    await asUser(alice.cookie, "POST", `/api/collections/${aliceCollection}/games`, { gameId: g.id });
  }
  const bobCreated = await asUser(bob.cookie, "POST", "/api/collections", { name: `Bob's list ${run}` });
  const bobCollection = (bobCreated.json() as { id: string }).id;

  console.log("\nAPI keys");
  const keyRes = await asUser(alice.cookie, "POST", "/api/api-keys", { name: "Claude Code" });
  check("creating a key returns it once, with the gm_ prefix", keyRes.statusCode === 201 && /^gm_/.test(keyRes.json().key), keyRes.body);
  const aliceKey = keyRes.json().key as string;
  const aliceKeyId = keyRes.json().id as string;
  const bobKey = (await auth.api.createApiKey({ body: { name: "bob", userId: bob.id } })).key;

  const listed = await asUser(alice.cookie, "GET", "/api/api-keys");
  const listedKeys = listed.json() as Array<Record<string, unknown>>;
  check(
    "listing shows the key's name and start, never the key",
    listedKeys.length === 1 && listedKeys[0]!.name === "Claude Code" && !("key" in listedKeys[0]!) && aliceKey.startsWith(String(listedKeys[0]!.start)),
    listedKeys,
  );
  const nameless = await asUser(alice.cookie, "POST", "/api/api-keys", { name: "   " });
  check("a key needs a name", nameless.statusCode === 400, nameless.body);
  const direct = await asUser(alice.cookie, "POST", "/api/auth/api-key/create", { name: "x", prefix: "evil_" });
  check("better-auth's own api-key endpoints are not reachable over HTTP", direct.statusCode === 404, direct.statusCode);
  const notYours = await asUser(bob.cookie, "DELETE", `/api/api-keys/${aliceKeyId}`);
  check("someone else can't revoke your key", notYours.statusCode === 404, notYours.statusCode);

  console.log("\nAuthentication");
  check("no credentials → 401", (await rpc(null, "tools/list")).statusCode === 401);
  check("a made-up key → 401", (await rpc(`gm_${"x".repeat(64)}`, "tools/list")).statusCode === 401);
  check("garbage bearer → 401", (await rpc("not-a-key", "tools/list")).statusCode === 401);
  const cookieOnly = await app.inject({
    method: "POST",
    url: "/api/mcp",
    headers: { ...MCP_HEADERS, cookie: alice.cookie },
    payload: { jsonrpc: "2.0", id: 1, method: "tools/list" },
  });
  check("a browser session cookie is not accepted", cookieOnly.statusCode === 401, cookieOnly.statusCode);
  const keyAsSession = await app.inject({
    method: "GET",
    url: "/api/library",
    headers: { authorization: `Bearer ${aliceKey}` },
  });
  check("an API key is not a session anywhere else (GET /api/library → 401)", keyAsSession.statusCode === 401, keyAsSession.statusCode);
  const keyWrite = await app.inject({
    method: "PATCH",
    url: `/api/library/${aHollow.id}`,
    headers: { authorization: `Bearer ${aliceKey}`, "content-type": "application/json" },
    payload: { notes: "overwritten" },
  });
  check("…so it can't write either (PATCH /api/library/:id → 401)", keyWrite.statusCode === 401, keyWrite.statusCode);
  const get = await app.inject({ method: "GET", url: "/api/mcp", headers: { authorization: `Bearer ${aliceKey}` } });
  check("GET with a valid key → 405 (stateless, POST only)", get.statusCode === 405, get.statusCode);

  console.log("\nTools");
  const listRes = await rpc(aliceKey, "tools/list");
  const tools = (listRes.json() as { result: { tools: Array<{ name: string; annotations?: { readOnlyHint?: boolean } }> } }).result.tools;
  const names = tools.map((t) => t.name).sort();
  const READ_TOOLS = ["get_achievements", "get_backlog_candidates", "get_checklist", "get_collection", "get_dashboard", "get_game", "list_categories", "list_collections", "list_library"];
  const WRITE_TOOLS = ["add_games_to_collection", "create_checklist", "create_collection", "create_tag", "link_games", "set_time_to_beat", "tag_games", "tick_checklist_items", "untag_games"];
  check(
    "tools/list offers the nine read tools and the nine write tools, even to a read-only key",
    JSON.stringify(names) === JSON.stringify([...READ_TOOLS, ...WRITE_TOOLS].sort()),
    names,
  );
  const annotated = tools as Array<{ name: string; annotations?: { readOnlyHint?: boolean; destructiveHint?: boolean } }>;
  check(
    "read tools are annotated read-only",
    annotated.filter((t) => READ_TOOLS.includes(t.name)).every((t) => t.annotations?.readOnlyHint === true),
  );
  check(
    "write tools are annotated readOnlyHint: false, destructiveHint: false",
    annotated
      .filter((t) => WRITE_TOOLS.includes(t.name))
      .every((t) => t.annotations?.readOnlyHint === false && t.annotations?.destructiveHint === false),
  );
  const checklistItems = (tools as Array<{ name: string; inputSchema?: any }>).find((t) => t.name === "create_checklist")
    ?.inputSchema?.properties?.items?.items;
  const itemShapes = (checklistItems?.anyOf ?? []) as Array<{ type?: string; properties?: Record<string, unknown> }>;
  check(
    "create_checklist's items are each a string or { text, chapter }",
    itemShapes.some((s) => s.type === "string") &&
      itemShapes.some((s) => s.type === "object" && !!s.properties?.text && !!s.properties?.chapter),
    checklistItems,
  );

  const lib = await tool(aliceKey, "list_library");
  const titles: string[] = lib.data.games.map((g: { title: string }) => g.title);
  check("list_library returns alice's seven games", lib.data.total === 7, lib.data.total);
  check("list_library never includes bob's game", !titles.some((t) => t.includes("Bob's Secret")), titles);
  const hk = lib.data.games.find((g: { id: string }) => g.id === aHollow.id);
  check(
    "a library row carries category name, rating, platforms, dates, Steam hours, time to beat and progress",
    hk?.category === "Playing" &&
      hk.rating === 4.5 &&
      hk.platforms[0]?.platform === steam.name &&
      hk.platforms[0]?.partOf === pc.name &&
      hk.platforms[0]?.format === "digital" &&
      hk.startedAt === "2026-09-01" &&
      hk.steamHours === 12.5 &&
      hk.timeToBeatHours?.main === 27 &&
      hk.progress?.percent === 50 &&
      hk.progress?.remainingHours === 13.5,
    hk,
  );
  const odds = lib.data.games.find((g: { title: string }) => g.title.startsWith("Custom Category Game"));
  check("custom categories come back by name, not id", odds?.category === `Replay someday ${run}`, odds?.category);

  const playing = await tool(aliceKey, "list_library", { category: "playing" });
  check("list_library filters by category (key or name)", playing.data.total === 1 && playing.data.games[0].id === aHollow.id, playing.data.total);
  const onPc = await tool(aliceKey, "list_library", { platform: pc.name });
  check("filtering by PC includes games filed under Steam", onPc.data.total === 1, onPc.data.total);
  const tagged = await tool(aliceKey, "list_library", { tag: `METROIDVANIA-${run}` });
  check("list_library filters by tag", tagged.data.total === 1, tagged.data.total);
  const searched = await tool(aliceKey, "list_library", { search: "backlog game" });
  check("list_library searches titles", searched.data.total === 2, searched.data.total);
  const shortest = await tool(aliceKey, "list_library", { category: "Backlog", sort: "shortest", limit: 1 });
  check("list_library sorts and limits", shortest.data.total === 3 && shortest.data.returned === 1 && shortest.data.games[0].title.startsWith("Short"), shortest.data);
  const badCat = await tool(aliceKey, "list_library", { category: "Nonsense" });
  check("an unknown category is an error naming the real ones", badCat.isError && badCat.text.includes("Backlog"), badCat.text);

  const game = await tool(aliceKey, "get_game", { id: aHollow.id });
  const progressRoute = (await asUser(alice.cookie, "GET", `/api/library/${aHollow.id}/progress`)).json() as {
    done: number;
    total: number;
    percent: number;
    remainingSeconds: number;
  };
  check(
    "get_game's progress matches GET /api/library/:id/progress",
    game.data.progress.missionsDone === progressRoute.done &&
      game.data.progress.missionsTotal === progressRoute.total &&
      game.data.progress.percent === progressRoute.percent &&
      game.data.progress.remainingHours === Math.round(progressRoute.remainingSeconds / 360) / 10,
    { tool: game.data.progress, route: progressRoute },
  );
  check("get_game includes notes and summary", game.data.notes === "Stuck on the Mantis Lords." && game.data.summary === "A bug's quest.", game.data);
  check(
    "get_game lists checklists and linked DLC",
    game.data.checklists[0]?.done === 2 &&
      game.data.checklists[0]?.total === 4 &&
      game.data.linkedGames.DLC?.[0]?.title === hollowDlc.title &&
      game.data.linkedGames.DLC[0].category === "Backlog",
    { checklists: game.data.checklists, linked: game.data.linkedGames },
  );
  const byTitle = await tool(aliceKey, "get_game", { title: `hollow knight ${run}` });
  check("get_game finds a game by exact title", byTitle.data?.id === aHollow.id, byTitle.text);
  const ambiguous = await tool(aliceKey, "get_game", { title: "backlog game" });
  check("an ambiguous title returns the candidates' ids", ambiguous.isError && ambiguous.text.includes("matches 2"), ambiguous.text);
  const stolen = await tool(aliceKey, "get_game", { id: bSecret.id });
  check("get_game on another user's entry id finds nothing", stolen.isError && !stolen.text.includes("bob's private notes"), stolen.text);
  const stolenByTitle = await tool(aliceKey, "get_game", { title: "Bob's Secret Game" });
  check("…nor by its title", stolenByTitle.isError, stolenByTitle.text);

  const dash = await tool(aliceKey, "get_dashboard");
  const dashRoute = (await asUser(alice.cookie, "GET", "/api/dashboard")).json() as {
    total: number;
    backlogSeconds: number;
  };
  check(
    "get_dashboard matches GET /api/dashboard",
    dash.data.totalGames === dashRoute.total &&
      dash.data.backlogHours === Math.round(dashRoute.backlogSeconds / 360) / 10 &&
      dash.data.byCategory.find((c: { category: string }) => c.category === "Backlog")?.games === 3 &&
      dash.data.recentlyFinished[0]?.title === done.title,
    { tool: dash.data, route: dashRoute },
  );

  const cols = await tool(aliceKey, "list_collections");
  check(
    "list_collections returns only alice's collection",
    cols.data.collections.length === 1 && cols.data.collections[0].id === aliceCollection && cols.data.collections[0].games === 2,
    cols.data,
  );
  const col = await tool(aliceKey, "get_collection", { name: `hollow run ${run}` });
  check(
    "get_collection lists games in order with the asker's category",
    col.data?.games.length === 2 &&
      col.data.games[0].order === 1 &&
      col.data.games[0].title === hollow.title &&
      col.data.games[0].category === "Playing" &&
      col.data.graphs[0]?.name === "Play order",
    col.data ?? col.text,
  );
  const bobsCol = await tool(aliceKey, "get_collection", { id: bobCollection });
  check("get_collection refuses another user's collection", bobsCol.isError, bobsCol.text);

  const cats = await tool(aliceKey, "list_categories");
  check(
    "list_categories has the built-ins and custom ones, with counts",
    cats.data.categories.length === 8 &&
      cats.data.categories.find((c: { name: string }) => c.name === "Backlog")?.games === 3 &&
      cats.data.categories.some((c: { name: string; builtIn: boolean }) => c.name === `Replay someday ${run}` && !c.builtIn),
    cats.data,
  );

  const next = await tool(aliceKey, "get_backlog_candidates");
  const nextTitles: string[] = next.data.candidates.map((c: { title: string }) => c.title);
  check(
    "get_backlog_candidates picks backlog + shelved + wishlist only",
    next.data.total === 4 && !nextTitles.some((t) => [hollow.title, done.title, odd.title].includes(t)),
    nextTitles,
  );
  check(
    "…shortest remaining first, unknown lengths last",
    nextTitles[0]!.startsWith("Short") && nextTitles[1]!.startsWith("Hollow Knight - Godmaster") && nextTitles[3]!.startsWith("Wishlist"),
    nextTitles,
  );
  check("…and never bob's backlog", !nextTitles.some((t) => t.includes("Bob's Secret")), nextTitles);
  const quick = await tool(aliceKey, "get_backlog_candidates", { categories: ["backlog"], maxHours: 10 });
  check("get_backlog_candidates filters by category and hours", quick.data.total === 2, quick.data);

  const bobView = await tool(bobKey, "list_library");
  check("bob's key sees bob's library and only that", bobView.data.total === 1 && bobView.data.games[0].id === bSecret.id, bobView.data);

  console.log("\nWrites: who may");
  const writeKeyRes = await asUser(alice.cookie, "POST", "/api/api-keys", { name: "Claude Code (changes)", allowChanges: true });
  check("a key made with allowChanges says so", writeKeyRes.statusCode === 201 && writeKeyRes.json().allowChanges === true, writeKeyRes.body);
  const aliceWriteKey = writeKeyRes.json().key as string;
  const keyList = (await asUser(alice.cookie, "GET", "/api/api-keys")).json() as Array<{ name: string; allowChanges: boolean }>;
  check(
    "…and the list tells it apart from the read-only key made without it",
    keyList.find((k) => k.name === "Claude Code")?.allowChanges === false &&
      keyList.find((k) => k.name === "Claude Code (changes)")?.allowChanges === true,
    keyList,
  );
  const smuggled = await asUser(alice.cookie, "POST", "/api/api-keys", {
    name: "smuggled",
    permissions: { library: ["read", "write"] },
  });
  check("a key can't be given permissions directly — only allowChanges grants writes", smuggled.statusCode === 201 && smuggled.json().allowChanges === false, smuggled.body);
  await asUser(alice.cookie, "DELETE", `/api/api-keys/${smuggled.json().id}`);

  const refusedArgs: Record<string, Record<string, unknown>> = {
    create_tag: { name: `refused-${run}` },
    tag_games: { tag: `refused-${run}`, games: [aHollow.id] },
    untag_games: { tag: tag!.name, games: [aHollow.id] },
    create_collection: { name: `refused-${run}` },
    add_games_to_collection: { collectionId: aliceCollection, games: [shortOne.title] },
    link_games: { game: aHollow.id, relatedGame: shortOne.title, role: "sequel" },
    set_time_to_beat: { game: aHollow.id, mainHours: 1 },
    create_checklist: { game: aHollow.id, title: `refused-${run}`, items: ["Refused item"] },
    tick_checklist_items: { game: aHollow.id, list: "Main quest", numbers: [3, 4] },
  };
  const refusals = await Promise.all(
    Object.entries(refusedArgs).map(async ([name, args]) => ({ name, ...(await tool(aliceKey, name, args)) })),
  );
  check(
    "every write tool refuses a read-only key, saying how to get one that can write",
    refusals.every((r) => r.isError && r.text.includes("This key is read-only") && r.text.includes("Allow changes")),
    refusals.filter((r) => !r.isError || !r.text.includes("read-only")).map((r) => [r.name, r.text]),
  );
  const legacy = await tool(bobKey, "create_tag", { name: `bob-legacy-${run}` });
  check("a key made before writes existed (no permissions at all) is read-only", legacy.isError && legacy.text.includes("read-only"), legacy.text);
  const [hollowTagsBefore] = [
    await db.select().from(schema.userGameTags).where(eq(schema.userGameTags.userGameId, aHollow.id)),
  ];
  const refusedRows = [
    ...(await db.select().from(schema.tags).where(ilike(schema.tags.name, `refused-${run}`))),
    ...(await db.select().from(schema.tags).where(ilike(schema.tags.name, `bob-legacy-${run}`))),
  ];
  const [aliceCollectionGames] = [
    await db.select().from(schema.collectionGames).where(eq(schema.collectionGames.collectionId, aliceCollection)),
  ];
  const refusedLists = await db
    .select()
    .from(schema.checklistTemplates)
    .where(eq(schema.checklistTemplates.title, `refused-${run}`));
  const hollowTicks = await db
    .select()
    .from(schema.userChecklistItems)
    .where(and(eq(schema.userChecklistItems.userId, alice.id), inArray(schema.userChecklistItems.itemId, items.map((i) => i.id))));
  check(
    "…and none of the refused calls wrote anything",
    refusedRows.length === 0 &&
      hollowTagsBefore.length === 1 &&
      aliceCollectionGames.length === 2 &&
      refusedLists.length === 0 &&
      hollowTicks.length === 2,
    { tags: refusedRows.map((t) => t.name), hollowTags: hollowTagsBefore.length, inCollection: aliceCollectionGames.length, lists: refusedLists.length, ticks: hollowTicks.length },
  );

  console.log("\nWrites: tags");
  const coop = `Co-op ${run}`;
  const made = await tool(aliceWriteKey, "create_tag", { name: coop, group: "Mode", color: "#22c55e" });
  check("create_tag makes a tag with its group and colour", made.data?.created === true && made.data.tag.group === "Mode" && made.data.tag.color === "#22c55e", made.text);
  const madeAgain = await tool(aliceWriteKey, "create_tag", { name: coop.toUpperCase(), group: "Something else" });
  const coopRows = await db.select().from(schema.tags).where(and(eq(schema.tags.userId, alice.id), ilike(schema.tags.name, coop)));
  check(
    "…the same name again, in any case, returns that tag unchanged instead of a second one",
    madeAgain.data?.created === false && madeAgain.data.tag.name === coop && madeAgain.data.tag.group === "Mode" && !!madeAgain.data.note && coopRows.length === 1,
    madeAgain.text,
  );

  const tagResult = await tool(aliceWriteKey, "tag_games", {
    tag: coop,
    games: [aHollow.id, shortOne.title, `No Such Game zzq ${run}`, bSecret.id],
  });
  check(
    "tag_games tags the games it finds and lists the ones it can't",
    tagResult.data?.tagged === 2 && tagResult.data.alreadyHad === 0 && tagResult.data.notFound.length === 2,
    tagResult.data ?? tagResult.text,
  );
  const hollowTagIds = (await db.select().from(schema.userGameTags).where(eq(schema.userGameTags.userGameId, aHollow.id))).map((r) => r.tagId);
  check(
    "tag_games adds the tag and keeps the game's other tags",
    hollowTagIds.length === 2 && hollowTagIds.includes(tag!.id) && hollowTagIds.includes(coopRows[0]!.id),
    hollowTagIds,
  );
  const hkTags = (await tool(aliceWriteKey, "get_game", { id: aHollow.id })).data.tags as string[];
  check("…as the read tools see it too", hkTags.includes(tag!.name) && hkTags.includes(coop), hkTags);
  const taggedAgain = await tool(aliceWriteKey, "tag_games", { tag: coop.toLowerCase(), games: [aHollow.id] });
  check("tagging a game that has the tag counts it as already tagged", taggedAgain.data?.tagged === 0 && taggedAgain.data.alreadyHad === 1, taggedAgain.data);
  const franchise = await tool(aliceWriteKey, "tag_games", { tag: `Hallownest ${run}`, group: "Franchise", games: [hollow.title, hollowDlc.title] });
  check(
    "tag_games makes a missing tag first, in the group given",
    franchise.data?.tagCreated === true && franchise.data.tag.group === "Franchise" && franchise.data.tagged === 2,
    franchise.data ?? franchise.text,
  );
  const nearMiss = await tool(aliceWriteKey, "tag_games", { tag: coop, games: ["backlog game"] });
  check(
    "a title that isn't exact isn't guessed at — it comes back with ids to choose from",
    nearMiss.data?.tagged === 0 && nearMiss.data.notFound[0]?.reason.includes("Did you mean"),
    nearMiss.data,
  );
  const punctuation = await tool(aliceWriteKey, "tag_games", { tag: coop, games: [`HOLLOW KNIGHT - GODMASTER ${run}`.replace(" - ", " ")] });
  check("…while case and punctuation don't stop an exact title matching", punctuation.data?.tagged === 1, punctuation.data);

  const untagged = await tool(aliceWriteKey, "untag_games", { tag: coop, games: [shortOne.title, longOne.title] });
  check(
    "untag_games takes the tag off, and counts games that didn't have it",
    untagged.data?.removed === 1 && untagged.data.didNotHaveIt === 1,
    untagged.data ?? untagged.text,
  );
  const coopStill = await db.select().from(schema.tags).where(eq(schema.tags.id, coopRows[0]!.id));
  const hollowStill = await db.select().from(schema.userGameTags).where(and(eq(schema.userGameTags.userGameId, aHollow.id), eq(schema.userGameTags.tagId, coopRows[0]!.id)));
  check("…removing the assignment only: the tag and its other games stay", coopStill.length === 1 && hollowStill.length === 1);
  const noSuchTag = await tool(aliceWriteKey, "untag_games", { tag: `never-made-${run}`, games: [aHollow.id] });
  check("untagging with a tag the user doesn't have is an error naming their tags", noSuchTag.isError && noSuchTag.text.includes(coop), noSuchTag.text);

  // bob's tag on bob's game: alice can't reach either
  const [bobTag] = await db.insert(schema.tags).values({ userId: bob.id, name: `bob-only-${run}` }).returning();
  await db.insert(schema.userGameTags).values({ userGameId: bSecret.id, tagId: bobTag!.id });
  const crossUntag = await tool(aliceWriteKey, "untag_games", { tag: bobTag!.name, games: [bSecret.id] });
  const crossTag = await tool(aliceWriteKey, "tag_games", { tag: coop, games: [bSecret.id, bobsGame.title] });
  const bobTagsAfter = await db.select().from(schema.userGameTags).where(eq(schema.userGameTags.userGameId, bSecret.id));
  check(
    "alice can't untag bob's games with bob's tag, nor tag bob's games",
    crossUntag.isError && crossTag.data?.tagged === 0 && crossTag.data.notFound.length === 2 && bobTagsAfter.length === 1 && bobTagsAfter[0]!.tagId === bobTag!.id,
    { crossUntag: crossUntag.text, crossTag: crossTag.data, bobTagsAfter },
  );

  console.log("\nWrites: collections");
  const publishAlways = await asUser(alice.cookie, "PUT", "/api/preferences", { publishMode: "always" });
  const webMade = await asUser(alice.cookie, "POST", "/api/collections", { name: `Made on the web ${run}` });
  check(
    "(the web app's own create still follows publish mode 'always')",
    publishAlways.statusCode === 200 && webMade.statusCode === 201 && webMade.json().isPublic === true,
    { prefs: publishAlways.statusCode, body: webMade.body },
  );
  const metroid = `Metroidvanias ${run}`;
  const createdCol = await tool(aliceWriteKey, "create_collection", {
    name: metroid,
    description: "Bugs and castles",
    games: [aHollow.id, wish.title, notOwned.id, catalogOnly.title.replace(":", ""), `igdb:${byIgdb.igdbId}`, `Nope zzq ${run}`],
  });
  const colId = createdCol.data?.collection?.id as string;
  const [colRow] = colId ? await db.select().from(schema.collections).where(eq(schema.collections.id, colId)) : [];
  check(
    "create_collection is private even though the publish preference is 'always'",
    createdCol.data?.created === true && createdCol.data.collection.public === false && colRow?.isPublic === false,
    createdCol.data ?? createdCol.text,
  );
  check(
    "…and starts with the games it could find, owned or not, reporting the rest",
    createdCol.data?.added === 5 && createdCol.data.notFound.length === 1,
    createdCol.data,
  );
  const colView = await tool(aliceWriteKey, "get_collection", { id: colId });
  check(
    "…in the order given, on the collection's graph",
    JSON.stringify(colView.data?.games.map((g: { title: string }) => g.title)) ===
      JSON.stringify([hollow.title, wish.title, notOwned.title, catalogOnly.title, byIgdb.title]) &&
      colView.data.games[2].inLibrary === false &&
      colView.data.graphs[0]?.name === "Play order",
    colView.data ?? colView.text,
  );
  const graphNodes = await db
    .select()
    .from(schema.collectionGraphNodes)
    .innerJoin(schema.collectionGraphs, eq(schema.collectionGraphs.id, schema.collectionGraphNodes.graphId))
    .where(eq(schema.collectionGraphs.collectionId, colId));
  check("every game it added has a node on the graph", graphNodes.length === 5, graphNodes.length);
  const sameName = await tool(aliceWriteKey, "create_collection", { name: metroid.toLowerCase(), games: [shortOne.title, aHollow.id] });
  const metroidRows = await db.select().from(schema.collections).where(and(eq(schema.collections.userId, alice.id), ilike(schema.collections.name, metroid)));
  check(
    "the same name again returns that collection, appending only the new games",
    sameName.data?.created === false && sameName.data.collection.id === colId && sameName.data.added === 1 && sameName.data.alreadyIn === 1 && metroidRows.length === 1,
    sameName.data ?? sameName.text,
  );
  const appended = await tool(aliceWriteKey, "add_games_to_collection", { collectionName: metroid, games: [longOne.title, hollow.title] });
  check(
    "add_games_to_collection appends by collection name",
    appended.data?.added === 1 && appended.data.alreadyIn === 1 && appended.data.gamesInCollection === 7,
    appended.data ?? appended.text,
  );
  const intoBobs = await tool(aliceWriteKey, "add_games_to_collection", { collectionId: bobCollection, games: [aHollow.id] });
  const bobsByName = await tool(aliceWriteKey, "add_games_to_collection", { collectionName: `Bob's list ${run}`, games: [aHollow.id] });
  const bobsGames = await db.select().from(schema.collectionGames).where(eq(schema.collectionGames.collectionId, bobCollection));
  check("alice can't add to bob's collection, by id or by name", intoBobs.isError && bobsByName.isError && bobsGames.length === 0, { intoBobs: intoBobs.text, bobsByName: bobsByName.text });
  const filtered = await tool(aliceWriteKey, "create_collection", { name: `mail me at someone-${run}@example.com` });
  check("the content filter applies to collections made over MCP", filtered.isError, filtered.text);

  console.log("\nWrites: links");
  const sequel = await tool(aliceWriteKey, "link_games", { game: aHollow.id, relatedGame: notOwned.title, role: "sequel" });
  const [sequelRow] = await db
    .select()
    .from(schema.userGameLinks)
    .where(and(eq(schema.userGameLinks.userId, alice.id), eq(schema.userGameLinks.relatedGameId, notOwned.id)));
  check(
    "link_games links a game to one alice doesn't own, and says what it recorded",
    sequel.data?.created === true && sequel.data.link === `"${notOwned.title}" follows "${hollow.title}"` && sequelRow?.gameId === hollow.id && sequelRow.kind === "sequel",
    sequel.data ?? sequel.text,
  );
  const sequelAgain = await tool(aliceWriteKey, "link_games", { game: hollow.title, relatedGame: notOwned.id, role: "sequel" });
  check("…the same link again changes nothing", sequelAgain.data?.created === false, sequelAgain.data ?? sequelAgain.text);
  const inverse = await tool(aliceWriteKey, "link_games", { game: notOwned.id, relatedGame: aHollow.id, role: "sequel" });
  check("…a different link between the same pair is refused, naming where it is", inverse.isError && inverse.text.includes("Prequels"), inverse.text);
  const selfLink = await tool(aliceWriteKey, "link_games", { game: aHollow.id, relatedGame: hollow.title, role: "dlc" });
  check("…and a game can't be linked to itself", selfLink.isError && selfLink.text.includes("itself"), selfLink.text);
  const baseGame = await tool(aliceWriteKey, "link_games", { game: shortOne.title, relatedGame: longOne.title, role: "base_game" });
  const [baseRow] = await db
    .select()
    .from(schema.userGameLinks)
    .where(and(eq(schema.userGameLinks.userId, alice.id), eq(schema.userGameLinks.relatedGameId, shortOne.id)));
  check(
    "base_game is stored from the other end: the related game is the base",
    baseGame.data?.created === true && baseRow?.gameId === longOne.id && baseRow.kind === "dlc",
    baseGame.data ?? baseGame.text,
  );
  const crossLink = await tool(aliceWriteKey, "link_games", { game: bSecret.id, relatedGame: aHollow.id, role: "dlc" });
  const bobLinks = await db.select().from(schema.userGameLinks).where(eq(schema.userGameLinks.userId, bob.id));
  check("bob's library id means nothing to alice's link_games, and bob's links stay empty", crossLink.isError && bobLinks.length === 0, crossLink.text);

  console.log("\nWrites: time to beat");
  const ttbOf = async (gameId: string) =>
    (await db.select().from(schema.userTimeToBeat).where(and(eq(schema.userTimeToBeat.userId, alice.id), eq(schema.userTimeToBeat.gameId, gameId))))[0];
  const setTtb = await tool(aliceWriteKey, "set_time_to_beat", {
    game: wish.title,
    mainHours: 12.5,
    mainExtraHours: 20,
    completionistHours: 30,
  });
  check(
    "set_time_to_beat records the user's own figures, in hours",
    setTtb.data?.yourTimeToBeatHours?.main === 12.5 &&
      setTtb.data.yourTimeToBeatHours.mainExtra === 20 &&
      setTtb.data.yourTimeToBeatHours.completionist === 30 &&
      (await ttbOf(wish.id))?.mainSeconds === 45000,
    setTtb.data ?? setTtb.text,
  );
  const keepOthers = await tool(aliceWriteKey, "set_time_to_beat", { game: wish.title, completionistHours: 35 });
  check(
    "…an omitted field is kept",
    keepOthers.data?.yourTimeToBeatHours?.main === 12.5 && keepOthers.data.yourTimeToBeatHours.mainExtra === 20 && keepOthers.data.yourTimeToBeatHours.completionist === 35,
    keepOthers.data,
  );
  const clearOne = await tool(aliceWriteKey, "set_time_to_beat", { game: wish.title, completionistHours: null });
  check(
    "…null clears one",
    clearOne.data?.yourTimeToBeatHours?.completionist === null && clearOne.data.yourTimeToBeatHours.main === 12.5 && (await ttbOf(wish.id))?.completionistSeconds === null,
    clearOne.data,
  );
  const clearAll = await tool(aliceWriteKey, "set_time_to_beat", { game: wish.title, mainHours: null, mainExtraHours: null });
  check("…and clearing every figure removes the submission", clearAll.data?.cleared === true && (await ttbOf(wish.id)) === undefined, clearAll.data);
  // the route and the tool on the same out-of-order pair: same stored figures
  const [aLong] = await db
    .select({ id: schema.userGames.id })
    .from(schema.userGames)
    .where(and(eq(schema.userGames.userId, alice.id), eq(schema.userGames.gameId, longOne.id)));
  const viaRoute = await app.inject({
    method: "PUT",
    url: `/api/library/${aLong!.id}/time-to-beat`,
    headers: { cookie: alice.cookie, "content-type": "application/json" },
    payload: { ttbMain: 50 * 3600, ttbCompletionist: 10 * 3600 },
  });
  const inverted = await tool(aliceWriteKey, "set_time_to_beat", { game: shortOne.title, mainHours: 50, completionistHours: 10 });
  const routeTimes = viaRoute.json() as { ttbMain: number; ttbMainExtra: number | null; ttbCompletionist: number | null };
  check(
    "…normalised exactly as PUT /api/library/:id/time-to-beat normalises",
    viaRoute.statusCode === 200 &&
      inverted.data?.yourTimeToBeatHours?.main === routeTimes.ttbMain / 3600 &&
      inverted.data.yourTimeToBeatHours.mainExtra === (routeTimes.ttbMainExtra ?? 0) / 3600 &&
      inverted.data.yourTimeToBeatHours.completionist === routeTimes.ttbCompletionist &&
      inverted.data.yourTimeToBeatHours.main === 10,
    { route: routeTimes, tool: inverted.data },
  );
  const nothingGiven = await tool(aliceWriteKey, "set_time_to_beat", { game: wish.title });
  check("…and a call that names no figure is an error, not a silent clear", nothingGiven.isError, nothingGiven.text);
  const bobsTtb = await tool(aliceWriteKey, "set_time_to_beat", { game: bSecret.id, mainHours: 99 });
  const bobTtbRows = await db.select().from(schema.userTimeToBeat).where(eq(schema.userTimeToBeat.gameId, bobsGame.id));
  check("alice can't set a time on bob's game", bobsTtb.isError && bobTtbRows.length === 0, bobsTtb.text);
  const notOwnedTtb = await tool(aliceWriteKey, "set_time_to_beat", { game: notOwned.title, mainHours: 5 });
  check("…nor on a game she doesn't own", notOwnedTtb.isError, notOwnedTtb.text);

  // hollow has IGDB's 27h: alice's own figure replaces it for her, and only her
  const override = await tool(aliceWriteKey, "set_time_to_beat", {
    game: aHollow.id,
    mainHours: 30,
    mainExtraHours: 45,
    completionistHours: 70,
  });
  const overriddenGame = await tool(aliceKey, "get_game", { id: aHollow.id });
  const overriddenCol = await tool(aliceKey, "get_collection", { id: aliceCollection });
  const communityRoute = (await asUser(alice.cookie, "GET", `/api/games/${hollow.id}/community`)).json();
  check(
    "set_time_to_beat on a game IGDB has a figure for overrides it, saying so with IGDB's figure beside it",
    override.data?.yourTimeToBeatHours?.main === 30 &&
      override.data.catalogTimeToBeatHours?.main === 27 &&
      override.data.note?.includes("in place of IGDB's"),
    override.data ?? override.text,
  );
  check(
    "…and every reader uses it: get_game, the progress estimate, collection hours",
    overriddenGame.data?.timeToBeatHours?.main === 30 &&
      overriddenGame.data.timeToBeatHours.completionist === 70 &&
      overriddenGame.data.timeToBeatHours.source === "yours" &&
      overriddenGame.data.progress?.totalHours === 30 &&
      overriddenGame.data.progress.remainingHours === 15 &&
      overriddenCol.data?.games.find((g: { title: string }) => g.title === hollow.title)?.hours === 30,
    { game: overriddenGame.data?.timeToBeatHours, progress: overriddenGame.data?.progress, collection: overriddenCol.data?.games },
  );
  check(
    "…while the community route still reports IGDB's own figure for the card to show beneath it",
    communityRoute.catalog?.ttbMain === 27 * 3600 &&
      communityRoute.catalog.source === "igdb" &&
      communityRoute.yours?.ttbMain === 30 * 3600,
    communityRoute,
  );
  const bobSees = (await asUser(bob.cookie, "GET", `/api/games/${hollow.id}`)).json();
  check(
    "…and nobody else's view changes: bob still sees IGDB's figure",
    bobSees.game?.ttbMain === 27 * 3600 && bobSees.game.ttbSource === "igdb",
    bobSees.game,
  );
  const backToIgdb = await tool(aliceWriteKey, "set_time_to_beat", {
    game: aHollow.id,
    mainHours: null,
    mainExtraHours: null,
    completionistHours: null,
  });
  const restoredGame = await tool(aliceKey, "get_game", { id: aHollow.id });
  const [hollowRow] = await db.select().from(schema.games).where(eq(schema.games.id, hollow.id));
  check(
    "clearing the override goes back to IGDB's figure, which was never touched",
    backToIgdb.data?.cleared === true &&
      backToIgdb.data.note?.includes("IGDB's again") &&
      restoredGame.data?.timeToBeatHours?.main === 27 &&
      restoredGame.data.timeToBeatHours.source === "igdb" &&
      restoredGame.data.progress?.totalHours === 27 &&
      hollowRow?.ttbMain === 27 * 3600 &&
      hollowRow.ttbSource === "igdb",
    { result: backToIgdb.data ?? backToIgdb.text, game: restoredGame.data?.timeToBeatHours },
  );

  console.log("\nWrites: checklists");
  const listsOf = (gameId: string, userId = alice.id) =>
    db
      .select()
      .from(schema.checklistTemplates)
      .where(and(eq(schema.checklistTemplates.gameId, gameId), eq(schema.checklistTemplates.authorUserId, userId)));
  const entriesOf = (templateId: string) =>
    db
      .select()
      .from(schema.checklistItems)
      .where(eq(schema.checklistItems.templateId, templateId))
      .orderBy(schema.checklistItems.position);
  const rowsOf = (entries: Array<{ position: number; text: string; category: string | null }>) =>
    entries.map((e) => [e.position, e.text, e.category]);

  // publish mode is still 'always' from the collection checks above
  const story = [
    { text: "Wake up", chapter: "Act 1" },
    { text: "Leave the village", chapter: "Act 1" },
    { text: "Cross the bridge", chapter: " Act 2 " },
    "Final boss",
  ];
  const madeList = await tool(aliceWriteKey, "create_checklist", {
    game: shortOne.title,
    title: "Story",
    kind: "main_story",
    items: story,
    sequential: true,
  });
  const [storyRow] = await listsOf(shortOne.id);
  const storyEntries = storyRow ? await entriesOf(storyRow.id) : [];
  check(
    "create_checklist makes a main story list, its items in order under their chapters",
    madeList.data?.created === true &&
      madeList.data.checklist.kind === "main story" &&
      madeList.data.checklist.sequential === true &&
      madeList.data.added === 4 &&
      storyRow?.kind === "missions" &&
      storyRow.sequential === true &&
      JSON.stringify(rowsOf(storyEntries)) ===
        JSON.stringify([[0, "Wake up", "Act 1"], [1, "Leave the village", "Act 1"], [2, "Cross the bridge", "Act 2"], [3, "Final boss", null]]),
    { result: madeList.data ?? madeList.text, entries: rowsOf(storyEntries) },
  );
  check(
    "…private, even though the publish preference is 'always'",
    madeList.data?.checklist.public === false && storyRow?.isPublic === false,
    madeList.data,
  );
  const storyGame = await tool(aliceWriteKey, "get_game", { title: shortOne.title });
  check(
    "…and it's what the game's progress now divides its time to beat across",
    storyGame.data?.progress?.missionsTotal === 4 &&
      storyGame.data.progress.missionsDone === 0 &&
      storyGame.data.progress.totalHours > 0 &&
      storyGame.data.progress.remainingHours === storyGame.data.progress.totalHours &&
      storyGame.data.checklists.some((c: { title: string; kind: string; total: number }) => c.title === "Story" && c.kind === "main story" && c.total === 4),
    storyGame.data ? { progress: storyGame.data.progress, checklists: storyGame.data.checklists } : storyGame.text,
  );
  const repeated = await tool(aliceWriteKey, "create_checklist", { game: shortOne.title, title: "Story", kind: "main_story", items: story });
  check(
    "the same call again adds nothing twice",
    repeated.data?.created === false && repeated.data.added === 0 && repeated.data.alreadyOnList === 4 && (await entriesOf(storyRow!.id)).length === 4,
    repeated.data ?? repeated.text,
  );
  const more = await tool(aliceWriteKey, "create_checklist", {
    game: shortOne.id,
    title: "STORY",
    items: [{ text: "final boss" }, { text: "Epilogue", chapter: "Act 3" }],
  });
  const afterMore = await entriesOf(storyRow!.id);
  check(
    "…while the list's title in any case appends only what's new, to the end",
    more.data?.created === false &&
      more.data.added === 1 &&
      more.data.alreadyOnList === 1 &&
      more.data.checklist.items === 5 &&
      JSON.stringify(rowsOf(afterMore).at(-1)) === JSON.stringify([4, "Epilogue", "Act 3"]) &&
      (await listsOf(shortOne.id)).length === 1,
    { result: more.data ?? more.text, entries: rowsOf(afterMore) },
  );
  const secondMain = await tool(aliceWriteKey, "create_checklist", {
    game: aHollow.id,
    title: "Another story",
    kind: "main_story",
    items: ["Somewhere"],
  });
  check(
    "a second main story list is refused, naming the one the game has",
    secondMain.isError && secondMain.text.includes('"Main quest"') && (await listsOf(hollow.id)).length === 1,
    secondMain.text,
  );

  // bob keeps a published list for the same game under the same name: alice's
  // call must make her own, never add to his
  const [bobsHollowList] = await db
    .insert(schema.checklistTemplates)
    .values({ gameId: hollow.id, authorUserId: bob.id, title: "Mask shards", kind: "side_quests", isPublic: true })
    .returning();
  const shards = await tool(aliceWriteKey, "create_checklist", {
    game: aHollow.id,
    title: "Mask shards",
    items: ["Mask Shard", "Mask Shard", "Mask Shard"],
    sequential: true,
  });
  const shardRow = (await listsOf(hollow.id)).find((l) => l.title === "Mask shards");
  check(
    "an extra list keeps repeated items, comes after the main story list, and can't be sequential",
    shards.data?.created === true &&
      shards.data.checklist.kind === "extra" &&
      shards.data.added === 3 &&
      shards.data.checklist.sequential === false &&
      shards.data.note?.includes("sequential") &&
      shardRow?.kind === "side_quests" &&
      shardRow.sequential === false &&
      shardRow.position > list!.position,
    shards.data ?? shards.text,
  );
  check(
    "…and bob's list of the same name for the same game is untouched",
    (await entriesOf(bobsHollowList!.id)).length === 0 && shardRow?.id !== bobsHollowList!.id,
  );
  await db.update(schema.checklistTemplates).set({ isPublic: true }).where(eq(schema.checklistTemplates.id, shardRow!.id));
  const shardsAgain = await tool(aliceWriteKey, "create_checklist", {
    game: hollow.title,
    title: "mask shards",
    items: ["Mask Shard", "Mask Shard", "Mask Shard", "Mask Shard"],
  });
  check(
    "repeating it counts the copies the list already has, adding only the one more",
    shardsAgain.data?.added === 1 && shardsAgain.data.alreadyOnList === 3 && (await entriesOf(shardRow!.id)).length === 4,
    shardsAgain.data ?? shardsAgain.text,
  );
  check("…and says so when the list it added to is published", shardsAgain.data?.note?.includes("published"), shardsAgain.data?.note);

  const filteredList = await tool(aliceWriteKey, "create_checklist", {
    game: wish.title,
    title: "Contacts",
    items: ["Find the merchant", `write to someone-${run}@example.com`],
  });
  const filteredAppend = await tool(aliceWriteKey, "create_checklist", {
    game: shortOne.title,
    title: "Story",
    items: [`call someone-${run}@example.com`],
  });
  check(
    "the content filter applies to every item, on a new list and an existing one",
    filteredList.isError && filteredAppend.isError && (await listsOf(wish.id)).length === 0 && (await entriesOf(storyRow!.id)).length === 5,
    { create: filteredList.text, append: filteredAppend.text },
  );
  const notOwnedList = await tool(aliceWriteKey, "create_checklist", { game: notOwned.title, title: "Nope", items: ["Nope"] });
  const bobsEntryList = await tool(aliceWriteKey, "create_checklist", { game: bSecret.id, title: "Nope", items: ["Nope"] });
  const bobsTitleList = await tool(aliceWriteKey, "create_checklist", { game: bobsGame.title, title: "Nope", items: ["Nope"] });
  check(
    "only games in the user's own library: not a catalog game she doesn't own, not bob's",
    notOwnedList.isError &&
      bobsEntryList.isError &&
      bobsTitleList.isError &&
      (await listsOf(notOwned.id)).length === 0 &&
      (await listsOf(bobsGame.id)).length === 0 &&
      (await listsOf(bobsGame.id, bob.id)).length === 0,
    { notOwned: notOwnedList.text, bobsEntry: bobsEntryList.text, bobsTitle: bobsTitleList.text },
  );

  // the web routes now share the service: they must behave as they did
  const pasted = await asUser(alice.cookie, "POST", `/api/games/${done.id}/missions`, { title: "Pasted", missions: ["One", "  ", "Two"] });
  const typed = await asUser(alice.cookie, "POST", `/api/games/${done.id}/checklists`, { title: "Endings" });
  check(
    "(the web app's own create routes still work, and still follow publish mode 'always')",
    pasted.statusCode === 201 &&
      pasted.json().count === 2 &&
      pasted.json().isPublic === true &&
      typed.statusCode === 201 &&
      typed.json().isPublic === true &&
      (await listsOf(done.id)).find((l) => l.id === typed.json().id)?.kind === "side_quests",
    { pasted: pasted.body, typed: typed.body },
  );
  const pastedAgain = await asUser(alice.cookie, "POST", `/api/games/${done.id}/missions`, { title: "Again", missions: ["Three"] });
  check("(…still refuse a second main story list with a 409)", pastedAgain.statusCode === 409, pastedAgain.body);
  const typedId = typed.statusCode === 201 ? (typed.json().id as string) : "";
  const addOne = await asUser(alice.cookie, "POST", `/api/checklists/${typedId}/items`, { text: "  Good ending ", category: " Endings " });
  const addBlank = await asUser(alice.cookie, "POST", `/api/checklists/${typedId}/items`, { text: "   " });
  const bobAdds = await asUser(bob.cookie, "POST", `/api/checklists/${typedId}/items`, { text: "bob was here" });
  check(
    "(…and POST /api/checklists/:id/items adds a trimmed entry, refuses a blank one and someone else's list)",
    addOne.statusCode === 201 &&
      addOne.json().position === 0 &&
      addBlank.statusCode === 400 &&
      bobAdds.statusCode === 404 &&
      JSON.stringify(rowsOf(await entriesOf(typedId))) === JSON.stringify([[0, "Good ending", "Endings"]]),
    { addOne: addOne.body, addBlank: addBlank.statusCode, bobAdds: bobAdds.statusCode },
  );

  console.log("\nWrites: ticking");
  /** The texts of a list's entries this user has ticked, in list order. */
  const ticksOf = async (templateId: string, userId = alice.id) =>
    (
      await db
        .select({ text: schema.checklistItems.text })
        .from(schema.userChecklistItems)
        .innerJoin(schema.checklistItems, eq(schema.checklistItems.id, schema.userChecklistItems.itemId))
        .where(and(eq(schema.checklistItems.templateId, templateId), eq(schema.userChecklistItems.userId, userId)))
        .orderBy(schema.checklistItems.position)
    ).map((r) => r.text);
  const progressOf = async (entryId: string) =>
    (await asUser(alice.cookie, "GET", `/api/library/${entryId}/progress`)).json() as {
      done: number;
      total: number;
      percent: number;
      remainingSeconds: number;
    };
  const hoursOf = (seconds: number) => Math.round(seconds / 360) / 10;

  const storyList = await tool(aliceKey, "get_checklist", { game: shortOne.title, list: "story" });
  check(
    "get_checklist (any key) numbers a list's items from 1 in order, with chapters and tick state",
    storyList.data?.list === "Story" &&
      storyList.data.kind === "main story" &&
      storyList.data.sequential === true &&
      storyList.data.total === 5 &&
      storyList.data.done === 0 &&
      JSON.stringify(storyList.data.items.map((i: any) => [i.number, i.text, i.chapter ?? null, i.done])) ===
        JSON.stringify([
          [1, "Wake up", "Act 1", false],
          [2, "Leave the village", "Act 1", false],
          [3, "Cross the bridge", "Act 2", false],
          [4, "Final boss", null, false],
          [5, "Epilogue", "Act 3", false],
        ]),
    storyList.data ?? storyList.text,
  );
  const whichList = await tool(aliceKey, "get_checklist", { game: aHollow.id });
  check(
    "…asks which list when a game has several, naming them",
    whichList.isError && whichList.text.includes('"Main quest" (main story)') && whichList.text.includes('"Mask shards" (extra)'),
    whichList.text,
  );
  const mainQuest = await tool(aliceKey, "get_checklist", { game: aHollow.id, list: "MAIN QUEST" });
  check(
    "…and says which items are ticked, and on what day",
    mainQuest.data?.done === 2 &&
      mainQuest.data.items[0].done === true &&
      /^\d{4}-\d{2}-\d{2}$/.test(mainQuest.data.items[0].doneOn) &&
      mainQuest.data.items[2].done === false &&
      mainQuest.data.items[2].doneOn === undefined,
    mainQuest.data ?? mainQuest.text,
  );

  const byText = await tool(aliceWriteKey, "tick_checklist_items", { game: aHollow.id, list: "main quest", items: ["boss 3"] });
  const afterText = await progressOf(aHollow.id);
  check(
    "tick_checklist_items ticks an item by its text, ignoring case",
    byText.data?.action === "ticked" &&
      byText.data.changed === 1 &&
      byText.data.changedItems[0]?.number === 3 &&
      byText.data.listProgress.done === 3 &&
      byText.data.listProgress.total === 4 &&
      JSON.stringify(await ticksOf(list!.id)) === JSON.stringify(["Boss 1", "Boss 2", "Boss 3"]),
    byText.data ?? byText.text,
  );
  check(
    "…and returns the game's progress as the Progress tab now shows it",
    byText.data?.gameProgress?.percent === 75 &&
      byText.data.gameProgress.percent === afterText.percent &&
      byText.data.gameProgress.missionsDone === 3 &&
      byText.data.gameProgress.remainingHours === hoursOf(afterText.remainingSeconds),
    { tool: byText.data?.gameProgress, route: afterText },
  );
  const movedGame = await tool(aliceKey, "get_game", { id: aHollow.id });
  check(
    "…which get_game reads back too",
    movedGame.data?.progress?.missionsDone === 3 && movedGame.data.progress.percent === 75 && movedGame.data.checklists[0]?.done === 3,
    movedGame.data?.progress,
  );
  const tickAgain = await tool(aliceWriteKey, "tick_checklist_items", { game: aHollow.id, list: "Main quest", items: ["Boss 3"] });
  check(
    "ticking it again changes nothing",
    tickAgain.data?.changed === 0 && tickAgain.data.unchanged === 1 && tickAgain.data.listProgress.done === 3,
    tickAgain.data ?? tickAgain.text,
  );
  const byNumber = await tool(aliceWriteKey, "tick_checklist_items", { game: hollow.title, list: "Main quest", numbers: [4] });
  check(
    "…ticks by number",
    byNumber.data?.changed === 1 && byNumber.data.changedItems[0]?.text === "Boss 4" && byNumber.data.gameProgress?.percent === 100,
    byNumber.data ?? byNumber.text,
  );
  const untick = await tool(aliceWriteKey, "tick_checklist_items", { game: aHollow.id, list: "Main quest", numbers: [2, 3], done: false });
  check(
    "done: false unticks exactly the items named",
    untick.data?.action === "unticked" &&
      untick.data.changed === 2 &&
      untick.data.gameProgress?.percent === 50 &&
      untick.data.listProgress.done === 2 &&
      JSON.stringify(await ticksOf(list!.id)) === JSON.stringify(["Boss 1", "Boss 4"]),
    untick.data ?? untick.text,
  );

  const fill = await tool(aliceWriteKey, "tick_checklist_items", { game: shortOne.title, list: "Story", items: ["Cross the bridge!"] });
  check(
    "on a sequential main story list, ticking an item fills in the unticked ones before it",
    fill.data?.changed === 1 &&
      fill.data.filledIn === 2 &&
      fill.data.note?.includes("before #3") &&
      fill.data.listProgress.done === 3 &&
      JSON.stringify(await ticksOf(storyRow!.id)) === JSON.stringify(["Wake up", "Leave the village", "Cross the bridge"]),
    fill.data ?? fill.text,
  );
  const unfill = await tool(aliceWriteKey, "tick_checklist_items", { game: shortOne.title, list: "Story", numbers: [1], done: false });
  check(
    "…while unticking clears only the item named",
    unfill.data?.changed === 1 && JSON.stringify(await ticksOf(storyRow!.id)) === JSON.stringify(["Leave the village", "Cross the bridge"]),
    unfill.data ?? unfill.text,
  );
  const wrongChapter = await tool(aliceWriteKey, "tick_checklist_items", {
    game: shortOne.title,
    list: "Story",
    items: [{ text: "Wake up", chapter: "Act 2" }],
  });
  const rightChapter = await tool(aliceWriteKey, "tick_checklist_items", {
    game: shortOne.title,
    list: "Story",
    items: [{ text: "wake up", chapter: "act 1" }],
  });
  check(
    "{ text, chapter } only matches under that chapter, and says where the text is instead",
    wrongChapter.data?.changed === 0 &&
      wrongChapter.data.notFound[0]?.reason.includes("isn't under") &&
      wrongChapter.data.notFound[0].reason.includes("#1") &&
      rightChapter.data?.changed === 1 &&
      rightChapter.data.filledIn === 0 &&
      JSON.stringify(await ticksOf(storyRow!.id)) === JSON.stringify(["Wake up", "Leave the village", "Cross the bridge"]),
    { wrong: wrongChapter.data ?? wrongChapter.text, right: rightChapter.data ?? rightChapter.text },
  );

  await db.update(schema.checklistTemplates).set({ sequential: true }).where(eq(schema.checklistTemplates.id, shardRow!.id));
  const shardEntries = await entriesOf(shardRow!.id);
  const extraTick = await tool(aliceWriteKey, "tick_checklist_items", { game: aHollow.id, list: "Mask shards", numbers: [3] });
  const [shardTick] = await db
    .select()
    .from(schema.userChecklistItems)
    .where(and(eq(schema.userChecklistItems.userId, alice.id), inArray(schema.userChecklistItems.itemId, shardEntries.map((e) => e.id))));
  check(
    "an extra list doesn't fill in, even flagged sequential, and says the game's progress didn't move",
    extraTick.data?.changed === 1 &&
      extraTick.data.filledIn === undefined &&
      extraTick.data.note?.includes("extra list") &&
      (await ticksOf(shardRow!.id)).length === 1 &&
      shardTick?.itemId === shardEntries[2]!.id,
    extraTick.data ?? extraTick.text,
  );
  const dup = await tool(aliceWriteKey, "tick_checklist_items", { game: aHollow.id, list: "Mask shards", items: ["Mask Shard"] });
  check(
    "a text that matches several items is never guessed: it comes back with each one's number and state",
    dup.data?.changed === 0 &&
      dup.data.notFound.length === 1 &&
      dup.data.notFound[0].reason.includes("is 4 items") &&
      dup.data.notFound[0].reason.includes('#3 "Mask Shard" (ticked)') &&
      dup.data.notFound[0].reason.includes('#1 "Mask Shard" (not ticked)') &&
      (await ticksOf(shardRow!.id)).length === 1,
    dup.data ?? dup.text,
  );
  const misses = await tool(aliceWriteKey, "tick_checklist_items", {
    game: shortOne.title,
    list: "Story",
    items: ["Cross bridge", "Collect every feather"],
    numbers: [9],
  });
  const missFor = (input: string): string =>
    misses.data?.notFound.find((m: { input: string }) => m.input === input)?.reason ?? "";
  check(
    "a near miss comes back with the closest items' numbers, an unknown one says so, and a number past the end is refused",
    misses.data?.changed === 0 &&
      missFor("Cross bridge").includes('#3 "Cross the bridge"') &&
      missFor("Collect every feather").includes("get_checklist") &&
      missFor("#9").includes("numbered 1 to 5") &&
      (await ticksOf(storyRow!.id)).length === 3,
    misses.data ?? misses.text,
  );
  const nothing = await tool(aliceWriteKey, "tick_checklist_items", { game: shortOne.title });
  const steamUntick = await tool(aliceWriteKey, "tick_checklist_items", { game: aHollow.id, list: "Main quest", steamAchievements: true, done: false });
  const noSuchList = await tool(aliceWriteKey, "tick_checklist_items", { game: aHollow.id, list: "Grubs", numbers: [1] });
  const noLists = await tool(aliceWriteKey, "tick_checklist_items", { game: longOne.title, numbers: [1] });
  check(
    "naming no items, unticking from Steam, an unknown list and a game with no lists are errors",
    nothing.isError &&
      steamUntick.isError &&
      noSuchList.isError &&
      noSuchList.text.includes('"Main quest"') &&
      noLists.isError &&
      noLists.text.includes("create_checklist"),
    { nothing: nothing.text, steamUntick: steamUntick.text, noSuchList: noSuchList.text, noLists: noLists.text },
  );

  console.log("\nSteam achievements");
  const noAchievements = await tool(aliceKey, "get_achievements", { game: shortOne.title });
  check(
    "get_achievements on a game with none synced says so",
    noAchievements.data?.total === 0 && noAchievements.data.note?.includes("Steam"),
    noAchievements.data ?? noAchievements.text,
  );
  const achs = await db
    .insert(schema.achievements)
    .values([
      { gameId: hollow.id, externalId: `boss2-${run}`, name: "Boss 2", description: "Beat the second boss." },
      { gameId: hollow.id, externalId: `boss3-${run}`, name: "Boss 3" },
      { gameId: hollow.id, externalId: `shard-${run}`, name: "Mask Shard" },
    ])
    .returning();
  await db.insert(schema.userAchievements).values([
    { userId: alice.id, achievementId: achs[0]!.id, unlockedAt: new Date("2026-10-10T12:00:00Z") },
    { userId: alice.id, achievementId: achs[2]!.id, unlockedAt: new Date("2026-10-12T12:00:00Z") },
    // bob's unlock is bob's: it must never tick alice's Boss 3
    { userId: bob.id, achievementId: achs[1]!.id, unlockedAt: new Date("2026-10-11T12:00:00Z") },
  ]);
  const aliceAchs = await tool(aliceKey, "get_achievements", { game: aHollow.id });
  check(
    "get_achievements lists a game's achievements with the user's own unlocks, newest first",
    aliceAchs.data?.total === 3 &&
      aliceAchs.data.unlocked === 2 &&
      aliceAchs.data.steamHours === 12.5 &&
      aliceAchs.data.achievements[1]?.description === "Beat the second boss." &&
      JSON.stringify(aliceAchs.data.achievements.map((a: any) => [a.name, a.unlocked, a.unlockedOn ?? null])) ===
        JSON.stringify([
          ["Mask Shard", true, "2026-10-12"],
          ["Boss 2", true, "2026-10-10"],
          ["Boss 3", false, null],
        ]),
    aliceAchs.data ?? aliceAchs.text,
  );
  const lockedOnly = await tool(aliceKey, "get_achievements", { game: aHollow.id, unlocked: false });
  check(
    "…filters to the locked ones",
    lockedOnly.data?.achievements.length === 1 && lockedOnly.data.achievements[0].name === "Boss 3",
    lockedOnly.data ?? lockedOnly.text,
  );
  const achGame = await tool(aliceKey, "get_game", { id: aHollow.id });
  check(
    "get_game carries the achievement counts",
    achGame.data?.steamAchievements?.unlocked === 2 && achGame.data.steamAchievements.total === 3,
    achGame.data?.steamAchievements,
  );
  const routeAchs = (await asUser(alice.cookie, "GET", `/api/library/${aHollow.id}/achievements`)).json();
  check(
    "(the web app's achievements route still answers the same, in name order)",
    routeAchs.total === 3 && routeAchs.unlocked === 2 && routeAchs.achievements[0]?.name === "Boss 2",
    routeAchs,
  );
  const fromSteam = await tool(aliceWriteKey, "tick_checklist_items", { game: aHollow.id, list: "Main quest", steamAchievements: true });
  check(
    "steamAchievements ticks items named exactly like an achievement the user unlocked — not one only someone else did",
    fromSteam.data?.changed === 1 &&
      fromSteam.data.changedItems[0]?.text === "Boss 2" &&
      fromSteam.data.steam?.unlockedAchievements === 2 &&
      fromSteam.data.steam.matchedItems === 1 &&
      fromSteam.data.notFound.length === 0 &&
      JSON.stringify(await ticksOf(list!.id)) === JSON.stringify(["Boss 1", "Boss 2", "Boss 4"]),
    fromSteam.data ?? fromSteam.text,
  );
  const steamShards = await tool(aliceWriteKey, "tick_checklist_items", { game: aHollow.id, list: "Mask shards", steamAchievements: true });
  check(
    "…and an achievement named like several items is a miss with their numbers, not four ticks",
    steamShards.data?.changed === 0 &&
      steamShards.data.steam?.matchedItems === 0 &&
      steamShards.data.notFound[0]?.reason.includes("4 items") &&
      (await ticksOf(shardRow!.id)).length === 1,
    steamShards.data ?? steamShards.text,
  );

  console.log("\nWrites: ticking is yours alone");
  const [bobsShard] = await db
    .insert(schema.checklistItems)
    .values({ templateId: bobsHollowList!.id, position: 0, text: "Mask Shard" })
    .returning();
  const [bobsList] = await db
    .insert(schema.checklistTemplates)
    .values({ gameId: bobsGame.id, authorUserId: bob.id, title: "Bob's quests", kind: "missions" })
    .returning();
  const [bobsItem] = await db
    .insert(schema.checklistItems)
    .values({ templateId: bobsList!.id, position: 0, text: "Secret mission" })
    .returning();
  const viaEntry = await tool(aliceWriteKey, "tick_checklist_items", { game: bSecret.id, numbers: [1] });
  const viaTitle = await tool(aliceWriteKey, "tick_checklist_items", { game: bobsGame.title, items: ["Secret mission"] });
  const readBobs = await tool(aliceKey, "get_checklist", { game: bSecret.id });
  const bobsAchs = await tool(aliceKey, "get_achievements", { game: bSecret.id });
  const routeBulk = await asUser(alice.cookie, "PUT", `/api/checklists/${bobsList!.id}/items/check`, {
    itemIds: [bobsItem!.id],
    completed: true,
  });
  const routeOne = await asUser(alice.cookie, "PUT", `/api/checklists/items/${bobsItem!.id}/check`, { completed: true });
  // bob's entry id smuggled into a tick of alice's own list: dropped, not ticked
  const smuggledIds = await asUser(alice.cookie, "PUT", `/api/checklists/${shardRow!.id}/items/check`, {
    itemIds: [bobsShard!.id],
    completed: true,
  });
  const bobsTicks = await db
    .select()
    .from(schema.userChecklistItems)
    .where(inArray(schema.userChecklistItems.itemId, [bobsItem!.id, bobsShard!.id]));
  check(
    "alice can't read or tick bob's lists — by his entry id, his game's title, or the web routes",
    viaEntry.isError &&
      viaTitle.isError &&
      readBobs.isError &&
      bobsAchs.isError &&
      routeBulk.statusCode === 404 &&
      routeOne.statusCode === 404 &&
      smuggledIds.statusCode === 200 &&
      smuggledIds.json().changed === 0 &&
      bobsTicks.length === 0,
    {
      viaEntry: viaEntry.text,
      viaTitle: viaTitle.text,
      readBobs: readBobs.text,
      routeBulk: routeBulk.statusCode,
      routeOne: routeOne.statusCode,
      smuggled: smuggledIds.body,
      bobsTicks: bobsTicks.length,
    },
  );
  const sameNameTick = await tool(aliceWriteKey, "tick_checklist_items", { game: aHollow.id, list: "Mask shards", numbers: [1] });
  check(
    "…and the list bob keeps under the same name for the same game isn't the one ticked",
    sameNameTick.data?.changed === 1 &&
      (await ticksOf(shardRow!.id)).length === 2 &&
      (await ticksOf(bobsHollowList!.id, bob.id)).length === 0 &&
      (await ticksOf(bobsHollowList!.id, alice.id)).length === 0,
    sameNameTick.data ?? sameNameTick.text,
  );

  const storyEntriesNow = await entriesOf(storyRow!.id);
  const bulkRoute = await asUser(alice.cookie, "PUT", `/api/checklists/${storyRow!.id}/items/check`, {
    itemIds: [storyEntriesNow[3]!.id, storyEntriesNow[4]!.id],
    completed: true,
  });
  const oneRoute = await asUser(alice.cookie, "PUT", `/api/checklists/items/${storyEntriesNow[4]!.id}/check`, { completed: false });
  const badRoute = await asUser(alice.cookie, "PUT", `/api/checklists/${storyRow!.id}/items/check`, { itemIds: [], completed: true });
  const storyDetail = (await asUser(alice.cookie, "GET", `/api/checklists/${storyRow!.id}`)).json() as {
    items: Array<{ text: string; completedAt: string | null }>;
  };
  check(
    "(the web app's tick routes still work — bulk, single, a bad body refused — and GET shows the result in order)",
    bulkRoute.statusCode === 200 &&
      bulkRoute.json().changed === 2 &&
      oneRoute.statusCode === 200 &&
      badRoute.statusCode === 400 &&
      JSON.stringify(storyDetail.items.map((i) => [i.text, i.completedAt !== null])) ===
        JSON.stringify([
          ["Wake up", true],
          ["Leave the village", true],
          ["Cross the bridge", true],
          ["Final boss", true],
          ["Epilogue", false],
        ]),
    { bulk: bulkRoute.body, one: oneRoute.body, bad: badRoute.statusCode, items: storyDetail.items },
  );

  console.log("\nWrites: limits and logging");
  const batch = await app.inject({
    method: "POST",
    url: "/api/mcp",
    headers: { ...MCP_HEADERS, authorization: `Bearer ${aliceWriteKey}` },
    payload: [
      { jsonrpc: "2.0", id: ++rpcId, method: "tools/call", params: { name: "create_tag", arguments: { name: `batch-a-${run}` } } },
      { jsonrpc: "2.0", id: ++rpcId, method: "tools/call", params: { name: "create_tag", arguments: { name: `batch-b-${run}` } } },
    ],
  });
  const batchTags = await db.select().from(schema.tags).where(and(eq(schema.tags.userId, alice.id), ilike(schema.tags.name, `batch-%-${run}`)));
  check(
    "a JSON-RPC batch can't carry more than one write past the rate limiter",
    batchTags.length === 1 && batch.body.includes("one change per request"),
    { status: batch.statusCode, tags: batchTags.map((t) => t.name), body: batch.body.slice(0, 400) },
  );
  await flushEvents();
  const writeEvents = await db
    .select()
    .from(schema.analyticsEvents)
    .where(and(eq(schema.analyticsEvents.userId, alice.id), eq(schema.analyticsEvents.type, "mcp_write")));
  const loggedTools = new Set(writeEvents.map((e) => (e.meta as { tool?: string } | null)?.tool));
  check(
    "every write tool logs an mcp_write event with its name and counts, and no titles",
    WRITE_TOOLS.every((name) => loggedTools.has(name)) &&
      !writeEvents.some((e) => JSON.stringify(e.meta).includes(run)),
    { tools: [...loggedTools], sample: writeEvents.slice(0, 3).map((e) => e.meta) },
  );

  console.log("\nRevoking");
  const revoke = await asUser(alice.cookie, "DELETE", `/api/api-keys/${aliceKeyId}`);
  check("revoking a key succeeds", revoke.statusCode === 200, revoke.body);
  check("a revoked key → 401", (await rpc(aliceKey, "tools/list")).statusCode === 401);

  console.log("\nOAuth discovery");
  const prm = await app.inject({ method: "GET", url: "/.well-known/oauth-protected-resource" });
  check(
    "/.well-known/oauth-protected-resource names /api/mcp and its authorization server",
    prm.statusCode === 200 &&
      prm.json().resource === MCP_RESOURCE &&
      prm.json().authorization_servers?.[0] === OAUTH_ISSUER &&
      prm.json().scopes_supported?.includes(MCP_SCOPE) &&
      prm.json().scopes_supported?.includes(MCP_WRITE_SCOPE),
    prm.body,
  );
  const prmInserted = await app.inject({ method: "GET", url: "/.well-known/oauth-protected-resource/api/mcp" });
  check(
    "…and at its path-inserted address",
    prmInserted.statusCode === 200 && prmInserted.json().resource === MCP_RESOURCE,
  );
  for (const url of [
    "/.well-known/oauth-authorization-server",
    "/.well-known/oauth-authorization-server/api/auth",
  ]) {
    const asm = await app.inject({ method: "GET", url });
    const meta = asm.statusCode === 200 ? asm.json() : {};
    check(
      `${url} describes registration, authorize and token endpoints`,
      meta.issuer === OAUTH_ISSUER &&
        meta.registration_endpoint === `${OAUTH_ISSUER}/oauth2/register` &&
        meta.authorization_endpoint === `${OAUTH_ISSUER}/oauth2/authorize` &&
        meta.token_endpoint === `${OAUTH_ISSUER}/oauth2/token` &&
        meta.code_challenge_methods_supported?.includes("S256") &&
        meta.token_endpoint_auth_methods_supported?.includes("none"),
      asm.body,
    );
  }
  const challenge401 = await rpc(null, "tools/list");
  check(
    "a 401 from /api/mcp points to the resource metadata",
    String(challenge401.headers["www-authenticate"]).includes(
      `resource_metadata="${PROTECTED_RESOURCE_METADATA_URL}"`,
    ),
    challenge401.headers["www-authenticate"],
  );

  console.log("\nOAuth registration");
  const evil = await registerClient(["https://evil.example/callback"]);
  check(
    "registering a redirect URI that isn't Claude's or loopback is refused",
    evil.res.statusCode === 400,
    evil.res.body,
  );
  const mixed = await registerClient([CLAUDE_CALLBACK, "https://evil.example/callback"]);
  check("…even alongside Claude's", mixed.res.statusCode === 400, mixed.res.body);
  const local = await registerClient(["http://localhost:33418/callback"]);
  check("loopback redirect URIs (Claude Code) are accepted", local.res.statusCode < 300, local.res.body);
  const claude = await registerClient([CLAUDE_CALLBACK]);
  check("claude.ai's callback is accepted", claude.res.statusCode < 300 && !!claude.clientId, claude.res.body);
  const clientId = claude.clientId!;
  const createClient = await asUser(alice.cookie, "POST", "/api/auth/oauth2/create-client", {
    redirect_uris: ["https://evil.example/callback"],
  });
  check(
    "the plugin's own create-client endpoint isn't reachable",
    createClient.statusCode === 404,
    createClient.statusCode,
  );

  console.log("\nOAuth sign-in");
  const anon = await app.inject({
    method: "GET",
    url: authorizePath(clientId, pkce().challenge, MCP_SCOPE),
  });
  check(
    "authorizing while signed out sends you to /login with a signed query",
    anon.statusCode === 302 &&
      String(anon.headers.location).startsWith("/login?") &&
      String(anon.headers.location).includes("sig="),
    anon.headers.location,
  );

  // carol has two-factor on: her password alone must not produce a code
  const carol = await makeUser("carol");
  const carolCode = await enableTwoFactor(carol.cookie);
  const { verifier: carolVerifier, challenge: carolChallenge } = pkce();
  const toLogin = await app.inject({
    method: "GET",
    url: authorizePath(clientId, carolChallenge, `${MCP_SCOPE} offline_access`),
  });
  const loginQuery = signedQueryOf(String(toLogin.headers.location));
  const signIn = await app.inject({
    method: "POST",
    url: "/api/auth/sign-in/email",
    headers: { "content-type": "application/json", accept: "application/json", origin: ORIGIN },
    payload: {
      email: `mcp-check-carol-${run}@example.test`,
      password: PASSWORD,
      oauth_query: loginQuery,
    },
  });
  const signInBody = signIn.json() as { twoFactorRedirect?: boolean; url?: string };
  check(
    "with two-factor on, the password alone doesn't continue the OAuth flow",
    signIn.statusCode === 200 && signInBody.twoFactorRedirect === true && !signInBody.url,
    signIn.body,
  );
  const twoFactorCookie =
    /(?:__Secure-)?better-auth\.two_factor=[^;]+/.exec(String(signIn.headers["set-cookie"]))?.[0] ?? "";
  const verified = await app.inject({
    method: "POST",
    url: "/api/auth/two-factor/verify-totp",
    headers: {
      "content-type": "application/json",
      accept: "application/json",
      origin: ORIGIN,
      cookie: twoFactorCookie,
    },
    payload: { code: await carolCode(), oauth_query: loginQuery },
  });
  const verifiedBody = verified.json() as { redirect?: boolean; url?: string };
  check(
    "…the authenticator code does, on to the consent screen",
    verifiedBody.redirect === true && String(verifiedBody.url).startsWith("/oauth/consent?"),
    verified.body,
  );
  const carolSession =
    /(?:__Secure-)?better-auth\.session_token=[^;]+/.exec(String(verified.headers["set-cookie"]))?.[0] ?? "";
  const carolConsent = await consent(carolSession, String(verifiedBody.url), true);
  const carolRedirect = carolConsent.url ? new URL(carolConsent.url) : null;
  const carolAuthCode = carolRedirect?.searchParams.get("code") ?? null;
  check(
    "allowing on the consent screen sends a code back to claude.ai with the state",
    !!carolAuthCode &&
      carolConsent.url!.startsWith(CLAUDE_CALLBACK) &&
      carolRedirect!.searchParams.get("state") === "st4te",
    carolConsent,
  );
  const carolTokens = await exchange(clientId, {
    grant_type: "authorization_code",
    code: carolAuthCode ?? "",
    redirect_uri: CLAUDE_CALLBACK,
    code_verifier: carolVerifier,
    resource: MCP_RESOURCE,
  });
  check(
    "the code exchanges (form-encoded, PKCE) for an access and a refresh token",
    carolTokens.status === 200 &&
      String(carolTokens.body.access_token).startsWith("gmat_") &&
      String(carolTokens.body.refresh_token).startsWith("gmrt_"),
    carolTokens,
  );
  const replayed = await exchange(clientId, {
    grant_type: "authorization_code",
    code: carolAuthCode ?? "",
    redirect_uri: CLAUDE_CALLBACK,
    code_verifier: carolVerifier,
  });
  check("a code can't be exchanged twice", replayed.status >= 400, replayed);

  console.log("\nOAuth access");
  const aliceTokens = await connect(alice.cookie, clientId);
  const aliceAccess = String(aliceTokens.body.access_token);
  const viaOAuth = await tool(aliceAccess, "list_library");
  check("an OAuth access token reads its owner's library", viaOAuth.data?.total === 7, viaOAuth.text.slice(0, 200));
  const oauthWrite = await tool(aliceAccess, "create_tag", { name: `oauth-refused-${run}` });
  check(
    "a token without library:write is refused by write tools, saying how to reconnect",
    oauthWrite.isError && oauthWrite.text.includes("This connection is read-only") && oauthWrite.text.includes("Allow changes"),
    oauthWrite.text,
  );
  const carolView = await tool(String(carolTokens.body.access_token), "list_library");
  check("…and each person's token only theirs", carolView.data?.total === 0, carolView.text.slice(0, 200));
  const tokenAsSession = await app.inject({
    method: "GET",
    url: "/api/library",
    headers: { authorization: `Bearer ${aliceAccess}` },
  });
  check(
    "an access token is not a session anywhere else",
    tokenAsSession.statusCode === 401,
    tokenAsSession.statusCode,
  );
  const refreshed = await exchange(clientId, {
    grant_type: "refresh_token",
    refresh_token: String(aliceTokens.body.refresh_token),
  });
  const refreshedCats = await tool(String(refreshed.body.access_token), "list_categories");
  check(
    "the refresh token gets a fresh access token that works",
    refreshed.status === 200 && refreshedCats.data?.categories?.length === 8,
    refreshed,
  );

  // bob says no, then grants a token without library:read
  const bobAuthorize = await app.inject({
    method: "GET",
    url: authorizePath(clientId, pkce().challenge, `${MCP_SCOPE} offline_access`),
    headers: { cookie: bob.cookie },
  });
  const denied = await consent(bob.cookie, String(bobAuthorize.headers.location), false);
  check(
    "denying on the consent screen tells claude.ai access_denied",
    !!denied.url && new URL(denied.url).searchParams.get("error") === "access_denied",
    denied,
  );
  // a client that registered for sign-in only; one registered without a
  // scope is held to the advertised scopes and can't ask for openid
  const signInOnly = await registerClient([CLAUDE_CALLBACK], "openid");
  const openidOnly = await connect(bob.cookie, signInOnly.clientId!, "openid");
  const noScope = await rpc(String(openidOnly.body.access_token), "tools/list");
  check(
    "a token without library:read gets 403 insufficient_scope",
    noScope.statusCode === 403 &&
      String(noScope.headers["www-authenticate"]).includes('error="insufficient_scope"'),
    { status: noScope.statusCode, header: noScope.headers["www-authenticate"] },
  );

  console.log("\nOAuth changes (library:write)");
  // better-auth allows five registrations a minute and the checks above used
  // them, so these reuse the clients already registered. `clientId` was
  // registered without naming scopes, so it gets the defaults — which now
  // include library:write.
  const allScopes = `${MCP_SCOPE} ${MCP_WRITE_SCOPE} offline_access`;
  const tokenScopes = async (token: string) => {
    const [row] = await db
      .select({ scopes: schema.oauthAccessToken.scopes })
      .from(schema.oauthAccessToken)
      .where(eq(schema.oauthAccessToken.token, hashOAuthToken(token.slice("gmat_".length))));
    return row?.scopes ?? [];
  };
  // carol connected this client for reading earlier; asking for changes too
  // brings the consent screen back, and she leaves "Allow changes" unticked
  const carolNarrow = await connect(carolSession, clientId, allScopes, `${MCP_SCOPE} offline_access`);
  const narrowToken = String(carolNarrow.body.access_token);
  const narrowWrite = await tool(narrowToken, "create_tag", { name: `carol-narrow-${run}` });
  const narrowRead = await tool(narrowToken, "list_library");
  check(
    'leaving "Allow changes" unticked grants the rest: the token reads and is refused writes',
    !(await tokenScopes(narrowToken)).includes(MCP_WRITE_SCOPE) && narrowRead.data?.total === 0 && narrowWrite.isError,
    { scopes: await tokenScopes(narrowToken), write: narrowWrite.text },
  );
  // …then connects again and ticks it
  const carolWrite = await connect(carolSession, clientId, allScopes);
  const carolWriteToken = String(carolWrite.body.access_token);
  const carolTag = await tool(carolWriteToken, "create_tag", { name: `carol-oauth-${run}` });
  check(
    "consenting to library:write gives a token the write tools accept",
    (await tokenScopes(carolWriteToken)).includes(MCP_WRITE_SCOPE) && carolTag.data?.created === true,
    { scopes: await tokenScopes(carolWriteToken), result: carolTag.text },
  );
  const carolApps = (await asUser(carolSession, "GET", "/api/oauth-connections")).json() as Array<{ scopes: string[] }>;
  check("connected apps shows the connection can make changes", carolApps[0]?.scopes.includes(MCP_WRITE_SCOPE) === true, carolApps);
  // a registration from before library:write existed: read and refresh only
  const LOCAL_CALLBACK = "http://localhost:33418/callback";
  await db
    .update(schema.oauthClient)
    .set({ scopes: [MCP_SCOPE, "offline_access"] })
    .where(eq(schema.oauthClient.clientId, local.clientId!));
  const oldAuthorize = await app.inject({
    method: "GET",
    url: `/api/auth/oauth2/authorize?${new URLSearchParams({
      response_type: "code",
      client_id: local.clientId!,
      redirect_uri: LOCAL_CALLBACK,
      scope: allScopes,
      state: "st4te",
      code_challenge: pkce().challenge,
      code_challenge_method: "S256",
    })}`,
    headers: { cookie: alice.cookie },
  });
  check(
    "a client registered for reading only — every connector before this — can't ask for library:write",
    String(oldAuthorize.headers.location ?? "").includes("error=invalid_scope"),
    oldAuthorize.headers.location,
  );

  console.log("\nDisconnecting");
  const connections = (await asUser(alice.cookie, "GET", "/api/oauth-connections")).json() as Array<{
    clientId: string;
    redirectHost: string;
  }>;
  check(
    "connected apps lists the client with where it signs in",
    connections.length === 1 &&
      connections[0]!.clientId === clientId &&
      connections[0]!.redirectHost === "claude.ai",
    connections,
  );
  const bobDisconnects = await asUser(bob.cookie, "DELETE", `/api/oauth-connections/${clientId}`);
  const aliceStillIn = (await rpc(String(refreshed.body.access_token), "tools/list")).statusCode;
  check(
    // bob denied this app, so he has nothing to disconnect — and the attempt
    // mustn't reach alice's consent or tokens for the same client
    "someone else disconnecting the same app doesn't touch your tokens",
    bobDisconnects.statusCode === 404 && aliceStillIn === 200,
    { bobDisconnects: bobDisconnects.statusCode, aliceStillIn },
  );
  const disconnected = await asUser(alice.cookie, "DELETE", `/api/oauth-connections/${clientId}`);
  check("disconnecting succeeds", disconnected.statusCode === 200, disconnected.body);
  check(
    "…and the app's access token stops working at once",
    (await rpc(String(refreshed.body.access_token), "tools/list")).statusCode === 401,
  );
  const afterRefresh = await exchange(clientId, {
    grant_type: "refresh_token",
    refresh_token: String(refreshed.body.refresh_token ?? aliceTokens.body.refresh_token),
  });
  check("…as does its refresh token", afterRefresh.status >= 400, afterRefresh);

  const [unchanged] = await db.select().from(schema.userGames).where(eq(schema.userGames.id, aHollow.id));
  check("nothing in the library was written", unchanged?.notes === "Stuck on the Mantis Lords." && unchanged.status === "playing");
} catch (err) {
  failed += 1;
  console.error("  FAIL the check itself threw:", err);
} finally {
  // users cascade to everything they own; catalog rows are shared, so only
  // the ones made here go
  if (createdUsers.length > 0) await db.delete(schema.user).where(inArray(schema.user.id, createdUsers));
  // registered unauthenticated, so owned by nobody and not cascaded
  if (createdClients.length > 0) {
    await db.delete(schema.oauthClient).where(inArray(schema.oauthClient.clientId, createdClients));
  }
  if (createdGames.length > 0) await db.delete(schema.games).where(inArray(schema.games.id, createdGames));
  if (createdPlatforms.length > 0) {
    await db.delete(schema.platforms).where(inArray(schema.platforms.id, createdPlatforms.reverse()));
  }
  await app.close();
}

console.log(`\n${passed}/${passed + failed} passed`);
process.exit(failed > 0 ? 1 : 0);
