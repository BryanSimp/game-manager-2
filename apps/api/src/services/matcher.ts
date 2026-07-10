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
}

/** Find catalog/IGDB candidates for a cleaned title. Top match first. */
export async function matchTitle(cleanedTitle: string): Promise<MatchResult> {
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
  };
}
