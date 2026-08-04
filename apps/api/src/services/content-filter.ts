/**
 * Safety check for text that can end up in front of strangers.
 *
 * Collections and lists are publishable, so their names and contents are
 * cross-user surfaces. This rejects two things and only two things: slurs and
 * hate terms, and personal information someone could be found by.
 *
 * It is deliberately **not** a profanity filter. Plenty of real games ship
 * missions with swearing in the title, and "Kill the bastard" is a fair
 * description of a boss. Filtering that would generate false positives
 * forever and protect nobody.
 *
 * It also isn't `plugins/sanitize.ts`. That hook silently rewrites strings to
 * defuse XSS, which is right for markup and wrong here — someone who typed
 * their home address needs to be told, not quietly edited.
 *
 * The check runs on **every write**, not only at publish. Anything private
 * can be published later with one click, and finding out at that moment that
 * a list you spent a month on is unpublishable — without being told which of
 * seventy entries is the problem — is worse than being told as you type it.
 *
 * It is a speed bump, not a guarantee. Someone determined gets through, and
 * admin delete stays the backstop it always was.
 */

export type ContentIssue = {
  kind: "hate" | "pii";
  /** Safe to hand back to the user: says what tripped, never quotes it. */
  message: string;
};

/**
 * Slurs and hate terms, matched as whole words against the normalised string.
 *
 * Kept short on purpose. Every entry is a term with no legitimate reading in a
 * shared game list. Resist padding this out: each addition is a title someone
 * can no longer write, and near-misses cost more than they save. Notably
 * absent — "kill all", because "Kill all the guards" is an actual mission in
 * an awful lot of games.
 */
const HATE_TERMS = [
  "nigger",
  "nigga",
  "faggot",
  "tranny",
  "kike",
  "spic",
  "chink",
  "gook",
  "wetback",
  "raghead",
  "towelhead",
  "beaner",
  "retard",
  "retarded",
  "paki",
  "shemale",
  "heil hitler",
  "sieg heil",
  "white power",
  "gas the jews",
];

/**
 * Personal information. Narrow by design: a false positive blocks a real
 * mission title, and game text is full of numbers.
 */
const PII_PATTERNS: Array<{ re: RegExp; message: string }> = [
  {
    re: /[\w.+-]+@[\w-]+\.[a-z]{2,}/i,
    message: "That looks like an email address — leave contact details out of shared lists.",
  },
  {
    // +1 (555) 010-9999, 555-010-9999, 5550109999 — ten or more digits held
    // together by phone punctuation, bounded so a long run of digits inside
    // another token (an appid, a map seed) doesn't count.
    re: /(?<![\d-])(?:\+\d{1,3}[\s.-]?)?(?:\(\d{3}\)|\d{3})[\s.-]?\d{3}[\s.-]?\d{4}(?![\d-])/,
    message: "That looks like a phone number — leave contact details out of shared lists.",
  },
  {
    // "742 Evergreen Terrace", "221 Baker Street". The word between the number
    // and the street type keeps "5 Street Fighter" out.
    //
    // The street types here are only the ones that aren't ordinary English:
    // no "way", "place", "st", "dr" or "ct". Mission lists are full of
    // numbered entries, and "12 The Only Way" is a mission title, not an
    // address. Catching every address matters less than not blocking those.
    re: /\b\d{1,5}\s+[a-z][\w'-]*(?:\s+[a-z][\w'-]*){0,2}\s+(?:street|avenue|ave|road|rd|lane|boulevard|blvd|terrace|circle|parkway|highway)\b/i,
    message: "That looks like a street address — leave personal details out of shared lists.",
  },
];

/**
 * Fold the tricks used to slip a term past a word list: case, accents and
 * digit-for-letter substitution. Anything that isn't a letter or digit becomes
 * a space, so "n.i.g.g.e.r" collapses into the same shape as the plain word.
 *
 * Stretched letters are *not* handled here — see `termPattern`.
 */
export function normalizeForMatch(text: string): string {
  return text
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "") // drop the accents NFKD just split off
    .toLowerCase()
    .replace(/[4@]/g, "a")
    .replace(/3/g, "e")
    .replace(/[1!|]/g, "i")
    .replace(/0/g, "o")
    .replace(/[5$]/g, "s")
    .replace(/7/g, "t")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

/**
 * A whole-word matcher for one term, where every character may be repeated:
 * "nigger" becomes /n+i+g+g+e+r+/.
 *
 * Repeating per character rather than collapsing repeats in the input is what
 * keeps this honest in both directions. "niiiigggger" still matches, because
 * each run is soaked up by its own `+`. "con" still does *not* match "coon",
 * because `c+o+o+n+` needs two distinct o runs — collapsing the input would
 * have folded them together and started rejecting con jobs.
 */
function termPattern(term: string): RegExp {
  const body = term
    .split("")
    .map((char) => (char === " " ? "\\s+" : `${char}+`))
    .join("");
  return new RegExp(`(?:^|\\s)${body}(?:$|\\s)`);
}

/** Built once — these never change at runtime. */
const HATE_PATTERNS = HATE_TERMS.map(termPattern);

/**
 * Rejoin text that was spelled out letter by letter: "n i g g e r" and
 * "n.i.g.g.e.r" both normalise to single-character words, so glue any run of
 * two or more of them back into one.
 *
 * This is why the check isn't simply "delete all spaces and search". Doing
 * that finds "paki" inside Pakistan and "spic" inside suspicion — real words
 * that would then be unwritable. Requiring the letters to have arrived as
 * separate tokens keeps the evasion caught and ordinary prose untouched: an
 * S rank or a "Rank S A B" objective glues into harmless nonsense, and
 * nothing without spaced-out letters changes at all.
 */
function collapseSpacedLetters(normalized: string): string {
  return normalized.replace(/\b(?:[a-z0-9] )+[a-z0-9]\b/g, (run) => run.replace(/ /g, ""));
}

/**
 * Inspect one string. Returns null when it's fine — the overwhelmingly common
 * case, and the only path most writes take.
 */
export function inspectText(text: string | null | undefined): ContentIssue | null {
  if (!text) return null;

  for (const pattern of PII_PATTERNS) {
    if (pattern.re.test(text)) return { kind: "pii", message: pattern.message };
  }

  const normalized = normalizeForMatch(text);
  if (!normalized) return null;
  const rejoined = collapseSpacedLetters(normalized);
  const candidates = rejoined === normalized ? [normalized] : [normalized, rejoined];
  for (const pattern of HATE_PATTERNS) {
    if (candidates.some((candidate) => pattern.test(candidate))) {
      return {
        kind: "hate",
        message:
          "That wording isn't allowed in lists and collections — they can be shared with other players.",
      };
    }
  }
  return null;
}

/** First issue across many strings, for checking a whole list before publishing. */
export function inspectAll(texts: Array<string | null | undefined>): ContentIssue | null {
  for (const text of texts) {
    const issue = inspectText(text);
    if (issue) return issue;
  }
  return null;
}
