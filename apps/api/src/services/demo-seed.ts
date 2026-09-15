import { and, count, eq, inArray } from "drizzle-orm";
import type { AnyPgColumn, PgTable } from "drizzle-orm/pg-core";
import { MAIN_LIST_KIND, EXTRA_LIST_KIND } from "@gm/shared";
import { db, schema } from "../db/index.js";
import { clearDemoCache, demoUser } from "./demo.js";
import { createManualGame, upsertGameFromIgdb } from "./catalog.js";
import { igdbConfigured, searchIgdb } from "./igdb.js";

/**
 * Seeds the read-only demo account behind `/demo`.
 *
 * Idempotent: it wipes the demo accounts' own rows and rebuilds them, so
 * re-running after a schema or content change is safe and is the intended
 * way to refresh the tour. It never touches a real account, and the shared
 * catalog rows it creates are ordinary games — the demo owns nothing that
 * real users don't also get to use.
 *
 * **Games come from IGDB when it's configured**, through the same
 * `upsertGameFromIgdb` the app uses, so the tour has real covers, summaries,
 * release dates and play times rather than grey boxes. Without credentials it
 * degrades to title-only rows: the demo still demonstrates every screen, it
 * just looks plainer. That fallback is why this can be run on a fresh install
 * before an admin has pasted IGDB credentials in Settings.
 *
 *   pnpm --filter @gm/api db:seed-demo
 */

const DEMO_EMAIL = "demo@gamesmanager.app";
const DEMO_NAME = "Alex (demo)";

/**
 * The friends list needs friends. These exist only to populate it.
 *
 * Codes are hand-written in the format `ensureFriendCode` generates, using
 * only the ambiguity-free alphabet in services/friends.ts (no O/0, I/L/1,
 * S/5 or B) — a seeded code that `normalizeFriendCode` rejects would render
 * on the friends page as something nobody could type back in.
 */
const FRIENDS = [
  { email: "demo-friend-1@gamesmanager.app", name: "Priya", code: "GM-PRYA-3344" },
  { email: "demo-friend-2@gamesmanager.app", name: "Marcus", code: "GM-MARC-7788" },
];

type Status = "playing" | "backlog" | "finished" | "wishlist" | "shelved" | "dropped";

/**
 * The demo library.
 *
 * Chosen to cover the shape of a real collection rather than to be a "best
 * games" list: a couple of long RPGs in progress, a shelf of retro cartridges
 * (which is what makes the 3D box viewer and the box-art scans show up), some
 * Steam-imported PC games with playtime, a wishlist, and one dropped game —
 * because a library where nothing was ever abandoned isn't anyone's.
 */
interface DemoGame {
  /** searched on IGDB; also the fallback title when IGDB isn't configured */
  title: string;
  status: Status;
  rating?: number;
  notes?: string;
  /** platform names, matched against the seeded platforms table */
  platforms: Array<{ name: string; format: "physical" | "digital" }>;
  tags?: string[];
  /** minutes, as a Steam import would have set them */
  steamMinutes?: number;
  completed100?: boolean;
}

const LIBRARY: DemoGame[] = [
  {
    title: "The Legend of Zelda: Breath of the Wild",
    status: "playing",
    rating: 5,
    notes: "Shrine hunting before the last divine beast. Don't start Ganon until the master sword is upgraded.",
    platforms: [{ name: "Switch", format: "physical" }],
    tags: ["Open world", "Playing with a guide"],
  },
  {
    title: "Elden Ring",
    status: "playing",
    rating: 4.5,
    notes: "Level 78, Altus Plateau. Bleed build.",
    platforms: [{ name: "Steam", format: "digital" }],
    steamMinutes: 4_920,
    tags: ["Souls-like", "Open world"],
  },
  {
    title: "Hades",
    status: "finished",
    rating: 5,
    completed100: true,
    platforms: [{ name: "Steam", format: "digital" }],
    steamMinutes: 3_640,
    tags: ["Roguelike", "Short sessions"],
  },
  {
    title: "Disco Elysium",
    status: "finished",
    rating: 5,
    notes: "One of the few games where reading is the gameplay. Play it twice.",
    platforms: [{ name: "GOG", format: "digital" }],
    tags: ["Story-heavy"],
  },
  {
    title: "Red Dead Redemption 2",
    status: "backlog",
    platforms: [{ name: "Steam", format: "digital" }],
    steamMinutes: 260,
    tags: ["Open world", "Long haul"],
  },
  {
    title: "Baldur's Gate 3",
    status: "playing",
    rating: 5,
    notes: "Act 2. Party: bard, cleric, warlock, and whatever Karlach is doing.",
    platforms: [{ name: "Steam", format: "digital" }],
    steamMinutes: 6_180,
    tags: ["Story-heavy", "Long haul", "Co-op"],
  },
  {
    title: "Hollow Knight",
    status: "playing",
    rating: 4.5,
    platforms: [{ name: "Switch", format: "digital" }],
    tags: ["Metroidvania"],
  },
  {
    title: "Celeste",
    status: "finished",
    rating: 5,
    platforms: [{ name: "Switch", format: "physical" }],
    tags: ["Short sessions", "Platformer"],
  },
  {
    title: "Stardew Valley",
    status: "shelved",
    rating: 4,
    notes: "Year 3, still no greenhouse. Endless by design — excluded from backlog time.",
    platforms: [{ name: "Steam", format: "digital" }],
    steamMinutes: 8_450,
    tags: ["Cosy", "Endless"],
  },
  {
    title: "Cyberpunk 2077",
    status: "backlog",
    platforms: [{ name: "GOG", format: "digital" }],
    tags: ["Open world"],
  },
  {
    title: "Metal Gear Solid V: The Phantom Pain",
    status: "playing",
    rating: 4,
    platforms: [{ name: "Steam", format: "digital" }],
    steamMinutes: 2_140,
    tags: ["Stealth", "Long haul"],
  },
  {
    title: "Outer Wilds",
    status: "finished",
    rating: 5,
    notes: "Go in knowing nothing. Genuinely.",
    platforms: [{ name: "Steam", format: "digital" }],
    steamMinutes: 1_490,
    tags: ["Story-heavy", "Short sessions"],
  },
  {
    title: "Super Mario Odyssey",
    status: "finished",
    rating: 4.5,
    platforms: [{ name: "Switch", format: "physical" }],
    tags: ["Platformer"],
  },
  {
    title: "God of War Ragnarök",
    status: "backlog",
    platforms: [{ name: "PS5", format: "physical" }],
    tags: ["Story-heavy"],
  },
  {
    title: "Returnal",
    status: "dropped",
    rating: 3.5,
    notes: "Bounced off the run length. Might come back to it.",
    platforms: [{ name: "PS5", format: "physical" }],
    tags: ["Roguelike"],
  },
  {
    title: "The Legend of Zelda: Ocarina of Time",
    status: "finished",
    rating: 5,
    platforms: [{ name: "N64", format: "physical" }],
    tags: ["Retro shelf"],
  },
  {
    title: "Super Mario 64",
    status: "finished",
    rating: 4.5,
    platforms: [{ name: "N64", format: "physical" }],
    tags: ["Retro shelf", "Platformer"],
  },
  {
    title: "GoldenEye 007",
    status: "shelved",
    rating: 4,
    platforms: [{ name: "N64", format: "physical" }],
    tags: ["Retro shelf"],
  },
  {
    title: "Chrono Trigger",
    status: "backlog",
    platforms: [{ name: "SNES", format: "physical" }],
    tags: ["Retro shelf", "JRPG"],
  },
  {
    title: "Super Metroid",
    status: "finished",
    rating: 5,
    platforms: [{ name: "SNES", format: "physical" }],
    tags: ["Retro shelf", "Metroidvania"],
  },
  {
    title: "Silksong",
    status: "wishlist",
    platforms: [],
    tags: ["Metroidvania"],
  },
  {
    title: "Pokémon Legends: Z-A",
    status: "wishlist",
    platforms: [],
  },
  {
    title: "Portal 2",
    status: "finished",
    rating: 5,
    platforms: [{ name: "Steam", format: "digital" }],
    steamMinutes: 780,
    tags: ["Co-op", "Short sessions"],
  },
  {
    title: "Slay the Spire",
    status: "playing",
    rating: 4.5,
    platforms: [{ name: "Steam", format: "digital" }],
    steamMinutes: 5_310,
    tags: ["Roguelike", "Short sessions", "Endless"],
  },
];

/** Tag colours, so the tag manager isn't a wall of grey in the tour. */
const TAG_COLORS: Record<string, { color: string; group?: string }> = {
  "Open world": { color: "#38bdf8", group: "Genre" },
  "Souls-like": { color: "#fb7185", group: "Genre" },
  Roguelike: { color: "#a78bfa", group: "Genre" },
  Metroidvania: { color: "#34d399", group: "Genre" },
  Platformer: { color: "#fbbf24", group: "Genre" },
  JRPG: { color: "#f472b6", group: "Genre" },
  Stealth: { color: "#94a3b8", group: "Genre" },
  "Story-heavy": { color: "#818cf8", group: "Mood" },
  Cosy: { color: "#fda4af", group: "Mood" },
  "Short sessions": { color: "#4ade80", group: "How I play" },
  "Long haul": { color: "#f97316", group: "How I play" },
  "Playing with a guide": { color: "#a3a3a3", group: "How I play" },
  "Co-op": { color: "#22d3ee", group: "How I play" },
  Endless: { color: "#71717a", group: "How I play" },
  "Retro shelf": { color: "#eab308", group: "Where" },
};

interface DemoCollection {
  name: string;
  description: string;
  accent: string;
  isPublic: boolean;
  /** titles, in play order — matched back to the games seeded above */
  titles: string[];
  /** extra titles that are in the collection but NOT in the demo library */
  wanted?: string[];
}

const COLLECTIONS: DemoCollection[] = [
  {
    name: "Zelda, in release order",
    description:
      "The main-line games as they came out. Two of them aren't in my library yet — a collection is a reading list, not an inventory.",
    accent: "#34d399",
    isPublic: true,
    titles: ["The Legend of Zelda: Ocarina of Time", "The Legend of Zelda: Breath of the Wild"],
    wanted: ["The Legend of Zelda: Majora's Mask", "The Legend of Zelda: Tears of the Kingdom"],
  },
  {
    name: "Souls-likes, easiest first",
    description: "The order I'd hand someone who has never played one and doesn't want to bounce off.",
    accent: "#fb7185",
    isPublic: true,
    titles: ["Hollow Knight", "Elden Ring"],
    wanted: ["Dark Souls: Remastered", "Sekiro: Shadows Die Twice"],
  },
  {
    name: "Couch co-op night",
    description: "Two controllers, one sofa, nobody has to read a wiki first.",
    accent: "#22d3ee",
    isPublic: false,
    titles: ["Portal 2", "Baldur's Gate 3", "Celeste"],
  },
  {
    name: "The N64 shelf",
    description: "Everything on the cartridge shelf, in the order I'd replay it.",
    accent: "#eab308",
    isPublic: false,
    titles: ["Super Mario 64", "The Legend of Zelda: Ocarina of Time", "GoldenEye 007"],
  },
];

/** Main-story lists, so the Progress tab has something real to show. */
const MISSION_LISTS: Array<{
  gameTitle: string;
  title: string;
  sequential: boolean;
  isPublic: boolean;
  /** [chapter, mission] pairs; chapter "" means unchaptered */
  missions: Array<[string, string]>;
  /** how many are ticked off, from the top */
  done: number;
}> = [
  {
    gameTitle: "Metal Gear Solid V: The Phantom Pain",
    title: "Main story",
    sequential: true,
    isPublic: true,
    done: 11,
    missions: [
      ["Prologue", "Awakening"],
      ["Chapter 1: Revenge", "Phantom Limbs"],
      ["Chapter 1: Revenge", "Diamond Dogs"],
      ["Chapter 1: Revenge", "A Hero's Way"],
      ["Chapter 1: Revenge", "C2W"],
      ["Chapter 1: Revenge", "Over the Fence"],
      ["Chapter 1: Revenge", "Where Do the Bees Sleep?"],
      ["Chapter 1: Revenge", "Red Brass"],
      ["Chapter 1: Revenge", "Occupation Forces"],
      ["Chapter 1: Revenge", "Backup, Back Down"],
      ["Chapter 1: Revenge", "Cloaked in Silence"],
      ["Chapter 1: Revenge", "Angel with Broken Wings"],
      ["Chapter 1: Revenge", "Pitch Dark"],
      ["Chapter 1: Revenge", "Lingua Franca"],
      ["Chapter 1: Revenge", "Close Contact"],
      ["Chapter 1: Revenge", "Traitors' Caravan"],
      ["Chapter 1: Revenge", "Hellbound"],
      ["Chapter 2: Race", "Sahelanthropus"],
      ["Chapter 2: Race", "Blood Runs Deep"],
      ["Chapter 2: Race", "On the Trail"],
    ],
  },
  {
    gameTitle: "Baldur's Gate 3",
    title: "Main story",
    sequential: true,
    isPublic: false,
    done: 7,
    missions: [
      ["Act 1", "Escape the Nautiloid"],
      ["Act 1", "Find a Cure"],
      ["Act 1", "Rescue the Grove"],
      ["Act 1", "The Blighted Village"],
      ["Act 1", "Goblin Camp"],
      ["Act 1", "The Underdark"],
      ["Act 1", "Grymforge"],
      ["Act 2", "The Shadow-Cursed Lands"],
      ["Act 2", "Last Light Inn"],
      ["Act 2", "Moonrise Towers"],
      ["Act 2", "The Gauntlet of Shar"],
      ["Act 3", "Rivington"],
      ["Act 3", "Wyrmway"],
      ["Act 3", "The House of Hope"],
      ["Act 3", "The Final Battle"],
    ],
  },
];

const EXTRA_LISTS: Array<{
  gameTitle: string;
  title: string;
  isPublic: boolean;
  entries: string[];
  done: number;
}> = [
  {
    gameTitle: "The Legend of Zelda: Breath of the Wild",
    title: "Divine Beasts & memories",
    isPublic: true,
    done: 5,
    entries: [
      "Vah Ruta",
      "Vah Rudania",
      "Vah Medoh",
      "Vah Naboris",
      "Memory 1 — Subdued Ceremony",
      "Memory 2 — Resolve and Grief",
      "Memory 3 — Zelda's Resentment",
      "Memory 4 — Blades of the Yiga",
      "Memory 5 — Silent Princess",
      "Master Sword",
    ],
  },
  {
    gameTitle: "Hades",
    title: "Escape attempts worth remembering",
    isPublic: false,
    done: 4,
    entries: [
      "First clear",
      "Clear with every weapon",
      "Extreme Measures 1-4",
      "Full relationship with Megaera",
      "32 Heat clear",
    ],
  },
];

// ---------------------------------------------------------------------------

async function findPlatformIds(): Promise<Map<string, string>> {
  const rows = await db
    .select({ id: schema.platforms.id, name: schema.platforms.name })
    .from(schema.platforms);
  return new Map(rows.map((r) => [r.name, r.id]));
}

/**
 * Resolve a title to a catalog game id.
 *
 * IGDB first (real cover, summary, release date, play times), falling back to
 * a bare row so the seed works on an instance with no credentials. Titles
 * already in the catalog are reused rather than duplicated — the demo shares
 * the catalog with everyone else, which is the whole point of it being one.
 */
async function resolveGame(
  title: string,
  useIgdb: boolean,
  log: (line: string) => void,
): Promise<string | null> {
  const [existing] = await db
    .select({ id: schema.games.id })
    .from(schema.games)
    .where(eq(schema.games.title, title))
    .limit(1);
  if (existing) return existing.id;

  if (useIgdb) {
    try {
      const results = await searchIgdb(title, 5);
      const hit =
        results?.find((r) => r.name.toLowerCase() === title.toLowerCase()) ?? results?.[0];
      if (hit) return await upsertGameFromIgdb(hit.id);
    } catch (err) {
      // one bad lookup shouldn't abandon the other twenty-three games
      log(`  ! IGDB lookup failed for "${title}": ${(err as Error).message}`);
    }
  }
  return createManualGame(title);
}

/** Deterministic id so re-seeding updates rather than duplicating. */
function demoId(key: string): string {
  return `demo-${key}`;
}

async function upsertDemoUser(
  id: string,
  email: string,
  name: string,
  friendCode: string | null,
): Promise<string> {
  await db
    .insert(schema.user)
    .values({
      id,
      email,
      name,
      emailVerified: true,
      role: "user",
      isDemo: true,
      friendCode,
    })
    .onConflictDoUpdate({
      target: schema.user.id,
      set: { name, email, isDemo: true, friendCode, updatedAt: new Date() },
    });
  return id;
}

/**
 * Everything the demo owns, removed.
 *
 * Cascades do most of the work — deleting `user_games` takes its platforms
 * and tags with it — so this only names the roots. The user rows themselves
 * survive so their ids stay stable across reseeds.
 */
async function clearDemoData(userIds: string[]): Promise<void> {
  await db.delete(schema.userGames).where(inArray(schema.userGames.userId, userIds));
  await db.delete(schema.collections).where(inArray(schema.collections.userId, userIds));
  await db
    .delete(schema.checklistTemplates)
    .where(inArray(schema.checklistTemplates.authorUserId, userIds));
  await db.delete(schema.tags).where(inArray(schema.tags.userId, userIds));
  await db.delete(schema.userConsoles).where(inArray(schema.userConsoles.userId, userIds));
  await db.delete(schema.friendships).where(inArray(schema.friendships.requesterId, userIds));
  await db.delete(schema.friendships).where(inArray(schema.friendships.addresseeId, userIds));
  await db
    .delete(schema.userTimeToBeat)
    .where(inArray(schema.userTimeToBeat.userId, userIds));
  // links point at catalog games, not at user_games, so clearing the library
  // above doesn't cascade to them — without these a rebuild would keep every
  // link an admin made while editing the demo
  await db.delete(schema.userGameLinks).where(inArray(schema.userGameLinks.userId, userIds));
  await db
    .delete(schema.userGameLinkSorts)
    .where(inArray(schema.userGameLinkSorts.userId, userIds));
}

async function runSeed(log: (line: string) => void) {
  const useIgdb = await igdbConfigured();
  log(
    useIgdb
      ? "IGDB is configured — the demo will have real cover art and play times."
      : "IGDB is not configured — seeding title-only games. Re-run this after adding credentials in Settings for a better-looking demo.",
  );

  const demoUserId = await upsertDemoUser(demoId("main"), DEMO_EMAIL, DEMO_NAME, "GM-DEMA-4242");
  const friendIds: string[] = [];
  for (const [i, friend] of FRIENDS.entries()) {
    friendIds.push(
      await upsertDemoUser(demoId(`friend-${i + 1}`), friend.email, friend.name, friend.code),
    );
  }

  log("Clearing previous demo data…");
  await clearDemoData([demoUserId, ...friendIds]);

  const platformIds = await findPlatformIds();
  const missing = new Set<string>();

  // ---- tags ----
  const tagIds = new Map<string, string>();
  for (const [name, meta] of Object.entries(TAG_COLORS)) {
    const [tag] = await db
      .insert(schema.tags)
      .values({ userId: demoUserId, name, color: meta.color, groupName: meta.group ?? null })
      .returning({ id: schema.tags.id });
    if (tag) tagIds.set(name, tag.id);
  }
  log(`Tags: ${tagIds.size}`);

  // ---- library ----
  const gameIds = new Map<string, string>();
  const consoleIds = new Set<string>();
  let added = 0;

  for (const entry of LIBRARY) {
    const gameId = await resolveGame(entry.title, useIgdb, log);
    if (!gameId) continue;
    gameIds.set(entry.title, gameId);

    const [row] = await db
      .insert(schema.userGames)
      .values({
        userId: demoUserId,
        gameId,
        status: entry.status,
        rating: entry.rating != null ? String(entry.rating) : null,
        notes: entry.notes ?? null,
        steamPlaytimeMinutes: entry.steamMinutes ?? null,
        completed100: entry.completed100 ?? false,
        // "Endless" games are excluded from backlog time — the preference
        // exists precisely for Stardew Valley and Slay the Spire
        ttbEnabled: !(entry.tags ?? []).includes("Endless"),
        finishedAt: entry.status === "finished" ? new Date() : null,
        startedAt: entry.status === "playing" ? new Date() : null,
      })
      .onConflictDoNothing()
      .returning({ id: schema.userGames.id });
    if (!row) continue;
    added++;

    for (const platform of entry.platforms) {
      const platformId = platformIds.get(platform.name);
      if (!platformId) {
        missing.add(platform.name);
        continue;
      }
      await db
        .insert(schema.userGamePlatforms)
        .values({ userGameId: row.id, platformId, format: platform.format })
        .onConflictDoNothing();
      consoleIds.add(platformId);
      // owning a storefront implies owning what it sells for
      const [parent] = await db
        .select({ parentId: schema.platforms.parentPlatformId })
        .from(schema.platforms)
        .where(eq(schema.platforms.id, platformId));
      if (parent?.parentId) consoleIds.add(parent.parentId);
    }

    for (const tagName of entry.tags ?? []) {
      const tagId = tagIds.get(tagName);
      if (tagId) {
        await db
          .insert(schema.userGameTags)
          .values({ userGameId: row.id, tagId })
          .onConflictDoNothing();
      }
    }
  }
  log(`Library: ${added} games`);
  if (missing.size > 0) {
    log(`  ! platforms not in the seed, skipped: ${[...missing].join(", ")}`);
  }

  // ---- consoles ----
  for (const platformId of consoleIds) {
    await db
      .insert(schema.userConsoles)
      .values({ userId: demoUserId, platformId })
      .onConflictDoNothing();
  }
  log(`Consoles: ${consoleIds.size}`);

  // ---- preferences ----
  await db
    .insert(schema.userPreferences)
    .values({
      userId: demoUserId,
      defaultStatus: "backlog",
      defaultPlatformId: platformIds.get("Steam") ?? null,
      defaultPlatformFormat: "digital",
    })
    .onConflictDoUpdate({
      target: schema.userPreferences.userId,
      set: { defaultPlatformId: platformIds.get("Steam") ?? null },
    });

  // ---- collections ----
  for (const collection of COLLECTIONS) {
    const [created] = await db
      .insert(schema.collections)
      .values({
        userId: demoUserId,
        name: collection.name,
        description: collection.description,
        accentColor: collection.accent,
        isPublic: collection.isPublic,
      })
      .returning({ id: schema.collections.id });
    if (!created) continue;

    // games you own, then the ones you don't — the second group is what makes
    // "not in your library" visible on the tour
    const titles = [...collection.titles, ...(collection.wanted ?? [])];
    const ids: string[] = [];
    for (const [i, title] of titles.entries()) {
      const gameId = gameIds.get(title) ?? (await resolveGame(title, useIgdb, log));
      if (!gameId) continue;
      ids.push(gameId);
      await db
        .insert(schema.collectionGames)
        .values({
          collectionId: created.id,
          gameId,
          // a readable left-to-right chain rather than a pile at the origin
          positionX: 40 + i * 150,
          positionY: 60 + (i % 2) * 90,
          sortOrder: i + 1,
        })
        .onConflictDoNothing();
    }
    // link each to the next so the play-order graph has edges to read
    for (let i = 0; i < ids.length - 1; i++) {
      await db.insert(schema.collectionLinks).values({
        collectionId: created.id,
        fromGameId: ids[i]!,
        toGameId: ids[i + 1]!,
      });
    }
  }
  log(`Collections: ${COLLECTIONS.length}`);

  // ---- lists ----
  let listCount = 0;
  let position = 1;
  for (const list of MISSION_LISTS) {
    const gameId = gameIds.get(list.gameTitle);
    if (!gameId) continue;
    const [tpl] = await db
      .insert(schema.checklistTemplates)
      .values({
        gameId,
        authorUserId: demoUserId,
        title: list.title,
        kind: MAIN_LIST_KIND,
        sequential: list.sequential,
        isPublic: list.isPublic,
        position: position++,
      })
      .returning({ id: schema.checklistTemplates.id });
    if (!tpl) continue;
    const items = await db
      .insert(schema.checklistItems)
      .values(
        list.missions.map(([chapter, text], i) => ({
          templateId: tpl.id,
          position: i,
          text,
          category: chapter || null,
        })),
      )
      .returning({ id: schema.checklistItems.id });
    // sequential lists imply everything before the furthest tick
    const done = items.slice(0, list.done);
    if (done.length > 0) {
      await db
        .insert(schema.userChecklistItems)
        .values(done.map((it) => ({ userId: demoUserId, itemId: it.id })))
        .onConflictDoNothing();
    }
    listCount++;
  }

  for (const list of EXTRA_LISTS) {
    const gameId = gameIds.get(list.gameTitle);
    if (!gameId) continue;
    const [tpl] = await db
      .insert(schema.checklistTemplates)
      .values({
        gameId,
        authorUserId: demoUserId,
        title: list.title,
        kind: EXTRA_LIST_KIND,
        isPublic: list.isPublic,
        position: position++,
      })
      .returning({ id: schema.checklistTemplates.id });
    if (!tpl) continue;
    const items = await db
      .insert(schema.checklistItems)
      .values(
        list.entries.map((text, i) => ({ templateId: tpl.id, position: i, text })),
      )
      .returning({ id: schema.checklistItems.id });
    const done = items.slice(0, list.done);
    if (done.length > 0) {
      await db
        .insert(schema.userChecklistItems)
        .values(done.map((it) => ({ userId: demoUserId, itemId: it.id })))
        .onConflictDoNothing();
    }
    listCount++;
  }
  log(`Lists: ${listCount}`);

  // ---- friends ----
  //
  // Small libraries of their own, overlapping the demo's on purpose: the
  // "in common" filter has nothing to show otherwise, and overlap is the
  // reason the friends feature exists.
  const friendLibraries: string[][] = [
    ["Elden Ring", "Hades", "Portal 2", "Outer Wilds", "Celeste"],
    ["Baldur's Gate 3", "Stardew Valley", "Hollow Knight", "Chrono Trigger"],
  ];
  for (const [i, friendId] of friendIds.entries()) {
    for (const title of friendLibraries[i] ?? []) {
      const gameId = gameIds.get(title);
      if (!gameId) continue;
      await db
        .insert(schema.userGames)
        .values({ userId: friendId, gameId, status: i === 0 ? "finished" : "playing" })
        .onConflictDoNothing();
    }
    await db
      .insert(schema.friendships)
      .values({
        requesterId: demoUserId,
        addresseeId: friendId,
        status: "accepted",
        respondedAt: new Date(),
      })
      .onConflictDoNothing();
  }
  log(`Friends: ${friendIds.length}`);

  clearDemoCache();
  log("Demo ready.");
}


// ---------------------------------------------------------------------------
// Public surface
//
// The seed is slow — two dozen IGDB lookups behind a ~3 req/s throttle — so
// the admin page can't wait on a request for it. It runs in the background
// and this module keeps the progress, which `GET /api/admin/demo` reports and
// the page polls. One run at a time: a second click while one is in flight is
// a no-op rather than two seeds racing to rebuild the same rows.
// ---------------------------------------------------------------------------

export interface DemoSeedState {
  running: boolean;
  startedAt: string | null;
  finishedAt: string | null;
  error: string | null;
  /** the same lines the CLI prints, newest last, capped */
  log: string[];
}

const MAX_LOG = 200;

let state: DemoSeedState = {
  running: false,
  startedAt: null,
  finishedAt: null,
  error: null,
  log: [],
};

export function demoSeedState(): DemoSeedState {
  return state;
}

/**
 * Rebuild the demo library. Resolves when the seed finishes; callers that
 * shouldn't block (the admin route) fire it and poll `demoSeedState()`.
 */
export async function seedDemo(): Promise<DemoSeedState> {
  if (state.running) return state;
  state = {
    running: true,
    startedAt: new Date().toISOString(),
    finishedAt: null,
    error: null,
    log: [],
  };
  try {
    await runSeed((line) => {
      state.log.push(line);
      if (state.log.length > MAX_LOG) state.log.shift();
    });
  } catch (err) {
    state.error = err instanceof Error ? err.message : "Seeding failed";
    state.log.push(`FAILED: ${state.error}`);
  } finally {
    state.running = false;
    state.finishedAt = new Date().toISOString();
  }
  return state;
}

/**
 * Delete the demo outright — accounts and all. Everything the demo owns
 * cascades off the user rows, so this is the one delete that needs naming.
 * After it, `/api/demo/status` answers false and `/demo` explains itself.
 */
export async function removeDemo(): Promise<number> {
  const removed = await db
    .delete(schema.user)
    .where(eq(schema.user.isDemo, true))
    .returning({ id: schema.user.id });
  clearDemoCache();
  return removed.length;
}

export interface DemoStats {
  exists: boolean;
  userId: string | null;
  name: string | null;
  games: number;
  collections: number;
  lists: number;
  tags: number;
  friends: number;
  consoles: number;
}

/** What the admin page shows above the rebuild button. */
export async function demoStats(): Promise<DemoStats> {
  const demo = await demoUser();
  if (!demo) {
    return {
      exists: false,
      userId: null,
      name: null,
      games: 0,
      collections: 0,
      lists: 0,
      tags: 0,
      friends: 0,
      consoles: 0,
    };
  }
  const one = async (table: PgTable, column: AnyPgColumn): Promise<number> => {
    const [row] = await db.select({ n: count() }).from(table).where(eq(column, demo.id));
    return row?.n ?? 0;
  };
  const [games, collections, lists, tags, consoles, friends] = await Promise.all([
    one(schema.userGames, schema.userGames.userId),
    one(schema.collections, schema.collections.userId),
    one(schema.checklistTemplates, schema.checklistTemplates.authorUserId),
    one(schema.tags, schema.tags.userId),
    one(schema.userConsoles, schema.userConsoles.userId),
    one(schema.friendships, schema.friendships.requesterId),
  ]);
  return {
    exists: true,
    userId: demo.id,
    name: demo.name,
    games,
    collections,
    lists,
    tags,
    friends,
    consoles,
  };
}
