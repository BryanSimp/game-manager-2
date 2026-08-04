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
 * Release year for an app, from the public storefront API (no key, not part
 * of the Web API). Used only to break ties between identically-named games —
 * "Deadlock" is a 1996 strategy game *and* a 2024 Valve shooter, and title
 * similarity alone can't tell them apart.
 *
 * Cached for the process lifetime; misses are cached too so a store page that
 * doesn't exist isn't re-requested on every import.
 */
const releaseYearCache = new Map<number, number | null>();

export async function getAppReleaseYear(appId: number): Promise<number | null> {
  const cached = releaseYearCache.get(appId);
  if (cached !== undefined) return cached;
  const year = await throttled(async () => {
    try {
      const res = await fetch(
        `https://store.steampowered.com/api/appdetails?appids=${appId}&filters=release_date`,
      );
      if (!res.ok) return null;
      const body = (await res.json()) as Record<
        string,
        { success?: boolean; data?: { release_date?: { date?: string } } }
      >;
      const date = body[String(appId)]?.data?.release_date?.date;
      const match = date?.match(/\b(\d{4})\b/);
      return match ? Number(match[1]) : null;
    } catch {
      return null; // the store API is best-effort; a miss just means no tiebreak
    }
  });
  releaseYearCache.set(appId, year);
  return year;
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
