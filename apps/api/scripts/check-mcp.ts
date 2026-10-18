/**
 * The MCP endpoint, end to end: who may call it, that one user can never see
 * another's library through it, and what each tool answers.
 *
 * Unlike the other check scripts this needs a database — migrated, with
 * DATABASE_URL and BETTER_AUTH_SECRET set as for `pnpm dev:api`:
 *
 *   pnpm --filter @gm/api check:mcp
 *
 * It drives the real app in-process (`buildServer()` + `inject`), so the
 * auth, rate limits and routing under test are the production ones. Two
 * throwaway accounts (`mcp-check-…@example.test`) get a small library each
 * and are deleted afterwards along with the catalog rows made for them, so
 * it's safe to point at a dev database — but a scratch one is better.
 */
import { randomBytes } from "node:crypto";
import { inArray, eq } from "drizzle-orm";
import { auth } from "../src/auth.js";
import { db, schema } from "../src/db/index.js";
import { buildServer } from "../src/server.js";

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

  const [unchanged] = await db.select().from(schema.userGames).where(eq(schema.userGames.id, aHollow.id));
  check("nothing in the library was written", unchanged?.notes === "Stuck on the Mantis Lords." && unchanged.status === "playing");
} catch (err) {
  failed += 1;
  console.error("  FAIL the check itself threw:", err);
} finally {
  // users cascade to everything they own; catalog rows are shared, so only
  // the ones made here go
  if (createdUsers.length > 0) await db.delete(schema.user).where(inArray(schema.user.id, createdUsers));
  if (createdGames.length > 0) await db.delete(schema.games).where(inArray(schema.games.id, createdGames));
  if (createdPlatforms.length > 0) {
    await db.delete(schema.platforms).where(inArray(schema.platforms.id, createdPlatforms.reverse()));
  }
  await app.close();
}

console.log(`\n${passed}/${passed + failed} passed`);
process.exit(failed > 0 ? 1 : 0);
