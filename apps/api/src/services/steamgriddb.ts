import { getSetting } from "./settings.js";

/**
 * SteamGridDB — community-uploaded box art, keyed by game.
 *
 * IGDB gives one official cover per game; this is where alternates live
 * (regional box art, fan-made, clean logos). Read-only and key-gated: the
 * admin pastes a free key into Settings, DB-first with an env fallback, same
 * pattern as IGDB and Steam.
 */

const BASE = "https://www.steamgriddb.com/api/v2";
const TIMEOUT_MS = 10_000;

export interface CoverCandidate {
  id: number;
  /** full-size image */
  url: string;
  /** small preview, cheaper to render in a grid */
  thumbUrl: string;
  width: number;
  height: number;
  /** uploader-declared style, e.g. "alternate", "official" */
  style: string | null;
  author: string | null;
}

export async function getSteamGridDbKey(): Promise<string | null> {
  return (await getSetting("steamgriddb_api_key")) || process.env.STEAMGRIDDB_API_KEY || null;
}

async function sgdb<T>(path: string, key: string): Promise<T | null> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    const res = await fetch(`${BASE}${path}`, {
      headers: { Authorization: `Bearer ${key}`, Accept: "application/json" },
      signal: controller.signal,
    });
    if (!res.ok) return null;
    const body = (await res.json()) as { success?: boolean; data?: T };
    if (!body?.success) return null;
    return body.data ?? null;
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

interface SgdbGame {
  id: number;
  name: string;
}

interface SgdbGrid {
  id: number;
  url: string;
  thumb: string;
  width: number;
  height: number;
  style?: string;
  author?: { name?: string };
}

/** Resolve a title to a SteamGridDB game id. */
async function findGameId(
  title: string,
  steamAppId: number | null,
  key: string,
): Promise<number | null> {
  // a Steam appid is an exact match; searching by name is a guess
  if (steamAppId) {
    const byApp = await sgdb<SgdbGame | SgdbGame[]>(`/games/steam/${steamAppId}`, key);
    const game = Array.isArray(byApp) ? byApp[0] : byApp;
    if (game?.id) return game.id;
  }
  const results = await sgdb<SgdbGame[]>(`/search/autocomplete/${encodeURIComponent(title)}`, key);
  return results?.[0]?.id ?? null;
}

/**
 * Candidate covers for a game. Filtered to portrait box art — SteamGridDB
 * also hosts wide "hero" banners, which are the wrong shape for a cover slot.
 */
export async function searchCovers(
  title: string,
  steamAppId: number | null = null,
): Promise<CoverCandidate[]> {
  const key = await getSteamGridDbKey();
  if (!key) return [];

  const gameId = await findGameId(title, steamAppId, key);
  if (!gameId) return [];

  const grids = await sgdb<SgdbGrid[]>(
    // 600x900 is the standard portrait box-art ratio on the service
    `/grids/game/${gameId}?dimensions=600x900,342x482,660x930&types=static&limit=50`,
    key,
  );
  if (!grids) return [];

  return grids
    .filter((g) => g.height > g.width) // portrait only
    .map((g) => ({
      id: g.id,
      url: g.url,
      thumbUrl: g.thumb || g.url,
      width: g.width,
      height: g.height,
      style: g.style ?? null,
      author: g.author?.name ?? null,
    }));
}
