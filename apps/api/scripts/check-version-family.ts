/**
 * Remake links → "which versions does this game have, and which is newest?",
 * checked against expectations.
 *
 * `version-family.ts` is pure graph work with no database behind it, so this
 * runs standalone: `pnpm --filter @gm/api check:versions`.
 *
 * Each case is a handful of links (`original > remake`), the release dates
 * that are known, and what one game should see: the relation of every other
 * version to it, and which one "Show latest versions" would swap in — or
 * nothing, when the game already is the latest.
 */
import {
  buildVersionGraph,
  latestVersion,
  versionFamily,
  type Relation,
} from "../src/services/version-family.js";

interface Case {
  name: string;
  /** "original > remake", one per link */
  links: string[];
  /** release dates that are known; anything absent is unknown */
  dates?: Record<string, string>;
  /** the game being asked about */
  from: string;
  family: Record<string, Relation>;
  latest: string | null;
}

const CASES: Case[] = [
  {
    name: "no links at all",
    links: [],
    from: "re4",
    family: {},
    latest: null,
  },
  {
    name: "links that don't touch the game",
    links: ["ff7 > ff7-remake"],
    from: "re4",
    family: {},
    latest: null,
  },
  {
    name: "the original sees its remake, and is swapped for it",
    links: ["re4 > re4-2023"],
    dates: { re4: "2005-01-11", "re4-2023": "2023-03-24" },
    from: "re4",
    family: { "re4-2023": "remake" },
    latest: "re4-2023",
  },
  {
    name: "the remake sees its original, and stays put",
    links: ["re4 > re4-2023"],
    dates: { re4: "2005-01-11", "re4-2023": "2023-03-24" },
    from: "re4-2023",
    family: { re4: "original" },
    latest: null,
  },
  {
    name: "a chain: the middle version sees one each way",
    links: ["sotc > sotc-hd", "sotc-hd > sotc-2018"],
    dates: { sotc: "2005-10-18", "sotc-hd": "2011-09-27", "sotc-2018": "2018-02-06" },
    from: "sotc-hd",
    family: { sotc: "original", "sotc-2018": "remake" },
    latest: "sotc-2018",
  },
  {
    name: "a chain: the original reaches the end of it, not the next step",
    links: ["sotc > sotc-hd", "sotc-hd > sotc-2018"],
    dates: { sotc: "2005-10-18", "sotc-hd": "2011-09-27", "sotc-2018": "2018-02-06" },
    from: "sotc",
    family: { "sotc-hd": "remake", "sotc-2018": "remake" },
    latest: "sotc-2018",
  },
  {
    name: "two remasters of one original find each other as siblings",
    links: ["tlou > tlou-remastered", "tlou > tlou-part1"],
    dates: { tlou: "2013-06-14", "tlou-remastered": "2014-07-29", "tlou-part1": "2022-09-02" },
    from: "tlou-remastered",
    family: { tlou: "original", "tlou-part1": "sibling" },
    latest: "tlou-part1",
  },
  {
    name: "the newer of two siblings is already the latest",
    links: ["tlou > tlou-remastered", "tlou > tlou-part1"],
    dates: { tlou: "2013-06-14", "tlou-remastered": "2014-07-29", "tlou-part1": "2022-09-02" },
    from: "tlou-part1",
    family: { tlou: "original", "tlou-remastered": "sibling" },
    latest: null,
  },
  {
    name: "the original picks the newest of two remasters",
    links: ["tlou > tlou-remastered", "tlou > tlou-part1"],
    dates: { tlou: "2013-06-14", "tlou-remastered": "2014-07-29", "tlou-part1": "2022-09-02" },
    from: "tlou",
    family: { "tlou-remastered": "remake", "tlou-part1": "remake" },
    latest: "tlou-part1",
  },
  {
    // the link says it's newer; a missing date doesn't get to say otherwise
    name: "a remake with no release date still beats its original",
    links: ["oblivion > oblivion-remastered"],
    dates: { oblivion: "2006-03-20" },
    from: "oblivion",
    family: { "oblivion-remastered": "remake" },
    latest: "oblivion-remastered",
  },
  {
    // without this, IGDB missing one date would swap a 2021 remaster for the
    // 2011 one sitting next to it
    name: "an undated remaster isn't displaced by a dated sibling",
    links: ["me > me-2011", "me > me-legendary"],
    dates: { me: "2007-11-20", "me-2011": "2011-01-18" },
    from: "me-legendary",
    family: { me: "original", "me-2011": "sibling" },
    latest: null,
  },
  {
    name: "a dated remaster isn't displaced by an undated sibling",
    links: ["me > me-2011", "me > me-legendary"],
    dates: { me: "2007-11-20", "me-2011": "2011-01-18" },
    from: "me-2011",
    family: { me: "original", "me-legendary": "sibling" },
    latest: null,
  },
  {
    // the API refuses a pair linked both ways but doesn't walk for longer
    // loops, so one must not hang the walk or leave it with nothing to pick
    name: "a three-game loop terminates and falls back to the dates",
    links: ["a > b", "b > c", "c > a"],
    dates: { a: "2001-01-01", b: "2010-01-01", c: "2020-01-01" },
    from: "a",
    family: { b: "remake", c: "remake" },
    latest: "c",
  },
  {
    name: "two separate families don't leak into each other",
    links: ["re4 > re4-2023", "ff7 > ff7-remake"],
    dates: { re4: "2005-01-11", "re4-2023": "2023-03-24", ff7: "1997-01-31", "ff7-remake": "2020-04-10" },
    from: "ff7",
    family: { "ff7-remake": "remake" },
    latest: "ff7-remake",
  },
];

function show(family: Record<string, Relation>): string {
  const entries = Object.entries(family).sort(([a], [b]) => a.localeCompare(b));
  return entries.length === 0 ? "(none)" : entries.map(([id, r]) => `${id}=${r}`).join(", ");
}

let failed = 0;
for (const testCase of CASES) {
  const graph = buildVersionGraph(
    testCase.links.map((link) => {
      const [gameId, relatedGameId] = link.split(">").map((part) => part.trim());
      return { gameId: gameId!, relatedGameId: relatedGameId! };
    }),
  );
  const family = versionFamily(graph, testCase.from);
  const got = Object.fromEntries(family);
  const latest = latestVersion(
    graph,
    testCase.from,
    family.keys(),
    (id) => testCase.dates?.[id] ?? null,
  );

  if (show(got) === show(testCase.family) && latest === testCase.latest) {
    console.log(`  ok   ${testCase.name}\n         ${testCase.from} → ${show(got)} · latest: ${latest ?? "itself"}`);
  } else {
    failed += 1;
    console.error(
      `  FAIL ${testCase.name}\n` +
        `         got      ${show(got)} · latest: ${latest ?? "itself"}\n` +
        `         expected ${show(testCase.family)} · latest: ${testCase.latest ?? "itself"}`,
    );
  }
}

console.log(`\n${CASES.length - failed}/${CASES.length} passed`);
if (failed > 0) process.exit(1);
