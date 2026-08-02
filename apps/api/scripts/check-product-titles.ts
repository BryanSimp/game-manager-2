/**
 * Retail product titles → search queries, checked against expectations.
 *
 * `cleanProductTitle` is pure string work with no database behind it, so this
 * runs standalone: `pnpm --filter @gm/api check:titles`.
 *
 * A case either expects an exact `cleaned` result, or lists the title under
 * `oneOf` when dropping the publisher is a judgement call — those come back as
 * variants and the live lookup keeps whichever scores best against IGDB.
 */
import { cleanProductTitle } from "../src/services/product-title.js";

interface Case {
  product: string;
  brand?: string;
  /** exact expected `cleaned` output */
  cleaned?: string;
  /** expected to be either `cleaned` or one of the variants */
  oneOf?: string;
  platform?: string | null;
}

const CASES: Case[] = [
  // the reported failure: publisher + retailer SKU straight into the query
  { product: "Pokemon Sun Nintendo 09109480", brand: "Nintendo", oneOf: "Pokemon Sun", platform: null },
  { product: "Pokemon Sun - Nintendo 3DS", oneOf: "Pokemon Sun", platform: "Nintendo 3DS" },
  {
    product: "The Legend of Zelda: Tears of the Kingdom - Nintendo Switch",
    cleaned: "The Legend of Zelda: Tears of the Kingdom",
    platform: "Nintendo Switch",
  },
  {
    product: "Nintendo Super Mario Odyssey - Nintendo Switch",
    brand: "Nintendo",
    oneOf: "Super Mario Odyssey",
    platform: "Nintendo Switch",
  },
  {
    product: "God of War Ragnarok - PlayStation 5, Standard Edition",
    cleaned: "God of War Ragnarok",
    platform: "PlayStation 5",
  },
  { product: "Halo Infinite (Xbox Series X)", cleaned: "Halo Infinite", platform: "Xbox Series X|S" },
  {
    product: "Assassin's Creed Valhalla PS4 045496591784",
    brand: "Ubisoft",
    cleaned: "Assassin's Creed Valhalla",
    platform: "PlayStation 4",
  },
  { product: "Elden Ring - PS5 - Brand New, Factory Sealed", cleaned: "Elden Ring", platform: "PlayStation 5" },
  { product: "Metroid Dread for Nintendo Switch (Renewed)", cleaned: "Metroid Dread", platform: "Nintendo Switch" },

  // titles that must survive intact — these are what makes publisher
  // stripping a variant rather than the default
  { product: "Nintendo Land - Wii U", cleaned: "Nintendo Land", platform: "Wii U" },
  { product: "Atari 50: The Anniversary Celebration", cleaned: "Atari 50: The Anniversary Celebration" },
  { product: "Disney Illusion Island", cleaned: "Disney Illusion Island" },
  { product: "Sega Bass Fishing", cleaned: "Sega Bass Fishing" },
  // four digits is a title, five is a part number
  { product: "Metro 2033 Redux - Xbox One", cleaned: "Metro 2033 Redux", platform: "Xbox One" },
  { product: "NBA 2K24 - PlayStation 5", cleaned: "NBA 2K24", platform: "PlayStation 5" },
  // the "nes" alias used to eat the middle of any word containing it
  { product: "Chinese Chess", cleaned: "Chinese Chess", platform: null },
  { product: "Bones - PC", cleaned: "Bones", platform: "PC" },
  { product: "Super Mario Bros. - NES", cleaned: "Super Mario Bros.", platform: "NES" },
];

let failed = 0;
for (const testCase of CASES) {
  const { cleaned, variants, platformName } = cleanProductTitle(testCase.product, testCase.brand);
  const all = [cleaned, ...variants];

  const titleOk =
    testCase.cleaned !== undefined
      ? cleaned === testCase.cleaned
      : testCase.oneOf !== undefined
        ? all.includes(testCase.oneOf)
        : true;
  const platformOk =
    testCase.platform === undefined ? true : platformName === testCase.platform;

  if (titleOk && platformOk) {
    console.log(`  ok   ${testCase.product}\n         → ${all.join(" | ")} [${platformName ?? "no platform"}]`);
  } else {
    failed += 1;
    console.error(
      `  FAIL ${testCase.product}\n` +
        `         got      ${all.join(" | ")} [${platformName ?? "no platform"}]\n` +
        `         expected ${testCase.cleaned ?? `one of … ${testCase.oneOf}`}` +
        (testCase.platform === undefined ? "" : ` [${testCase.platform ?? "no platform"}]`),
    );
  }
}

console.log(`\n${CASES.length - failed}/${CASES.length} passed`);
if (failed > 0) process.exit(1);
