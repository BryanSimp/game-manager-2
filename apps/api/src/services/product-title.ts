/**
 * Retail product title → a title you can actually search IGDB with.
 *
 * UPC databases return shelf listings, not game names:
 *
 *   "Pokemon Sun Nintendo 09109480"
 *   "Nintendo Super Mario Odyssey - Nintendo Switch"
 *   "God of War Ragnarok - PlayStation 5, Standard Edition"
 *
 * Everything after the game's name is noise: the platform (which doubles as
 * the platform hint), the publisher, a retailer SKU, edition and condition
 * words. Stripping the platform was all this used to do, which left
 * "Pokemon Sun Nintendo 09109480" going to the matcher verbatim.
 *
 * Publisher stripping is *ambiguous* — "Nintendo Land" is a game and
 * "Nintendo Super Mario Odyssey" is a listing — so this module doesn't decide.
 * It returns the confident cleanup plus `variants`, and the caller keeps
 * whichever scores best against the catalog, the same way `matcher.ts` deals
 * with OCR junk.
 *
 * No database imports here on purpose: this is pure string work, exercised by
 * `scripts/check-product-titles.ts`.
 */

export interface CleanedProductTitle {
  /** confident cleanup — safe to search as-is */
  cleaned: string;
  /**
   * More aggressive readings (publisher dropped from the front/back). Only
   * worth using if one out-scores `cleaned`, so a real title that happens to
   * start with a publisher's name can't be mangled.
   */
  variants: string[];
  /** seeded platform name implied by the listing, when one was mentioned */
  platformName: string | null;
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
  // word-bounded, so this only fires on a standalone "PC" in the listing
  { alias: "pc", platform: "PC" },
].sort((a, b) => b.alias.length - a.alias.length);

/**
 * Publishers, as they turn up in retail listings. Never stripped from
 * `cleaned` — only used to build `variants`, because plenty of these are also
 * the first word of a real game ("Nintendo Land", "Sega Bass Fishing",
 * "Atari 50", "Disney Illusion Island").
 */
const PUBLISHERS = [
  "sony interactive entertainment",
  "sony computer entertainment",
  "microsoft game studios",
  "warner bros interactive",
  "focus home interactive",
  "annapurna interactive",
  "nintendo of america",
  "microsoft studios",
  "xbox game studios",
  "activision blizzard",
  "bethesda softworks",
  "disney interactive",
  "warner bros games",
  "devolver digital",
  "electronic arts",
  "rockstar games",
  "bandai namco",
  "square enix",
  "warner bros",
  "deep silver",
  "aksys games",
  "koei tecmo",
  "nis america",
  "thq nordic",
  "activision",
  "505 games",
  "2k games",
  "ea sports",
  "bethesda",
  "microsoft",
  "rockstar",
  "take-two",
  "take two",
  "nintendo",
  "ubisoft",
  "wb games",
  "capcom",
  "konami",
  "bandai",
  "disney",
  "namco",
  "atlus",
  "tecmo",
  "xseed",
  "atari",
  "sega",
  "sony",
  "thq",
  "2k",
  "ea",
].sort((a, b) => b.length - a.length);

/** Trailing corporate suffixes: "Nintendo Co. Ltd", "Take-Two Inc." */
const CORPORATE_SUFFIX = /[\s,]+(inc|llc|ltd|co|corp|corporation)\.?\s*$/gi;

/** Retail listing noise that isn't part of the game's title. */
const NOISE_PATTERNS: RegExp[] = [
  /\((renewed|refurbished|pre-?owned|used|new|sealed|import|us|uk|eu|ntsc|pal)\)/gi,
  /\b(standard|day one|launch|retail) edition\b/gi,
  /\bvideo ?games?\b/gi,
  /\b(brand new|factory sealed|complete in box|cib)\b/gi,
  /\b(digital download|digital code|download code|physical copy)\b/gi,
  /\besrb\b/gi,
  /\brated\s+(e10\+|e|t|m|ao)\b(\s+for\s+\w+)?/gi,
  // retailer SKUs and the barcode itself. Five digits, not four: "Metro 2033"
  // and "NBA 2K24" are titles, "09109480" is a part number.
  /\b\d{5,}\b/g,
];

function escapeRegExp(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/** Collapse the separators and whitespace a strip leaves behind. */
function tidy(text: string): string {
  return text
    .replace(/\(\s*\)/g, " ")
    .replace(/\[\s*\]/g, " ")
    .replace(/\s+/g, " ")
    .replace(/[\s\-–—:,/|]+$/g, "")
    .replace(/^[\s\-–—:,/|]+/g, "")
    .trim();
}

/**
 * Strip one leading or trailing occurrence of `phrase`, word-bounded. The
 * boundaries matter: without them the "nes" platform alias turned
 * "Chinese Chess" into "Chi e Chess".
 */
function stripEdge(title: string, phrase: string, edge: "start" | "end"): string | null {
  const body = escapeRegExp(phrase);
  const re =
    edge === "start"
      ? new RegExp(`^[\\s\\-–—:,/(\\[]*(?:by\\s+)?${body}\\b[\\s\\-–—:,/)\\]]*`, "i")
      : new RegExp(`[\\s\\-–—:,/(\\[]*(?:by\\s+)?\\b${body}[\\s\\-–—:,/)\\]]*$`, "i");
  if (!re.test(title)) return null;
  const stripped = tidy(title.replace(re, " "));
  // a bare "Land" left over from "Nintendo Land" is not a better guess
  return stripped.length >= 3 ? stripped : null;
}

/** First publisher that can be taken off this edge, or the title unchanged. */
function stripPublisher(title: string, publishers: string[], edge: "start" | "end"): string | null {
  for (const publisher of publishers) {
    const stripped = stripEdge(title, publisher, edge);
    if (stripped) return stripped;
  }
  return null;
}

/**
 * Clean a retail product title. `brand` is the UPC database's own brand field
 * when it has one — a better publisher guess than the built-in list, so it's
 * tried first.
 */
export function cleanProductTitle(product: string, brand?: string | null): CleanedProductTitle {
  let title = product;
  let platformName: string | null = null;

  for (const { alias, platform } of PLATFORM_ALIASES) {
    // match "- Nintendo Switch", "(PS5)", "for Xbox One", "[PS4]" …
    const re = new RegExp(
      `[\\s\\-–—:,/(\\[]*(?:for\\s+)?\\b${escapeRegExp(alias)}\\b[\\s\\-–—:,/)\\]]*`,
      "i",
    );
    if (re.test(title)) {
      platformName ??= platform;
      title = title.replace(re, " ");
    }
  }
  for (const re of NOISE_PATTERNS) title = title.replace(re, " ");
  title = title.replace(CORPORATE_SUFFIX, " ");

  // never return an empty query: an over-eager strip falls back to the listing
  const cleaned = tidy(title) || tidy(product) || product;

  const publishers = brand?.trim()
    ? [brand.trim().toLowerCase(), ...PUBLISHERS]
    : PUBLISHERS;

  const variants = new Set<string>();
  const noLead = stripPublisher(cleaned, publishers, "start");
  const noTrail = stripPublisher(cleaned, publishers, "end");
  if (noLead) variants.add(noLead);
  if (noTrail) variants.add(noTrail);
  // "Nintendo Pokemon Sun Nintendo" — take it off both ends
  if (noTrail) {
    const noBoth = stripPublisher(noTrail, publishers, "start");
    if (noBoth) variants.add(noBoth);
  }
  variants.delete(cleaned);

  return { cleaned, variants: [...variants], platformName };
}
