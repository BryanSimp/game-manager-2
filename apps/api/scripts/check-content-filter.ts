/**
 * Content filter cases, checked against expectations.
 *
 * `inspectText` is pure string work with no database behind it, so this runs
 * standalone: `pnpm --filter @gm/api check:content`.
 *
 * The "must pass" half matters more than the "must block" half. A filter that
 * misses a slur is a moderation problem; a filter that rejects "Kill all the
 * guards" is a broken product, and mission lists are full of sentences that
 * look alarming out of context.
 */
import { inspectText } from "../src/services/content-filter.js";

interface Case {
  text: string;
  /** null = must be accepted; otherwise the kind of issue expected */
  expect: "hate" | "pii" | null;
  why?: string;
}

const CASES: Case[] = [
  // --- must be blocked: hate terms, including the usual evasions ---
  { text: "kill the nigger", expect: "hate" },
  { text: "N I G G E R", expect: "hate", why: "spaced out" },
  { text: "n.i.g.g.e.r trophies", expect: "hate", why: "punctuation between letters" },
  { text: "niiiiiggggger", expect: "hate", why: "stretched letters" },
  { text: "f4ggot run", expect: "hate", why: "digit substitution" },
  { text: "Retarded boss fight", expect: "hate" },
  { text: "sieg heil", expect: "hate" },
  { text: "white power", expect: "hate" },

  // --- must be blocked: personal information ---
  { text: "email me at bryan@example.com", expect: "pii" },
  { text: "742 Evergreen Terrace", expect: "pii" },
  { text: "I live at 221 Baker Street", expect: "pii" },
  { text: "call 555-010-9999", expect: "pii" },
  { text: "+1 (555) 010-9999", expect: "pii" },
  { text: "5550109999", expect: "pii" },

  // --- must pass: ordinary mission text ---
  { text: "Kill all the guards", expect: null, why: "the single most common objective there is" },
  { text: "Damn Fine Coffee", expect: null, why: "swearing is not the filter's business" },
  { text: "Kill the bastard", expect: null },
  { text: "The Con Job", expect: null, why: "must not fold out of coon" },
  { text: "Raccoon City Police Department", expect: null },
  { text: "Assassinate the target", expect: null },
  { text: "Bloody Baron", expect: null },
  { text: "Shoot the moon", expect: null },

  // --- must pass: numbers that are not addresses or phone numbers ---
  { text: "5 Street Fighter matches", expect: null, why: "number then street type, no word between" },
  { text: "12 The Only Way Out", expect: null, why: "numbered mission that ends in a street-ish word" },
  { text: "3 Days to Kill", expect: null },
  { text: "Collect 100 Riddler trophies", expect: null },
  { text: "Metro 2033", expect: null },
  { text: "Reach level 9999999", expect: null, why: "long digit run is not a phone number" },
  { text: "Steam appid 1091500", expect: null },
  { text: "Beat mission 2033 in under 10 minutes", expect: null },

  // --- must pass: words the naive "delete all spaces and search" breaks ---
  { text: "Reach Pakistan by train", expect: null, why: "'paki' inside a country" },
  { text: "Arouse suspicion in the guards", expect: null, why: "'spic' inside a word" },
  { text: "Get an S rank on every mission", expect: null, why: "a lone single-letter token" },
  { text: "Rank S A B C in order", expect: null, why: "spaced letters that glue into nonsense" },

  // --- must pass: real game and place names ---
  { text: "Assassin's Creed Valhalla", expect: null },
  { text: "Grand Theft Auto: Vice City", expect: null },
  { text: "Spec Ops: The Line", expect: null, why: "'spec' must not trip the 'spic' entry" },
  { text: "Chink in the armour is not a term we use", expect: "hate", why: "we accept this collateral" },
];

let failed = 0;
for (const testCase of CASES) {
  const issue = inspectText(testCase.text);
  const got = issue?.kind ?? null;
  const note = testCase.why ? `  (${testCase.why})` : "";

  if (got === testCase.expect) {
    console.log(`  ok   ${got ?? "pass"}  ${JSON.stringify(testCase.text)}${note}`);
  } else {
    failed += 1;
    console.error(
      `  FAIL ${JSON.stringify(testCase.text)}${note}\n` +
        `         got      ${got ?? "accepted"}\n` +
        `         expected ${testCase.expect ?? "accepted"}`,
    );
  }
}

console.log(`\n${CASES.length - failed}/${CASES.length} passed`);
if (failed > 0) process.exit(1);
