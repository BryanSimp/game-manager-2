import { ilike } from "drizzle-orm";
import { db, schema } from "../db/index.js";
import { igdbConfigured, igdbCoverUrl, searchIgdb } from "./igdb.js";
import { similarity } from "./noise-filter.js";

export interface MatchCandidate {
  igdbId: number | null;
  gameId: string | null;
  title: string;
  releaseYear: number | null;
  coverSrc: string | null;
}

export interface MatchResult {
  candidates: MatchCandidate[];
  confidence: number; // similarity of cleaned title vs top candidate
  /** the query that produced the best match — may differ from the input when a junk prefix was dropped */
  query: string;
}

/**
 * OCR'd icons often survive as a junk first token ("IB Aperture Desk Job",
 * "45 Blade & Sorcery"). When the direct match is weak, retry without the
 * first token and keep whichever result scores higher.
 */
function fallbackVariants(title: string): string[] {
  const variants: string[] = [];
  const tokens = title.split(/\s+/);
  if (tokens.length >= 2) {
    const first = tokens[0]!;
    const looksLikeJunk = first.length <= 3 || /[^A-Za-z']/.test(first);
    if (looksLikeJunk) variants.push(tokens.slice(1).join(" "));
  }
  // OCR regularly reads "l" as "i" ("Brawihalla" → "Brawlhalla",
  // "BattieBlock" → "BattleBlock"); guarded by the better-score check.
  if (/i/.test(title)) {
    variants.push(title.replace(/i/g, "l"));
    const withoutFirst = tokens.length >= 2 ? tokens.slice(1).join(" ") : null;
    if (withoutFirst && /i/.test(withoutFirst)) {
      variants.push(withoutFirst.replace(/i/g, "l"));
    }
  }
  return [...new Set(variants)].filter((v) => v.length > 2 && v !== title);
}

/** Find catalog/IGDB candidates for a cleaned title. Top match first. */
export async function matchTitle(cleanedTitle: string): Promise<MatchResult> {
  let best = await matchOnce(cleanedTitle);
  if (best.confidence < 0.8) {
    for (const variant of fallbackVariants(cleanedTitle)) {
      const alt = await matchOnce(variant);
      if (alt.confidence > best.confidence + 0.1) best = alt;
    }
  }
  return best;
}

async function matchOnce(cleanedTitle: string): Promise<MatchResult> {
  if (await igdbConfigured()) {
    const results = (await searchIgdb(cleanedTitle, 6)) ?? [];
    const candidates: MatchCandidate[] = results.map((g) => ({
      igdbId: g.id,
      gameId: null,
      title: g.name,
      releaseYear: g.first_release_date
        ? new Date(g.first_release_date * 1000).getFullYear()
        : null,
      coverSrc: g.cover ? igdbCoverUrl(g.cover.image_id) : null,
    }));
    // IGDB's own ranking is decent, but prefer near-exact title similarity
    candidates.sort(
      (a, b) => similarity(cleanedTitle, b.title) - similarity(cleanedTitle, a.title),
    );
    const top = candidates[0];
    return {
      candidates,
      confidence: top ? similarity(cleanedTitle, top.title) : 0,
      query: cleanedTitle,
    };
  }

  const local = await db
    .select()
    .from(schema.games)
    .where(ilike(schema.games.title, `%${cleanedTitle}%`))
    .limit(6);
  const candidates: MatchCandidate[] = local.map((g) => ({
    igdbId: g.igdbId,
    gameId: g.id,
    title: g.title,
    releaseYear: g.releaseDate ? Number(g.releaseDate.slice(0, 4)) : null,
    coverSrc: g.coverImageId ? `/api/images/${g.coverImageId}` : g.coverUrl,
  }));
  const top = candidates[0];
  return {
    candidates,
    confidence: top ? similarity(cleanedTitle, top.title) : 0,
    query: cleanedTitle,
  };
}
