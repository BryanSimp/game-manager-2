/**
 * The MCP endpoint, end to end: who may call it, that one user can never see
 * another's library through it, what each tool answers, and the OAuth flow
 * claude.ai's connector takes to get in (discovery, registration, login with
 * two-factor, consent, tokens, disconnecting).
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
import { inArray, eq } from "drizzle-orm";
import { base32 } from "@better-auth/utils/base32";
import { createOTP } from "@better-auth/utils/otp";
import { MCP_SCOPE } from "@gm/shared";
import { auth } from "../src/auth.js";
import { db, schema } from "../src/db/index.js";
import { env } from "../src/env.js";
import { buildServer } from "../src/server.js";
import {
  MCP_RESOURCE,
  OAUTH_ISSUER,
  PROTECTED_RESOURCE_METADATA_URL,
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

async function asUser(cookie: string, method: "GET" | "POST" | "DELETE", url: string, payload?: unknown) {
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

async function consent(cookie: string, location: string, accept: boolean) {
  const res = await app.inject({
    method: "POST",
    url: "/api/auth/oauth2/consent",
    headers: {
      cookie,
      origin: ORIGIN,
      accept: "application/json",
      "content-type": "application/json",
    },
    payload: { accept, oauth_query: signedQueryOf(location) },
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
async function connect(cookie: string, clientId: string, scope = `${MCP_SCOPE} offline_access`) {
  const { verifier, challenge } = pkce();
  const authorize = await app.inject({
    method: "GET",
    url: authorizePath(clientId, challenge, scope),
    headers: { cookie },
  });
  let location = String(authorize.headers.location ?? "");
  if (location.startsWith("/oauth/consent")) {
    location = (await consent(cookie, location, true)).url ?? "";
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
  check(
    "tools/list offers the seven tools",
    JSON.stringify(names) ===
      JSON.stringify(["get_backlog_candidates", "get_collection", "get_dashboard", "get_game", "list_categories", "list_collections", "list_library"]),
    names,
  );
  check("every tool is annotated read-only", tools.every((t) => t.annotations?.readOnlyHint === true));

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
      prm.json().scopes_supported?.includes(MCP_SCOPE),
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
  // scope is held to library:read + offline_access and can't ask for openid
  const signInOnly = await registerClient([CLAUDE_CALLBACK], "openid");
  const openidOnly = await connect(bob.cookie, signInOnly.clientId!, "openid");
  const noScope = await rpc(String(openidOnly.body.access_token), "tools/list");
  check(
    "a token without library:read gets 403 insufficient_scope",
    noScope.statusCode === 403 &&
      String(noScope.headers["www-authenticate"]).includes('error="insufficient_scope"'),
    { status: noScope.statusCode, header: noScope.headers["www-authenticate"] },
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
