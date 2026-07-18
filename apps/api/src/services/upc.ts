import { db, schema } from "../db/index.js";
import { matchTitle, type MatchCandidate } from "./matcher.js";

/**
 * UPC barcode → game candidates.
 *
 * UPCitemdb's free trial tier (no key, ~100 req/day per IP) resolves the
 * barcode to a retail product title like
 * "The Legend of Zelda: Tears of the Kingdom - Nintendo Switch".
 * We strip the platform mention (which doubles as the platform hint),
 * then reuse the OCR matcher for IGDB/catalog candidates.
 */

export interface UpcLookupResult {
  found: boolean;
  /** raw product title from the UPC database, when found */
  product: string | null;
  /** cleaned title used for game matching */
  query: string | null;
  platformHint: {
    id: string;
    name: string;
    abbreviation: string | null;
  } | null;
  candidates: MatchCandidate[];
  confidence: number;
}

interface UpcItemDbResponse {
  code: string;
  items?: Array<{ title?: string; brand?: string; category?: string }>;
}

/**
 * Product-title substrings → seeded platform name. Longest alias wins, so
 * "wii u" must be tried before "wii", "xbox 360" before "xbox", etc. —
 * the list is sorted by alias length at match time.
 */
const PLATFORM_ALIASES: Array<{ alias: string; platform: string }> = [
  { alias: "nintendo switch 2", platform: "Nintendo Switch 2" },
  { alias: "switch 2", platform: "Nintendo Switch 2" },
  { alias: "nintendo switch", platform: "Nintendo Switch" },
  { alias: "switch", platform: "Nintendo Switch" },
  { alias: "wii u", platform: "Wii U" },
  { alias: "wii", platform: "Wii" },
  { alias: "gamecube", platform: "GameCube" },
  { alias: "nintendo 64", platform: "Nintendo 64" },
  { alias: "n64", platform: "Nintendo 64" },
  { alias: "super nintendo", platform: "Super Nintendo" },
  { alias: "snes", platform: "Super Nintendo" },
  { alias: "nes", platform: "NES" },
  { alias: "game boy advance", platform: "Game Boy Advance" },
  { alias: "gba", platform: "Game Boy Advance" },
  { alias: "game boy color", platform: "Game Boy Color" },
  { alias: "gbc", platform: "Game Boy Color" },
  { alias: "game boy", platform: "Game Boy" },
  { alias: "nintendo 3ds", platform: "Nintendo 3DS" },
  { alias: "3ds", platform: "Nintendo 3DS" },
  { alias: "nintendo ds", platform: "Nintendo DS" },
  { alias: "playstation 5", platform: "PlayStation 5" },
  { alias: "ps5", platform: "PlayStation 5" },
  { alias: "playstation 4", platform: "PlayStation 4" },
  { alias: "ps4", platform: "PlayStation 4" },
  { alias: "playstation 3", platform: "PlayStation 3" },
  { alias: "ps3", platform: "PlayStation 3" },
  { alias: "playstation 2", platform: "PlayStation 2" },
  { alias: "ps2", platform: "PlayStation 2" },
  { alias: "playstation vita", platform: "PS Vita" },
  { alias: "ps vita", platform: "PS Vita" },
  { alias: "psp", platform: "PSP" },
  { alias: "playstation", platform: "PlayStation" },
  { alias: "ps1", platform: "PlayStation" },
  { alias: "psx", platform: "PlayStation" },
  { alias: "xbox series x|s", platform: "Xbox Series X|S" },
  { alias: "xbox series x", platform: "Xbox Series X|S" },
  { alias: "xbox series s", platform: "Xbox Series X|S" },
  { alias: "xbox 360", platform: "Xbox 360" },
  { alias: "xbox one", platform: "Xbox One" },
  { alias: "xbox", platform: "Xbox" },
  { alias: "sega genesis", platform: "Sega Genesis" },
  { alias: "mega drive", platform: "Sega Genesis" },
  { alias: "sega saturn", platform: "Sega Saturn" },
  { alias: "dreamcast", platform: "Sega Dreamcast" },
  { alias: "game gear", platform: "Sega Game Gear" },
  { alias: "master system", platform: "Sega Master System" },
  { alias: "windows", platform: "PC" },
  { alias: "pc dvd", platform: "PC" },
  { alias: "pc game", platform: "PC" },
].sort((a, b) => b.alias.length - a.alias.length);

/** Retail listing noise that isn't part of the game's title. */
const NOISE_PATTERNS: RegExp[] = [
  /\((renewed|refurbished|pre-?owned|used|new|sealed|import|us|uk|eu|ntsc|pal)\)/gi,
  /\b(standard|day one|launch) edition\b/gi,
  /\bvideo game\b/gi,
  /\b(brand new|factory sealed|complete in box|cib)\b/gi,
];

function escapeRegExp(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/** Strip platform mentions + listing noise from a retail product title. */
export function cleanProductTitle(product: string): {
  cleaned: string;
  platformName: string | null;
} {
  let title = product;
  let platformName: string | null = null;

  for (const { alias, platform } of PLATFORM_ALIASES) {
    // match "- Nintendo Switch", "(PS5)", "for Xbox One", "[PS4]" …
    const re = new RegExp(
      `[\\s\\-–—:,(\\[]*(for\\s+)?${escapeRegExp(alias)}[\\s)\\]]*`,
      "i",
    );
    if (re.test(title)) {
      platformName ??= platform;
      title = title.replace(re, " ");
    }
  }
  for (const re of NOISE_PATTERNS) title = title.replace(re, " ");

  const cleaned = title
    .replace(/\s+/g, " ")
    .replace(/[\s\-–—:,/]+$/g, "")
    .replace(/^[\s\-–—:,/]+/g, "")
    .trim();
  return { cleaned, platformName };
}

// the trial tier is ~100 lookups/day — remember every code we've resolved
const cache = new Map<string, UpcLookupResult>();

async function fetchProductTitle(code: string): Promise<string | null> {
  const res = await fetch(
    `https://api.upcitemdb.com/prod/trial/lookup?upc=${encodeURIComponent(code)}`,
    { headers: { Accept: "application/json" } },
  );
  if (res.status === 404) return null; // unknown barcode
  if (res.status === 400) return null; // UPCitemdb rejects malformed codes with 400
  if (res.status === 429) throw new Error("UPC lookup rate limit reached — try again later");
  if (!res.ok) throw new Error(`UPC lookup failed (${res.status})`);
  const data = (await res.json()) as UpcItemDbResponse;
  const title = data.items?.find((i) => i.title?.trim())?.title?.trim();
  return title ?? null;
}

export async function lookupUpc(code: string): Promise<UpcLookupResult> {
  const cached = cache.get(code);
  if (cached) return cached;

  const product = await fetchProductTitle(code);
  if (!product) {
    // don't cache misses forever — the DB may learn the code later
    return { found: false, product: null, query: null, platformHint: null, candidates: [], confidence: 0 };
  }

  const { cleaned, platformName } = cleanProductTitle(product);
  const query = cleaned || product;
  const match = await matchTitle(query);

  let platformHint: UpcLookupResult["platformHint"] = null;
  if (platformName) {
    const row = await db.query.platforms.findFirst({
      where: (p, { eq }) => eq(p.name, platformName),
    });
    if (row) {
      platformHint = { id: row.id, name: row.name, abbreviation: row.abbreviation };
    }
  }

  const result: UpcLookupResult = {
    found: true,
    product,
    query: match.query,
    platformHint,
    candidates: match.candidates,
    confidence: match.confidence,
  };
  cache.set(code, result);
  return result;
}
