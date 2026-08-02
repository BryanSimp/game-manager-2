import { db } from "../db/index.js";
import { matchTitle, type MatchCandidate, type MatchResult } from "./matcher.js";
import { cleanProductTitle } from "./product-title.js";

/**
 * UPC barcode → game candidates.
 *
 * UPCitemdb's free trial tier (no key, ~100 req/day per IP) resolves the
 * barcode to a retail product title like
 * "The Legend of Zelda: Tears of the Kingdom - Nintendo Switch".
 * `product-title.ts` strips the platform mention (which doubles as the
 * platform hint) and the rest of the shelf noise, then the OCR matcher finds
 * IGDB/catalog candidates.
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

interface UpcProduct {
  title: string;
  /** the database's own brand field — usually the publisher */
  brand: string | null;
}

// the trial tier is ~100 lookups/day — remember every code we've resolved
const cache = new Map<string, UpcLookupResult>();

async function fetchProduct(code: string): Promise<UpcProduct | null> {
  const res = await fetch(
    `https://api.upcitemdb.com/prod/trial/lookup?upc=${encodeURIComponent(code)}`,
    { headers: { Accept: "application/json" } },
  );
  if (res.status === 404) return null; // unknown barcode
  if (res.status === 400) return null; // UPCitemdb rejects malformed codes with 400
  if (res.status === 429) throw new Error("UPC lookup rate limit reached — try again later");
  if (!res.ok) throw new Error(`UPC lookup failed (${res.status})`);
  const data = (await res.json()) as UpcItemDbResponse;
  const item = data.items?.find((i) => i.title?.trim());
  if (!item?.title) return null;
  return { title: item.title.trim(), brand: item.brand?.trim() || null };
}

export async function lookupUpc(code: string): Promise<UpcLookupResult> {
  const cached = cache.get(code);
  if (cached) return cached;

  const product = await fetchProduct(code);
  if (!product) {
    // don't cache misses forever — the DB may learn the code later
    return {
      found: false,
      product: null,
      query: null,
      platformHint: null,
      candidates: [],
      confidence: 0,
    };
  }

  const { cleaned, variants, platformName } = cleanProductTitle(product.title, product.brand);

  // Dropping the publisher is a guess ("Nintendo Land" is a game), so try it
  // and keep it only when the catalog agrees it's a better title. Same rule
  // the OCR matcher uses for junk first tokens.
  let best: MatchResult = await matchTitle(cleaned || product.title);
  if (best.confidence < 0.9) {
    for (const variant of variants) {
      const alt = await matchTitle(variant);
      if (alt.confidence > best.confidence + 0.05) best = alt;
    }
  }

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
    product: product.title,
    query: best.query,
    platformHint,
    candidates: best.candidates,
    confidence: best.confidence,
  };
  cache.set(code, result);
  return result;
}
