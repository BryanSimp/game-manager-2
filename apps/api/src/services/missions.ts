import type { MissionSourceCandidate, MissionSuggestion } from "@gm/shared";

/**
 * Mission/chapter lists scraped from Fandom wikis.
 *
 * No games API publishes mission counts — IGDB has none, HowLongToBeat only
 * aggregates times — so the list has to come off a wiki. Fandom wikis run
 * MediaWiki and expose the documented read-only `api.php`, which we use
 * instead of parsing rendered HTML: it's stable across skin changes and it's
 * the access path Fandom actually sanctions. Their text is CC-BY-SA, so every
 * imported list keeps a `sourceUrl` for attribution.
 *
 * Extraction is unavoidably heuristic (no two wikis lay a page out the same
 * way), so a suggestion is *never* written straight to the database — routes
 * hand it back for the user to review, matching how OCR import works.
 */

// MediaWiki etiquette: identify the client and give operators a contact point.
const USER_AGENT =
  "GameManager2/1.0 (self-hosted game library; +https://github.com/BryanSimp/game-manager-2)";

const FETCH_TIMEOUT_MS = 10_000;

/** Section headings that tend to hold the ordered story beats. */
const MISSION_SECTION_RE =
  /\b(main\s+)?(missions?|chapters?|episodes?|story\s+missions?|main\s+quests?|levels?|acts?|campaign|walkthrough)\b/i;

/** Headings that look right but hold the wrong list. */
const SECTION_DENYLIST_RE =
  /\b(side|optional|extra|dlc|multiplayer|trivia|gallery|references?|external|cast|characters?|weapons?|achievements?|trophies)\b/i;

/** Rows that survive list parsing but clearly aren't missions. */
const ITEM_DENYLIST_RE =
  /^(see also|references?|notes?|gallery|trivia|contents?|categor(y|ies)|external links?|navigation|edit)\b/i;

// One in-flight request at a time, with a small gap — we are a guest on
// someone else's wiki and there is no rate-limit header to react to.
let chain: Promise<unknown> = Promise.resolve();
function throttled<T>(fn: () => Promise<T>): Promise<T> {
  const next = chain.then(async () => {
    const result = await fn();
    await new Promise((r) => setTimeout(r, 250));
    return result;
  });
  chain = next.catch(() => undefined);
  return next as Promise<T>;
}

async function getJson<T>(url: string): Promise<T | null> {
  return throttled(async () => {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
    try {
      const res = await fetch(url, {
        headers: { Accept: "application/json", "User-Agent": USER_AGENT },
        signal: controller.signal,
      });
      if (!res.ok) return null;
      return (await res.json()) as T;
    } catch {
      // network error, timeout, wiki offline, HTML error page — all "no data"
      return null;
    } finally {
      clearTimeout(timer);
    }
  });
}

// ---- wiki + page discovery ----

interface MediaWikiSearchResponse {
  query?: { search?: Array<{ title: string }> };
}

interface SiteInfoResponse {
  query?: { general?: { sitename?: string; server?: string } };
}

/**
 * Fandom retired its cross-wiki directory API (`/api/v1/Wikis/ByString` now
 * 404s) and community.fandom.com sits behind a Cloudflare challenge, so
 * there is no supported way to *search* for the right wiki. Per-wiki
 * `api.php` is alive and well, though, and Fandom names game wikis after the
 * franchise — metalgear.fandom.com, zelda.fandom.com, masseffect.fandom.com.
 *
 * So: guess the subdomain from the title, shortest-franchise-last, and probe.
 * "Metal Gear Solid V: The Phantom Pain" yields metalgearsolidv →
 * metalgearsolid → metalgear, and the first that answers wins. Guessing can
 * land on the wrong wiki, which is why the source link is shown next to the
 * parsed list for the user to sanity-check.
 */
export function candidateDomains(gameTitle: string): string[] {
  // subtitles ("…: The Phantom Pain") are never part of the wiki name
  const base = gameTitle.split(/[:–—-]/)[0] ?? gameTitle;
  const words = base
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, "")
    .split(/\s+/)
    .filter(Boolean)
    // leading articles aren't in wiki subdomains ("The Last of Us" → lastofus)
    .filter((w, i) => !(i === 0 && w === "the"));

  const out: string[] = [];
  for (let len = words.length; len >= 1; len--) {
    const slug = words.slice(0, len).join("");
    if (slug.length >= 3 && !out.includes(slug)) out.push(slug);
  }
  return out.slice(0, 4);
}

/** Confirm a guessed subdomain is a real wiki; follows Fandom's redirects. */
async function probeWiki(slug: string): Promise<{ name: string; domain: string } | null> {
  const data = await getJson<SiteInfoResponse>(
    `https://${slug}.fandom.com/api.php?` +
      new URLSearchParams({
        action: "query",
        meta: "siteinfo",
        siprop: "general",
        format: "json",
        origin: "*",
      }).toString(),
  );
  const general = data?.query?.general;
  if (!general) return null;
  // `server` is the canonical host after any redirect (metalgearsolid → metalgear)
  let domain = `${slug}.fandom.com`;
  if (general.server) {
    try {
      domain = new URL(general.server, `https://${slug}.fandom.com`).host;
    } catch {
      /* keep the guessed host */
    }
  }
  return { name: general.sitename ?? domain, domain };
}

/** Game title → the wikis worth searching, best guess first. */
async function findWikis(gameTitle: string): Promise<Array<{ name: string; domain: string }>> {
  const found: Array<{ name: string; domain: string }> = [];
  for (const slug of candidateDomains(gameTitle)) {
    const wiki = await probeWiki(slug);
    if (wiki && !found.some((w) => w.domain === wiki.domain)) found.push(wiki);
    if (found.length >= 2) break;
  }
  return found;
}

/** Search one wiki for pages that might carry the mission list. */
async function searchWikiPages(domain: string, query: string): Promise<string[]> {
  const url =
    `https://${domain}/api.php?` +
    new URLSearchParams({
      action: "query",
      list: "search",
      srsearch: query,
      srlimit: "5",
      srnamespace: "0",
      format: "json",
      origin: "*",
    }).toString();
  const data = await getJson<MediaWikiSearchResponse>(url);
  return (data?.query?.search ?? []).map((s) => s.title);
}

// ---- wikitext parsing ----

/** Strip the wiki markup that survives inside a list line. */
export function stripWikiMarkup(raw: string): string {
  let text = raw;

  // <ref>…</ref>, <small>…</small> and friends
  text = text
    .replace(/<ref[^>]*\/>/gi, "")
    .replace(/<ref[^>]*>[\s\S]*?<\/ref>/gi, "")
    .replace(/<[^>]+>/g, "");

  // {{Template|…}} — infoboxes and icons. Innermost-first so nested
  // templates unwrap instead of leaving a trailing "}}".
  for (let i = 0; i < 5 && /\{\{[^{}]*\}\}/.test(text); i++) {
    text = text.replace(/\{\{[^{}]*\}\}/g, "");
  }

  // [[File:foo.png|thumb|192x192px]] — embedded media, not a link to a page
  text = text.replace(/\[\[(?:File|Image|Media)\s*:[^\]]*\]\]/gi, "");

  // [[Page|Label]] / [[Page|Label|extra]] → the last segment is the caption;
  // [[Page]] → Page
  text = text
    .replace(/\[\[([^\][]*?)\]\]/g, (_m, inner: string) => {
      const parts = inner.split("|");
      return parts[parts.length - 1] ?? "";
    })
    // unbalanced leftovers from a link split across cells
    .replace(/\[\[|\]\]/g, "");

  // [http://example.com Label] → Label
  text = text
    .replace(/\[(?:https?:)?\/\/\S+\s+([^\]]+)\]/g, "$1")
    .replace(/\[(?:https?:)?\/\/\S+\]/g, "");

  return text
    // ''' bold ''' / '' italic ''
    .replace(/'{2,5}/g, "")
    .replace(/&nbsp;/g, " ")
    .replace(/\s+/g, " ")
    .replace(/^[\s|*#:;,-]+/, "")
    .trim();
}

/**
 * Pull list entries out of a wikitext section. Handles bullet lists,
 * numbered lists, and the first cell of simple table rows — between them
 * that covers how most wikis lay a mission list out.
 */
export function extractMissionsFromWikitext(wikitext: string): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  // Inside a table only the first cell of each row is the mission name; the
  // rest are descriptions, rewards and images. `|-` starts a new row.
  let awaitingFirstCell = false;

  for (const line of wikitext.split(/\r?\n/)) {
    const trimmed = line.trim();
    let candidate: string | null = null;

    if (trimmed.startsWith("{|")) {
      awaitingFirstCell = false;
      continue;
    }
    if (trimmed.startsWith("|-")) {
      awaitingFirstCell = true;
      continue;
    }
    if (trimmed.startsWith("|}")) {
      awaitingFirstCell = false;
      continue;
    }

    // "* Mission" / "# Mission" — but not "**" sub-bullets, which are
    // objectives nested under a mission rather than missions themselves
    const listMatch = /^([*#])\s*(?!\1)(.+)$/.exec(trimmed);
    if (listMatch) candidate = listMatch[2]!;

    // "| Mission 1 || description" or a "| Mission 1" row-opening cell
    if (!candidate && awaitingFirstCell && /^[|!]/.test(trimmed)) {
      const cell = trimmed.replace(/^[|!]+/, "").split("||")[0] ?? "";
      // "| style="…" | Text" — drop the attribute prefix, keep the text
      const afterAttrs = /\w+\s*=/.test(cell.split("|")[0] ?? "")
        ? cell.slice(cell.indexOf("|") + 1)
        : cell;
      candidate = afterAttrs;
      awaitingFirstCell = false;
    }

    if (!candidate) continue;
    const text = stripWikiMarkup(candidate);
    if (!isPlausibleMission(text)) continue;
    const key = text.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(text);
  }
  return out;
}

function isPlausibleMission(text: string): boolean {
  if (text.length < 2 || text.length > 120) return false;
  if (ITEM_DENYLIST_RE.test(text)) return false;
  // pure punctuation/numbers, or leftover table syntax
  if (!/[a-z]/i.test(text)) return false;
  // quoted blurbs are the mission's description column, not its name
  if (/^["“]/.test(text)) return false;
  // prose: mission names are titles, not sentences
  if (text.split(/\s+/).length > 12) return false;
  if (/[.!?]\s+[A-Z]/.test(text)) return false;
  return true;
}

// ---- page → mission list ----

interface WikiSection {
  index: string;
  line: string;
  level: string;
}

interface ParseSectionsResponse {
  parse?: { sections?: WikiSection[] };
}

/**
 * A real mission list is tens of entries. Anything past this is a table of
 * every collectible/challenge in the game, which is what parsing the wrong
 * page looks like — reject it rather than hand the user 700 rows to prune.
 */
const MAX_MISSIONS = 200;

/**
 * Wikis often render each mission as its own subsection under a "Missions"
 * heading rather than as a bullet list (Metal Gear's debriefings page does
 * exactly this), so the section tree *is* the mission list. Take the
 * immediate children of the anchor heading and stop when the nesting pops
 * back out to the anchor's level.
 */
export function sectionsUnder(sections: WikiSection[], anchorIndex: number): string[] {
  const anchor = sections[anchorIndex];
  if (!anchor) return [];
  const anchorLevel = Number(anchor.level);
  const childLevel = anchorLevel + 1;
  const out: string[] = [];
  for (let i = anchorIndex + 1; i < sections.length; i++) {
    const section = sections[i]!;
    const level = Number(section.level);
    if (level <= anchorLevel) break;
    // deeper headings are per-mission detail (objectives, rewards), not missions
    if (level !== childLevel) continue;
    const text = stripWikiMarkup(section.line);
    if (isPlausibleMission(text)) out.push(text);
  }
  return out;
}

interface ParseWikitextResponse {
  parse?: { wikitext?: { "*": string } };
}

function pageUrl(domain: string, pageTitle: string): string {
  return `https://${domain}/wiki/${encodeURIComponent(pageTitle.replace(/ /g, "_"))}`;
}

async function fetchSectionWikitext(
  domain: string,
  pageTitle: string,
  section?: string,
): Promise<string | null> {
  const params = new URLSearchParams({
    action: "parse",
    page: pageTitle,
    prop: "wikitext",
    format: "json",
    origin: "*",
  });
  if (section) params.set("section", section);
  const data = await getJson<ParseWikitextResponse>(`https://${domain}/api.php?${params.toString()}`);
  return data?.parse?.wikitext?.["*"] ?? null;
}

/**
 * Headings every wiki article has. A "list" made of these is the article's
 * own table of contents, not missions — Halo: Combat Evolved's Campaign
 * section yields Summary/Plot/Backstory/Main characters this way.
 */
const GENERIC_HEADING_RE =
  /^(summary|plot|overview|background|synopsis|story|setting|characters?|main characters|minor characters|cast|reception|development|production|gameplay|mechanics|trivia|legacy|appearances?|media|notes?|references?|gallery|videos?|images?|soundtrack|weapons?|items?|enemies|locations?|achievements?|trophies)$/i;

/**
 * How much a parsed list looks like a real mission list, 0–1. Wikis offer
 * several plausible-looking lists per page and the first match is often the
 * wrong one, so every strategy is scored and the best wins.
 */
export function scoreMissions(missions: string[]): number {
  if (missions.length < 3 || missions.length > MAX_MISSIONS) return 0;

  // repeats mean we grabbed a grouping column ("Los Santos" three times)
  const unique = new Set(missions.map((m) => m.toLowerCase()));
  const uniqueRatio = unique.size / missions.length;

  const generic = missions.filter((m) => GENERIC_HEADING_RE.test(m)).length;
  const genericRatio = 1 - generic / missions.length;

  // games have roughly 6–120 missions; outside that we're probably reading
  // a collectibles table or a stub
  const sizeRatio = missions.length >= 6 && missions.length <= 120 ? 1 : 0.5;

  return uniqueRatio * genericRatio * sizeRatio;
}

/** Below this a list is more likely wrong than right — better to offer nothing. */
const MIN_SCORE = 0.7;

/** Page titles that promise nothing but a list ("List of Peace Walker missions"). */
function isListPage(pageTitle: string): boolean {
  return /^list of\b/i.test(pageTitle) || MISSION_SECTION_RE.test(pageTitle);
}

/**
 * Best mission list on one page, trying the layouts wikis actually use:
 *   1. each mission as a subsection under a "Missions" heading
 *   2. a bullet/numbered/table list inside that heading
 *   3. the whole page, but only when its title promises a list
 */
async function extractFromPage(
  domain: string,
  pageTitle: string,
): Promise<{ missions: string[]; sectionTitle: string | null } | null> {
  const sectionsData = await getJson<ParseSectionsResponse>(
    `https://${domain}/api.php?` +
      new URLSearchParams({
        action: "parse",
        page: pageTitle,
        prop: "sections",
        format: "json",
        origin: "*",
      }).toString(),
  );

  const sections = sectionsData?.parse?.sections ?? [];
  const anchors = sections
    .map((section, i) => ({ section, i }))
    .filter(
      ({ section }) =>
        MISSION_SECTION_RE.test(stripWikiMarkup(section.line)) &&
        !SECTION_DENYLIST_RE.test(stripWikiMarkup(section.line)),
    )
    // prefer explicitly "main" headings, then shallower ones
    .sort((a, b) => {
      const aMain = /\bmain\b/i.test(a.section.line) ? 0 : 1;
      const bMain = /\bmain\b/i.test(b.section.line) ? 0 : 1;
      return aMain - bMain || Number(a.section.level) - Number(b.section.level);
    });

  const attempts: Array<{ missions: string[]; sectionTitle: string | null; score: number }> = [];
  const consider = (missions: string[], sectionTitle: string | null) => {
    const score = scoreMissions(missions);
    if (score > 0) attempts.push({ missions, sectionTitle, score });
  };

  // 1. missions as subsections of a "Missions" heading
  for (const { section, i } of anchors.slice(0, 3)) {
    consider(sectionsUnder(sections, i), stripWikiMarkup(section.line));
  }

  // 2. missions as a bullet/numbered/table list inside that heading
  for (const { section } of anchors.slice(0, 3)) {
    const wikitext = await fetchSectionWikitext(domain, pageTitle, section.index);
    if (wikitext) consider(extractMissionsFromWikitext(wikitext), stripWikiMarkup(section.line));
  }

  // 3. the whole page — only for pages that exist to hold a list, otherwise
  //    this scrapes every table on a general article
  if (isListPage(pageTitle)) {
    const whole = await fetchSectionWikitext(domain, pageTitle);
    if (whole) consider(extractMissionsFromWikitext(whole), null);
  }

  const best = attempts.sort((a, b) => b.score - a.score)[0];
  if (!best || best.score < MIN_SCORE) return null;
  return { missions: best.missions, sectionTitle: best.sectionTitle };
}

/**
 * Significant words of a game title, plus the acronym wikis actually use in
 * page names — "Missions in GTA V" never contains the words "grand theft
 * auto", so without this the right page loses to "Missions in GTA Online".
 */
function titleWords(gameTitle: string): string[] {
  const base = gameTitle.split(/[:–—]/)[0] ?? gameTitle;
  const all = gameTitle
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .split(/\s+/)
    .filter(Boolean);

  const words = all.filter((w) => w.length > 2 && !["the", "and", "for", "of"].includes(w));

  // entry number, roman or arabic ("V", "2") — distinguishes sequels
  const numerals = all.filter((w) => /^(\d{1,2}|[ivx]{1,5})$/.test(w));

  const acronymSource = base
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .split(/\s+/)
    .filter((w) => w && !["the", "and", "for", "of"].includes(w));
  const acronym = acronymSource.length >= 2 ? acronymSource.map((w) => w[0]).join("") : null;

  return [...new Set([...words, ...numerals, ...(acronym ? [acronym] : [])])];
}

/**
 * Pages that match the franchise but not the thing being tracked: spin-off
 * modes, scrapped content, single-mission articles.
 */
const WRONG_SCOPE_RE =
  /\b(online|multiplayer|cut content|beta|voicelines?|unused|mobile|demo|soundtrack)\b/i;

/** Order search hits so the page most likely to hold the list is tried first. */
export function rankPages(pages: string[], gameTitle: string): string[] {
  const words = titleWords(gameTitle);
  return [...pages]
    .map((page) => {
      const lower = page.toLowerCase();
      let score = 0;
      if (MISSION_SECTION_RE.test(page)) score += 3;
      if (/^list of\b/i.test(page)) score += 2;
      if (/\b(debriefing|walkthrough)s?\b/i.test(page)) score += 2;
      // pages about this specific game beat franchise-wide ones
      score += words.filter((w) => lower.includes(w)).length;
      // spin-off modes and scrapped content share every other keyword
      if (WRONG_SCOPE_RE.test(page)) score -= 5;
      // "Red Dead Redemption (mission)" is one mission, not the list
      if (/\(mission\)$/i.test(page)) score -= 4;
      // "Halo (level)/Walkthrough" — a single level's guide
      if (page.includes("/")) score -= 2;
      // subpages of another game, character articles, etc.
      if (/\b(character|weapon|item|vehicle|enem(y|ies)|gallery|soundtrack)\b/i.test(page)) {
        score -= 3;
      }
      return { page, score };
    })
    .sort((a, b) => b.score - a.score)
    .map((p) => p.page);
}

/**
 * Find a mission list for a game. Returns a suggestion for review, or null
 * when nothing usable turned up — the caller falls back to manual entry.
 */
export async function suggestMissions(gameTitle: string): Promise<MissionSuggestion | null> {
  const wikis = await findWikis(gameTitle);
  if (wikis.length === 0) return null;

  const tried: MissionSourceCandidate[] = [];

  for (const wiki of wikis) {
    // two phrasings: wikis split between "<game> missions" list pages and
    // walkthrough/debriefing pages that carry the same list
    const pages = [
      ...(await searchWikiPages(wiki.domain, `${gameTitle} missions`)),
      ...(await searchWikiPages(wiki.domain, `list of ${gameTitle} missions walkthrough`)),
    ];
    const ordered = rankPages([...new Set(pages)], gameTitle);

    for (const pageTitle of ordered.slice(0, 4)) {
      const candidate: MissionSourceCandidate = {
        wikiName: wiki.name,
        domain: wiki.domain,
        pageTitle,
        url: pageUrl(wiki.domain, pageTitle),
      };
      const found = await extractFromPage(wiki.domain, pageTitle);
      if (!found) {
        tried.push(candidate);
        continue;
      }
      return {
        sourceUrl: candidate.url,
        wikiName: wiki.name,
        pageTitle,
        sectionTitle: found.sectionTitle,
        missions: found.missions,
        alternatives: tried.slice(0, 5),
      };
    }
  }
  return null;
}

/** Re-parse a specific wiki page the user picked from `alternatives`. */
export async function suggestMissionsFromUrl(url: string): Promise<MissionSuggestion | null> {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return null;
  }
  // exact-host or dot-suffix match — a bare endsWith("fandom.com") would let
  // "evil-fandom.com" turn this into a fetch-any-host proxy
  if (parsed.protocol !== "https:" && parsed.protocol !== "http:") return null;
  if (parsed.host !== "fandom.com" && !parsed.host.endsWith(".fandom.com")) return null;

  const match = /\/wiki\/(.+)$/.exec(parsed.pathname);
  if (!match) return null;
  const pageTitle = decodeURIComponent(match[1]!).replace(/_/g, " ");

  const found = await extractFromPage(parsed.host, pageTitle);
  if (!found) return null;
  return {
    sourceUrl: pageUrl(parsed.host, pageTitle),
    wikiName: parsed.host,
    pageTitle,
    sectionTitle: found.sectionTitle,
    missions: found.missions,
    alternatives: [],
  };
}
