import { getIgdbCredentials } from "./settings.js";

/**
 * IGDB client.
 *
 * COMPLIANCE: IGDB data is used under the Twitch Developer Services Agreement
 * and the IGDB API Terms of Use (https://api-docs.igdb.com). Requests are
 * server-side only and throttled below IGDB's published 4 req/s limit; data
 * is cached into the local catalog for display in this app and must not be
 * resold or redistributed as a dataset. The attribution the terms call for
 * ("game metadata and covers provided by IGDB") is rendered in the site
 * footer: apps/web/src/components/Footer.tsx.
 */

export interface IgdbGame {
  id: number;
  name: string;
  summary?: string;
  first_release_date?: number; // unix seconds
  cover?: { id: number; image_id: string };
  genres?: Array<{ id: number; name: string }>;
  platforms?: Array<{ id: number; name: string }>;
}

export interface IgdbPlatform {
  id: number;
  name: string;
  summary?: string;
  platform_logo?: { id: number; image_id: string };
}

export interface IgdbTimeToBeat {
  game_id: number;
  hastily?: number; // seconds
  normally?: number;
  completely?: number;
}

let cachedToken: { token: string; expiresAt: number; clientId: string } | null = null;

async function getToken(): Promise<{ token: string; clientId: string } | null> {
  const creds = await getIgdbCredentials();
  if (!creds) return null;
  if (
    cachedToken &&
    cachedToken.clientId === creds.clientId &&
    cachedToken.expiresAt > Date.now() + 60_000
  ) {
    return { token: cachedToken.token, clientId: creds.clientId };
  }
  const res = await fetch(
    `https://id.twitch.tv/oauth2/token?client_id=${encodeURIComponent(creds.clientId)}&client_secret=${encodeURIComponent(creds.clientSecret)}&grant_type=client_credentials`,
    { method: "POST" },
  );
  if (!res.ok) {
    throw new Error(`Twitch OAuth failed (${res.status}) — check IGDB credentials`);
  }
  const data = (await res.json()) as { access_token: string; expires_in: number };
  cachedToken = {
    token: data.access_token,
    expiresAt: Date.now() + data.expires_in * 1000,
    clientId: creds.clientId,
  };
  return { token: data.access_token, clientId: creds.clientId };
}

/** Serialize IGDB calls with ~300ms spacing to stay under the 4 req/s cap. */
let queue: Promise<unknown> = Promise.resolve();
function throttled<T>(fn: () => Promise<T>): Promise<T> {
  const run = queue.then(fn);
  queue = run.then(
    () => new Promise((r) => setTimeout(r, 300)),
    () => new Promise((r) => setTimeout(r, 300)),
  );
  return run;
}

async function igdbRequest<T>(endpoint: string, body: string): Promise<T[] | null> {
  const auth = await getToken();
  if (!auth) return null; // IGDB not configured
  return throttled(async () => {
    const res = await fetch(`https://api.igdb.com/v4/${endpoint}`, {
      method: "POST",
      headers: {
        "Client-ID": auth.clientId,
        Authorization: `Bearer ${auth.token}`,
        Accept: "application/json",
      },
      body,
    });
    if (!res.ok) {
      throw new Error(`IGDB ${endpoint} failed (${res.status}): ${await res.text()}`);
    }
    return (await res.json()) as T[];
  });
}

export async function igdbConfigured(): Promise<boolean> {
  return (await getIgdbCredentials()) !== null;
}

/** Verify the stored credentials actually work. */
export async function igdbTest(): Promise<void> {
  cachedToken = null; // force a fresh token with current creds
  const auth = await getToken();
  if (!auth) throw new Error("IGDB credentials are not set");
  await igdbRequest<{ id: number }>("games", "fields id; limit 1;");
}

const GAME_FIELDS =
  "fields name, summary, first_release_date, cover.image_id, genres.name, platforms.name; ";

export async function searchIgdb(
  query: string,
  limit = 20,
  /** narrow to games first released in this calendar year */
  year?: number | null,
): Promise<IgdbGame[] | null> {
  const sanitized = query.replace(/["\\]/g, " ").trim();
  if (!sanitized) return [];
  let where = "where version_parent = null";
  if (year) {
    // IGDB dates are unix seconds; bracket the year in UTC
    const from = Math.floor(Date.UTC(year, 0, 1) / 1000);
    const to = Math.floor(Date.UTC(year + 1, 0, 1) / 1000);
    where += ` & first_release_date >= ${from} & first_release_date < ${to}`;
  }
  return igdbRequest<IgdbGame>(
    "games",
    `search "${sanitized}"; ${GAME_FIELDS} ${where}; limit ${limit};`,
  );
}

/** IGDB's id for the Steam storefront in `external_game_sources`. */
const IGDB_STEAM_SOURCE = 1;

/**
 * The IGDB game a Steam appid belongs to, from IGDB's own external-id table.
 * This is an exact answer where matching by title is a guess: two games
 * called "Deadlock" have one appid each, and only this says which is which.
 *
 * Note the field is `external_game_source`, not the older `category` — that
 * one still exists on the endpoint but no longer matches anything.
 */
export async function findIgdbGameBySteamAppId(appId: number): Promise<number | null> {
  try {
    const rows = await igdbRequest<{ id: number; game?: number | { id: number } }>(
      "external_games",
      `fields game, uid; where external_game_source = ${IGDB_STEAM_SOURCE} & uid = "${appId}"; limit 1;`,
    );
    const game = rows?.[0]?.game;
    if (typeof game === "number") return game;
    return game?.id ?? null;
  } catch {
    return null; // fall back to matching by name
  }
}

/**
 * Every logo IGDB has for a platform: the platform's own, plus one per
 * hardware revision (Switch OLED, PS4 Pro…), so the art picker has more than
 * a single option to offer.
 */
export async function getIgdbPlatformLogos(
  igdbPlatformId: number,
): Promise<Array<{ imageId: string; label: string | null }>> {
  try {
    const rows = await igdbRequest<{
      id: number;
      name: string;
      platform_logo?: { image_id: string };
      versions?: Array<{ name?: string; platform_logo?: { image_id: string } }>;
    }>(
      "platforms",
      `fields name, platform_logo.image_id, versions.name, versions.platform_logo.image_id;
       where id = ${igdbPlatformId}; limit 1;`,
    );
    const platform = rows?.[0];
    if (!platform) return [];
    const logos: Array<{ imageId: string; label: string | null }> = [];
    if (platform.platform_logo) {
      logos.push({ imageId: platform.platform_logo.image_id, label: platform.name });
    }
    for (const version of platform.versions ?? []) {
      if (version.platform_logo) {
        logos.push({ imageId: version.platform_logo.image_id, label: version.name ?? null });
      }
    }
    // IGDB repeats the base logo as a version logo more often than not
    const seen = new Set<string>();
    return logos.filter((l) => !seen.has(l.imageId) && seen.add(l.imageId));
  } catch {
    return [];
  }
}

/** Platform metadata for the consoles page — logo, and a summary if IGDB has one. */
export async function getIgdbPlatform(igdbPlatformId: number): Promise<IgdbPlatform | null> {
  try {
    const rows = await igdbRequest<IgdbPlatform>(
      "platforms",
      `fields name, summary, platform_logo.image_id; where id = ${igdbPlatformId}; limit 1;`,
    );
    return rows?.[0] ?? null;
  } catch {
    return null; // console art is decoration, never worth failing a request over
  }
}

export async function getIgdbGame(igdbId: number): Promise<IgdbGame | null> {
  const rows = await igdbRequest<IgdbGame>(
    "games",
    `${GAME_FIELDS} where id = ${igdbId}; limit 1;`,
  );
  return rows?.[0] ?? null;
}

/** Best-effort community time-to-beat data (seconds). */
export async function getIgdbTimeToBeat(igdbId: number): Promise<IgdbTimeToBeat | null> {
  try {
    const rows = await igdbRequest<IgdbTimeToBeat>(
      "game_time_to_beats",
      `fields game_id, hastily, normally, completely; where game_id = ${igdbId}; limit 1;`,
    );
    return rows?.[0] ?? null;
  } catch {
    return null; // missing TTB should never block adding a game
  }
}

export function igdbCoverUrl(imageId: string, size: "cover_big" | "720p" = "cover_big"): string {
  return `https://images.igdb.com/igdb/image/upload/t_${size}_2x/${imageId}.jpg`;
}

/** Platform logos are PNGs with transparency — png, not jpg. */
export function igdbLogoUrl(imageId: string): string {
  return `https://images.igdb.com/igdb/image/upload/t_logo_med/${imageId}.png`;
}
