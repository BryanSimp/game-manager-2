/**
 * What the game search treats as a Steam app id, checked against expectations.
 *
 * `parseSteamAppQuery` is pure string work, so this runs standalone:
 * `pnpm --filter @gm/api check:steam`.
 *
 * Most of the cases that matter are the ones that must *not* turn into an
 * explicit app lookup: a title with a number in it has to stay a title.
 */
import { parseSteamAppQuery, type SteamAppQuery } from "@gm/shared";

const CASES: Array<[input: string, expected: SteamAppQuery | null]> = [
  // links copied out of a browser or the Steam client
  ["https://store.steampowered.com/app/1091500/Cyberpunk_2077/", { appId: 1091500, explicit: true }],
  ["store.steampowered.com/app/1091500", { appId: 1091500, explicit: true }],
  ["https://store.steampowered.com/app/620/Portal_2/?l=french", { appId: 620, explicit: true }],
  ["https://store.steampowered.com/agecheck/app/1174180/", { appId: 1174180, explicit: true }],
  ["https://steamcommunity.com/app/1245620/reviews/", { appId: 1245620, explicit: true }],
  ["https://steamdb.info/app/730/charts/", { appId: 730, explicit: true }],
  ["  https://s.team/a/413150  ", { appId: 413150, explicit: true }],
  ["steam://store/292030", { appId: 292030, explicit: true }],
  ["steam://rungameid/570", { appId: 570, explicit: true }],
  ["STEAM://RUN/440", { appId: 440, explicit: true }],
  // typed by hand
  ["app 1091500", { appId: 1091500, explicit: true }],
  ["appid: 1091500", { appId: 1091500, explicit: true }],
  ["App ID #1091500", { appId: 1091500, explicit: true }],
  ["app/220", { appId: 220, explicit: true }],
  // a bare number is an app *and* a title
  ["1091500", { appId: 1091500, explicit: false }],
  ["1942", { appId: 1942, explicit: false }],
  ["10", { appId: 10, explicit: false }],
  // titles that merely contain digits stay titles
  ["Metro 2033", null],
  ["NBA 2K24", null],
  ["1080° Snowboarding", null],
  ["198X", null],
  ["Apple Knight 2", null],
  ["Fallout 76", null],
  // not apps: bundles and packages, other stores, nonsense
  ["https://store.steampowered.com/bundle/232/Valve_Complete_Pack/", null],
  ["https://store.steampowered.com/sub/469/", null],
  ["https://www.gog.com/en/game/the_witcher_3_wild_hunt", null],
  ["0", null],
  ["7", null],
  ["12345678901", null],
  ["", null],
];

let failures = 0;
for (const [input, expected] of CASES) {
  const actual = parseSteamAppQuery(input);
  const ok = JSON.stringify(actual) === JSON.stringify(expected);
  if (!ok) failures++;
  console.log(
    `${ok ? "ok  " : "FAIL"} ${JSON.stringify(input)} → ${JSON.stringify(actual)}` +
      (ok ? "" : `  (expected ${JSON.stringify(expected)})`),
  );
}
console.log(`\n${CASES.length - failures}/${CASES.length} passed`);
if (failures > 0) process.exitCode = 1;
