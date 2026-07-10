/**
 * OCR noise filtering — ported from v1's GameImporter, which proved out on
 * real Steam-library screenshots.
 */

// Whole-line noise: launcher status words that appear on their own line.
const NOISE_EXACT = new Set([
  "update queued",
  "update available",
  "update",
  "queued",
  "install",
  "installing",
  "installed",
  "downloading",
  "download",
  "running",
  "play",
  "launch",
  "resume",
  "preload",
  "preloading",
  "ready to play",
  "early access",
  "coming soon",
  "free to play",
  "free",
  // shelf-photo extras: spine text that isn't a title
  "nintendo switch",
  "playstation",
  "playstation 2",
  "playstation 3",
  "playstation 4",
  "playstation 5",
  "xbox",
  "xbox one",
  "xbox 360",
  "wii",
  "wii u",
  "ps2",
  "ps3",
  "ps4",
  "ps5",
]);

// Suffixes that launchers append after a dash: "Game Name - Update Queued"
const NOISE_SUFFIX_RE =
  /\s*[-–—]\s*(update queued|update available|update paused|update required|update|queued|paused|downloading|installing|installed|ready to play|early access|coming soon)\s*$/i;

export function cleanLine(raw: string): string {
  let line = raw.trim();

  // 0. Steam/launcher lists show a game icon before each title — OCR reads
  //    the icon as junk ("[PY Among us", "IB Aperture Desk Job", "& 3DMark").
  //    Strip closed bracket fragments, unclosed bracket + short token, then
  //    leading symbol runs. Never eat into a following capitalized word.
  line = line.replace(/^\s*[[({][^\])}\s]{0,4}[\])}]\s*/, "");
  line = line.replace(/^\s*[[({][^\s]{0,3}\s+/, "");
  line = line.replace(/^[^A-Za-z0-9]+/, "");

  // 2. Fix the most common OCR roman-numeral misreads.
  //    In many fonts the digit sequence looks like lowercase letters:
  //      "il" (i + l) → III  ← the most frequent Steam OCR error
  line = line.replace(/\s+lll\b/gi, " III");
  line = line.replace(/\s+il\b/gi, " III");
  line = line.replace(/\s+hl\b/gi, " III"); // "III" merges into "Hl" in some fonts
  line = line.replace(/\s+ll\b/gi, " II");

  // 3. Strip Steam/Epic/GOG launcher noise suffixes.
  line = line.replace(NOISE_SUFFIX_RE, "");

  // 4. Collapse multiple internal spaces produced by symbol removal.
  line = line.replace(/\s{2,}/g, " ");

  return line.trim();
}

export function isNoiseLine(raw: string): boolean {
  return NOISE_EXACT.has(raw.toLowerCase().trim());
}

/** OCR text → deduped candidate titles. */
export function extractTitles(text: string, max = 200): string[] {
  const seen = new Set<string>();
  const titles: string[] = [];
  for (const rawLine of text.split("\n")) {
    const line = cleanLine(rawLine);
    if (line.length <= 1 || line.length >= 300 || isNoiseLine(line)) continue;
    // drop lines that are mostly non-alphanumeric (OCR garbage)
    const alnum = line.replace(/[^a-z0-9]/gi, "").length;
    if (alnum < line.length * 0.5 || alnum < 2) continue;
    const key = line.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    titles.push(line);
    if (titles.length >= max) break;
  }
  return titles;
}

/** Sørensen–Dice bigram similarity, 0..1 — used as match confidence. */
export function similarity(a: string, b: string): number {
  const bigrams = (s: string): Map<string, number> => {
    const norm = s.toLowerCase().replace(/[^a-z0-9]/g, " ").replace(/\s+/g, " ").trim();
    const map = new Map<string, number>();
    for (let i = 0; i < norm.length - 1; i++) {
      const bg = norm.slice(i, i + 2);
      map.set(bg, (map.get(bg) ?? 0) + 1);
    }
    return map;
  };
  const aBigrams = bigrams(a);
  const bBigrams = bigrams(b);
  if (aBigrams.size === 0 || bBigrams.size === 0) return 0;
  let intersection = 0;
  let aTotal = 0;
  let bTotal = 0;
  for (const [bg, n] of aBigrams) {
    aTotal += n;
    const other = bBigrams.get(bg);
    if (other) intersection += Math.min(n, other);
  }
  for (const n of bBigrams.values()) bTotal += n;
  return (2 * intersection) / (aTotal + bTotal);
}
