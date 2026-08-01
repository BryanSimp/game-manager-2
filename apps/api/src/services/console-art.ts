import { getIgdbPlatformLogos, igdbLogoUrl } from "./igdb.js";

/**
 * Art candidates for a console, so picking a logo is browsing rather than
 * hunting for a file. Two sources, best first:
 *
 *  - IGDB, which has an official logo per platform and per hardware revision
 *    (Switch OLED, PS4 Pro…). Nothing for the PC storefronts — IGDB doesn't
 *    model them as platforms at all, which is exactly where custom art is
 *    most wanted.
 *  - Wikimedia Commons, whose files are freely licensed and cover the
 *    storefronts and everything else. Search quality varies, so it comes
 *    second and is clearly attributed.
 */

export interface ConsoleArtCandidate {
  id: string;
  /** what gets downloaded when picked */
  url: string;
  /** smaller version for the grid */
  thumbUrl: string;
  source: "igdb" | "wikimedia";
  /** revision name, or the Commons file title */
  label: string | null;
}

const COMMONS_API = "https://commons.wikimedia.org/w/api.php";
const TIMEOUT_MS = 10_000;

/**
 * Search terms for platforms whose name is an ordinary English word. Left to
 * itself, "Steam logo" returns locomotives and steam baths; the storefronts
 * need their company attached to mean anything.
 */
const ART_QUERIES: Record<string, string> = {
  Steam: "Steam Valve software logo",
  Origin: "Origin Electronic Arts software logo",
  "EA App": "Electronic Arts logo",
  GOG: "GOG.com logo",
  "Battle.net": "Battle.net Blizzard logo",
  "Epic Games Store": "Epic Games logo",
  "Ubisoft Connect": "Ubisoft logo",
  "Xbox / Microsoft Store": "Microsoft Store Xbox app logo",
  "itch.io": "itch.io logo",
  PC: "personal computer icon logo",
};

interface CommonsResponse {
  query?: {
    pages?: Record<
      string,
      {
        title?: string;
        imageinfo?: Array<{ url?: string; thumburl?: string; mime?: string }>;
      }
    >;
  };
}

/**
 * Freely-licensed logo files from Wikimedia Commons. Requests the rendered
 * thumbnail as well as the original: most logos there are SVG, and a raster
 * thumb is what we can actually store and display.
 */
async function searchCommons(query: string, limit: number): Promise<ConsoleArtCandidate[]> {
  const params = new URLSearchParams({
    action: "query",
    format: "json",
    origin: "*",
    generator: "search",
    gsrsearch: query,
    gsrnamespace: "6", // File:
    gsrlimit: String(limit),
    prop: "imageinfo",
    iiprop: "url|mime",
    iiurlwidth: "320",
  });
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    const res = await fetch(`${COMMONS_API}?${params}`, {
      headers: { "User-Agent": "GameManager2/0.1 (self-hosted library manager)" },
      signal: controller.signal,
    });
    if (!res.ok) return [];
    const body = (await res.json()) as CommonsResponse;
    const pages = Object.values(body.query?.pages ?? {});
    return pages.flatMap((page) => {
      const info = page.imageinfo?.[0];
      // PDFs and videos also live in the File: namespace
      if (!info?.thumburl || !info.mime?.startsWith("image/")) return [];
      return [
        {
          id: `commons:${page.title}`,
          // the rendered thumb, not the original: SVGs can't be stored as-is
          url: info.thumburl,
          thumbUrl: info.thumburl,
          source: "wikimedia" as const,
          label: page.title?.replace(/^File:/, "").replace(/\.[a-z]+$/i, "") ?? null,
        },
      ];
    });
  } catch {
    return [];
  } finally {
    clearTimeout(timer);
  }
}

/** Logo candidates for a platform, IGDB first then Commons. */
export async function searchConsoleArt(
  platformName: string,
  igdbPlatformId: number | null,
): Promise<ConsoleArtCandidate[]> {
  const candidates: ConsoleArtCandidate[] = [];

  if (igdbPlatformId) {
    for (const logo of await getIgdbPlatformLogos(igdbPlatformId)) {
      const url = igdbLogoUrl(logo.imageId);
      candidates.push({
        id: `igdb:${logo.imageId}`,
        url,
        thumbUrl: url,
        source: "igdb",
        label: logo.label,
      });
    }
  }

  const commons = await searchCommons(ART_QUERIES[platformName] ?? `${platformName} logo`, 20);
  // Commons search is a plain text search, so rank the plausible ones up:
  // a file actually called "<platform> logo" beats one that merely mentions it
  const needle = platformName.toLowerCase().split(/[\s/]+/)[0] ?? platformName.toLowerCase();
  const score = (c: ConsoleArtCandidate) => {
    const title = (c.label ?? "").toLowerCase();
    return (title.includes(needle) ? 2 : 0) + (title.includes("logo") ? 1 : 0);
  };
  candidates.push(...commons.sort((a, b) => score(b) - score(a)).slice(0, 12));

  // the same logo can arrive from both sources
  const seen = new Set<string>();
  return candidates.filter((c) => !seen.has(c.url) && seen.add(c.url));
}
