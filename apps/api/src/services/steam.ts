import { getSetting } from "./settings.js";

/**
 * Official Steam Web API (requires the user's game details to be public).
 * Key resolves DB settings first, env fallback — same pattern as IGDB.
 *
 * COMPLIANCE: used under the Steam Web API Terms of Use
 * (https://steamcommunity.com/dev/apiterms) — throttled well below the
 * 100k calls/day cap, and only ever fetching data for the account the user
 * linked themselves. The required "Powered by Steam" attribution (and the
 * no-endorsement-by-Valve disclaimer) is rendered in the site footer:
 * apps/web/src/components/Footer.tsx.
 */

const API = "https://api.steampowered.com";

export interface SteamOwnedGame {
  appid: number;
  name: string;
  playtime_forever: number; // minutes
}

export interface SteamSchemaAchievement {
  name: string; // apiname
  displayName: string;
  description?: string;
  icon: string;
  icongray: string;
  hidden: number;
}

export interface SteamPlayerAchievement {
  apiname: string;
  achieved: number;
  unlocktime: number; // unix seconds, 0 when locked
}

export async function getSteamApiKey(): Promise<string | null> {
  const key = (await getSetting("steam_api_key")) || process.env.STEAM_API_KEY || "";
  return key || null;
}

export async function steamConfigured(): Promise<boolean> {
  return (await getSteamApiKey()) !== null;
}

/** Gentle serialization — Steam allows 100k/day but bursts get throttled. */
let queue: Promise<unknown> = Promise.resolve();
function throttled<T>(fn: () => Promise<T>): Promise<T> {
  const run = queue.then(fn);
  queue = run.then(
    () => new Promise((r) => setTimeout(r, 250)),
    () => new Promise((r) => setTimeout(r, 250)),
  );
  return run;
}

async function steamGet<T>(path: string, params: Record<string, string>): Promise<T> {
  const key = await getSteamApiKey();
  if (!key) throw new Error("Steam API key is not configured");
  const qs = new URLSearchParams({ key, ...params });
  return throttled(async () => {
    const res = await fetch(`${API}${path}?${qs}`);
    if (res.status === 403) {
      throw new Error("Steam rejected the request (403) — check the API key and that the profile is public");
    }
    if (!res.ok) throw new Error(`Steam API ${path} failed (${res.status})`);
    return (await res.json()) as T;
  });
}

/** "gabelogannewell" → SteamID64, or null if the vanity name is unknown. */
export async function resolveVanityUrl(vanity: string): Promise<string | null> {
  const data = await steamGet<{ response: { success: number; steamid?: string } }>(
    "/ISteamUser/ResolveVanityURL/v1/",
    { vanityurl: vanity },
  );
  return data.response.success === 1 ? (data.response.steamid ?? null) : null;
}

export async function getPersonaName(steamId: string): Promise<string | null> {
  const data = await steamGet<{
    response: { players: Array<{ personaname?: string }> };
  }>("/ISteamUser/GetPlayerSummaries/v2/", { steamids: steamId });
  return data.response.players[0]?.personaname ?? null;
}

export async function getOwnedGames(steamId: string): Promise<SteamOwnedGame[]> {
  const data = await steamGet<{
    response: { game_count?: number; games?: SteamOwnedGame[] };
  }>("/IPlayerService/GetOwnedGames/v1/", {
    steamid: steamId,
    include_appinfo: "1",
    include_played_free_games: "1",
  });
  const games = data.response.games ?? [];
  if (games.length === 0 && data.response.game_count === undefined) {
    throw new Error(
      "Steam returned no games — the profile's Game Details privacy setting must be Public",
    );
  }
  return games;
}

/**
 * An app's name and release year, from the public storefront API (no key,
 * not part of the Web API). Two readers: the import's release-year tiebreak
 * and a search by app id that nothing else could resolve.
 *
 * Cached for the process lifetime, and an app the store says doesn't exist is
 * cached too, so it isn't re-requested on every import. A failed *request* is
 * not cached — a 429 now shouldn't hide the app until the next restart.
 */
interface StoreApp {
  name: string | null;
  releaseYear: number | null;
}
const STORE_CACHE_MAX = 5000;
const storeAppCache = new Map<number, StoreApp | null>();

async function getStoreApp(appId: number): Promise<StoreApp | null> {
  const cached = storeAppCache.get(appId);
  if (cached !== undefined) return cached;
  const result = await throttled(async () => {
    try {
      const res = await fetch(
        `https://store.steampowered.com/api/appdetails?appids=${appId}&filters=basic,release_date`,
      );
      if (!res.ok) return undefined;
      const body = (await res.json()) as Record<
        string,
        { success?: boolean; data?: { name?: string; release_date?: { date?: string } } }
      >;
      const data = body[String(appId)]?.data;
      if (!data) return null; // `success: false` — no such app
      const match = data.release_date?.date?.match(/\b(\d{4})\b/);
      return { name: data.name?.trim() || null, releaseYear: match ? Number(match[1]) : null };
    } catch {
      return undefined; // the store API is best-effort
    }
  });
  if (result === undefined) return null;
  // searches can ask about any number at all, so the cache can't grow forever
  if (storeAppCache.size >= STORE_CACHE_MAX) storeAppCache.clear();
  storeAppCache.set(appId, result);
  return result;
}

/**
 * Release year for an app. Used only to break ties between identically-named
 * games — "Deadlock" is a 1996 strategy game *and* a 2024 Valve shooter, and
 * title similarity alone can't tell them apart.
 */
export async function getAppReleaseYear(appId: number): Promise<number | null> {
  return (await getStoreApp(appId))?.releaseYear ?? null;
}

/**
 * The storefront API allows roughly 200 requests per five minutes per IP, and
 * every user of this server shares that one IP. Imports cap their own use per
 * run; a search is whatever anyone types, so it draws on a budget well under
 * the limit instead — an exhausted budget only costs the name fallback.
 */
const SEARCH_BUDGET = { max: 60, windowMs: 5 * 60_000 };
const searchLookups: number[] = [];

function takeSearchBudget(): boolean {
  const now = Date.now();
  while (searchLookups.length > 0 && searchLookups[0]! <= now - SEARCH_BUDGET.windowMs) {
    searchLookups.shift();
  }
  if (searchLookups.length >= SEARCH_BUDGET.max) return false;
  searchLookups.push(now);
  return true;
}

/** Steam's name for an app, for a search by app id; null when unknown. */
export async function getStoreAppName(appId: number): Promise<string | null> {
  if (!storeAppCache.has(appId) && !takeSearchBudget()) return null;
  return (await getStoreApp(appId))?.name ?? null;
}

/** Achievement definitions for a game; empty when the game has none. */
export async function getSchemaAchievements(appId: number): Promise<SteamSchemaAchievement[]> {
  const data = await steamGet<{
    game?: { availableGameStats?: { achievements?: SteamSchemaAchievement[] } };
  }>("/ISteamUserStats/GetSchemaForGame/v2/", { appid: String(appId) });
  return data.game?.availableGameStats?.achievements ?? [];
}

/** Player unlock state; null when the game has no stats or they're private. */
export async function getPlayerAchievements(
  steamId: string,
  appId: number,
): Promise<SteamPlayerAchievement[] | null> {
  try {
    const data = await steamGet<{
      playerstats: { success: boolean; achievements?: SteamPlayerAchievement[] };
    }>("/ISteamUserStats/GetPlayerAchievements/v1/", {
      steamid: steamId,
      appid: String(appId),
    });
    return data.playerstats.achievements ?? null;
  } catch {
    // Steam 400s for games without stats — treat as "no achievements"
    return null;
  }
}
