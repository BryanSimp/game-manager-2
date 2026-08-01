import { eq } from "drizzle-orm";
import { db, schema } from "../src/db/index.js";
import type { PlatformFamily } from "@gm/shared";

/**
 * Curated platform seed with IGDB platform ids where known.
 * `family` groups the consoles page; `sortOrder` is rough release order.
 *
 * `releaseDate` is the first-region hardware launch (Famicom for the NES,
 * Mega Drive for the Genesis…) or the day a storefront opened. `summary` is
 * written here rather than pulled from IGDB because IGDB's platform summaries
 * are frequently empty — IGDB only fills a summary in when this one is null,
 * and supplies the logo (see services/consoles.ts).
 */
const PLATFORMS: Array<{
  name: string;
  abbreviation?: string;
  family: PlatformFamily;
  igdbPlatformId?: number;
  sortOrder: number;
  releaseDate?: string;
  summary?: string;
  /** name of the platform this is a storefront of — PC, for all of them */
  parent?: string;
}> = [
  // Nintendo
  {
    name: "NES",
    family: "nintendo",
    igdbPlatformId: 18,
    sortOrder: 10,
    releaseDate: "1983-07-15",
    summary:
      "Nintendo's 8-bit debut, sold as the Famicom in Japan and the NES elsewhere. It pulled the console market out of the 1983 crash and set the template for the platformer, the action RPG and the side-scrolling adventure.",
  },
  {
    name: "Super Nintendo",
    abbreviation: "SNES",
    family: "nintendo",
    igdbPlatformId: 19,
    sortOrder: 11,
    releaseDate: "1990-11-21",
    summary:
      "The 16-bit follow-up, with a colour palette and sound chip that still define how people picture that era. Home to much of Nintendo's best-regarded back catalogue and the golden age of the JRPG.",
  },
  {
    name: "Nintendo 64",
    abbreviation: "N64",
    family: "nintendo",
    igdbPlatformId: 4,
    sortOrder: 12,
    releaseDate: "1996-06-23",
    summary:
      "Nintendo's first 3D console, and the one that shipped an analogue stick as standard. Cartridges kept load times at zero but cost it most third-party support to the PlayStation.",
  },
  {
    name: "GameCube",
    abbreviation: "GCN",
    family: "nintendo",
    igdbPlatformId: 21,
    sortOrder: 13,
    releaseDate: "2001-09-14",
    summary:
      "A small purple box with a handle, running mini-DVDs. It sold modestly but its library — Wind Waker, Metroid Prime, Melee — has aged unusually well.",
  },
  {
    name: "Wii",
    family: "nintendo",
    igdbPlatformId: 5,
    sortOrder: 14,
    releaseDate: "2006-11-19",
    summary:
      "Motion controls aimed at people who had never bought a console before, and it worked: over 100 million sold. Plays GameCube discs, and its Virtual Console was many players' first taste of the back catalogue.",
  },
  {
    name: "Wii U",
    family: "nintendo",
    igdbPlatformId: 41,
    sortOrder: 15,
    releaseDate: "2012-11-18",
    summary:
      "The tablet-controller console that almost nobody bought. Commercially it was Nintendo's worst home system, but most of its library was rescued by Switch ports.",
  },
  {
    name: "Nintendo Switch",
    abbreviation: "Switch",
    family: "nintendo",
    igdbPlatformId: 130,
    sortOrder: 16,
    releaseDate: "2017-03-03",
    summary:
      "Home console and handheld in one, which turned out to be what everyone wanted — it is among the best-selling systems ever made. Detachable Joy-Con, a dock, and a decade of Nintendo's biggest launches.",
  },
  {
    name: "Nintendo Switch 2",
    abbreviation: "Switch 2",
    family: "nintendo",
    sortOrder: 17,
    releaseDate: "2025-06-05",
    summary:
      "The Switch successor: a bigger screen, far more horsepower, magnetic Joy-Con 2, and backwards compatibility with most of the original Switch library.",
  },
  {
    name: "Game Boy",
    abbreviation: "GB",
    family: "nintendo",
    igdbPlatformId: 33,
    sortOrder: 20,
    releaseDate: "1989-04-21",
    summary:
      "A green-grey screen and AA batteries that lasted for days. It outlived better hardware on battery life and Tetris alone, and made portable gaming a mass market.",
  },
  {
    name: "Game Boy Color",
    abbreviation: "GBC",
    family: "nintendo",
    igdbPlatformId: 22,
    sortOrder: 21,
    releaseDate: "1998-10-21",
    summary:
      "The Game Boy in colour, still playing the original library. Its own headline titles were Pokémon Gold and Silver and the Zelda Oracle pair.",
  },
  {
    name: "Game Boy Advance",
    abbreviation: "GBA",
    family: "nintendo",
    igdbPlatformId: 24,
    sortOrder: 22,
    releaseDate: "2001-03-21",
    summary:
      "Roughly SNES-class power in your pocket, with a huge library of originals, remakes and ports. The later SP and Micro revisions finally added a lit screen.",
  },
  {
    name: "Nintendo DS",
    abbreviation: "DS",
    family: "nintendo",
    igdbPlatformId: 20,
    sortOrder: 23,
    releaseDate: "2004-11-21",
    summary:
      "Two screens, one of them a touchscreen, plus a microphone — hardware odd enough to produce a genuinely strange and inventive library. One of the best-selling systems of all time.",
  },
  {
    name: "Nintendo 3DS",
    abbreviation: "3DS",
    family: "nintendo",
    igdbPlatformId: 37,
    sortOrder: 24,
    releaseDate: "2011-02-26",
    summary:
      "Glasses-free 3D on the top screen, DS backwards compatibility underneath. A shaky launch was rescued by a price cut and a deep library of Nintendo handheld staples.",
  },
  // Sony
  {
    name: "PlayStation",
    abbreviation: "PS1",
    family: "sony",
    igdbPlatformId: 7,
    sortOrder: 30,
    releaseDate: "1994-12-03",
    summary:
      "Sony's first console, born from a collapsed Nintendo CD partnership. Cheap CD-ROM development brought in a wave of studios and made 3D — and the cinematic JRPG — mainstream.",
  },
  {
    name: "PlayStation 2",
    abbreviation: "PS2",
    family: "sony",
    igdbPlatformId: 8,
    sortOrder: 31,
    releaseDate: "2000-03-04",
    summary:
      "The best-selling console ever made, helped along by doubling as an affordable DVD player. Its library is enormous and spans the entire sixth generation.",
  },
  {
    name: "PlayStation 3",
    abbreviation: "PS3",
    family: "sony",
    igdbPlatformId: 9,
    sortOrder: 32,
    releaseDate: "2006-11-11",
    summary:
      "An expensive launch and the awkward Cell processor cost it the early lead, but Blu-ray, free online play and a run of first-party exclusives pulled it back.",
  },
  {
    name: "PlayStation 4",
    abbreviation: "PS4",
    family: "sony",
    igdbPlatformId: 48,
    sortOrder: 33,
    releaseDate: "2013-11-15",
    summary:
      "A straightforward, developer-friendly x86 machine that dominated its generation, carried by a famously strong run of single-player exclusives.",
  },
  {
    name: "PlayStation 5",
    abbreviation: "PS5",
    family: "sony",
    igdbPlatformId: 167,
    sortOrder: 34,
    releaseDate: "2020-11-12",
    summary:
      "Custom SSD streaming that all but removed load times, plus the DualSense controller's haptics and adaptive triggers. Launched into a two-year supply shortage.",
  },
  {
    name: "PSP",
    family: "sony",
    igdbPlatformId: 38,
    sortOrder: 35,
    releaseDate: "2004-12-12",
    summary:
      "Sony's first handheld: a widescreen media player that ran console-scale games off UMD discs. Monster Hunter made it a phenomenon in Japan.",
  },
  {
    name: "PS Vita",
    abbreviation: "Vita",
    family: "sony",
    igdbPlatformId: 46,
    sortOrder: 36,
    releaseDate: "2011-12-17",
    summary:
      "Beautiful OLED hardware, dual analogue sticks, and proprietary memory cards that priced people out. Abandoned by Sony, it became a haven for indies and Japanese niche releases.",
  },
  // Xbox
  {
    name: "Xbox",
    family: "xbox",
    igdbPlatformId: 11,
    sortOrder: 40,
    releaseDate: "2001-11-15",
    summary:
      "Microsoft's entry into consoles: a hard drive as standard, a built-in ethernet port, and Halo. Xbox Live turned online console play from a novelty into the default.",
  },
  {
    name: "Xbox 360",
    family: "xbox",
    igdbPlatformId: 12,
    sortOrder: 41,
    releaseDate: "2005-11-22",
    summary:
      "A year's head start on the PS3 and a strong online service made this Microsoft's high-water mark, despite the Red Ring of Death failures. Achievements started here.",
  },
  {
    name: "Xbox One",
    family: "xbox",
    igdbPlatformId: 49,
    sortOrder: 42,
    releaseDate: "2013-11-22",
    summary:
      "A muddled TV-first reveal cost it the generation, but it recovered through backwards compatibility and the launch of Game Pass.",
  },
  {
    name: "Xbox Series X|S",
    abbreviation: "Series X|S",
    family: "xbox",
    igdbPlatformId: 169,
    sortOrder: 43,
    releaseDate: "2020-11-10",
    summary:
      "Two machines at two prices, sharing a library. Quick Resume, four generations of backwards compatibility, and Game Pass as the centre of the pitch.",
  },
  // PC and its storefronts. The stores are *children* of PC (`parent`), so a
  // game bought on Steam is still a PC game everywhere that counts platforms;
  // only the badge and the consoles page care which store it came from.
  {
    name: "PC",
    family: "pc",
    igdbPlatformId: 6,
    sortOrder: 50,
    summary:
      "The catch-all for computer games — use it on its own when where you bought a copy doesn't matter, or pick one of its storefronts when it does.",
  },
  {
    name: "Steam",
    family: "pc",
    parent: "PC",
    sortOrder: 51,
    releaseDate: "2003-09-12",
    summary:
      "Valve's storefront, launched to patch Counter-Strike and now the default home of PC gaming. Cloud saves, workshop mods, achievements, and the sales everyone plans around.",
  },
  {
    name: "Epic Games Store",
    abbreviation: "Epic",
    family: "pc",
    parent: "PC",
    sortOrder: 52,
    releaseDate: "2018-12-06",
    summary:
      "Epic's storefront, built around a smaller developer cut, timed exclusives, and a long-running run of free weekly games.",
  },
  {
    name: "GOG",
    family: "pc",
    parent: "PC",
    sortOrder: 53,
    releaseDate: "2008-09-19",
    summary:
      "CD Projekt's DRM-free store. Made its name getting decades-old PC games running on modern hardware, and still sells everything without a client requirement.",
  },
  {
    name: "Battle.net",
    abbreviation: "Blizzard",
    family: "pc",
    parent: "PC",
    sortOrder: 54,
    releaseDate: "1996-12-31",
    summary:
      "Blizzard's own service, launched alongside Diablo and now the launcher for everything Blizzard and Activision publishes on PC.",
  },
  {
    name: "Origin",
    family: "pc",
    parent: "PC",
    sortOrder: 55,
    releaseDate: "2011-06-03",
    summary:
      "EA's old PC client, retired in favour of the EA App — kept here because plenty of libraries were bought on it and still say Origin.",
  },
  {
    name: "EA App",
    family: "pc",
    parent: "PC",
    sortOrder: 56,
    releaseDate: "2022-09-27",
    summary:
      "EA's PC launcher and store, the replacement for Origin. Home of EA Play and anything EA keeps off other storefronts.",
  },
  {
    name: "Ubisoft Connect",
    abbreviation: "Ubisoft",
    family: "pc",
    parent: "PC",
    sortOrder: 57,
    releaseDate: "2020-10-29",
    summary:
      "Ubisoft's storefront and launcher, formerly Uplay. Required alongside Steam or Epic for most Ubisoft PC releases.",
  },
  {
    name: "Xbox / Microsoft Store",
    abbreviation: "Xbox PC",
    family: "pc",
    parent: "PC",
    sortOrder: 58,
    releaseDate: "2012-10-26",
    summary:
      "The Xbox app and Windows storefront, and where PC Game Pass installs land. Shares entitlements with the console for anything published as Play Anywhere.",
  },
  {
    name: "itch.io",
    abbreviation: "itch",
    family: "pc",
    parent: "PC",
    sortOrder: 59,
    releaseDate: "2013-03-03",
    summary:
      "An open marketplace for independent and experimental games, jam entries and pay-what-you-want releases — much of it available nowhere else.",
  },
  // Sega
  {
    name: "Sega Master System",
    abbreviation: "SMS",
    family: "sega",
    igdbPlatformId: 64,
    sortOrder: 60,
    releaseDate: "1985-10-20",
    summary:
      "Technically ahead of the NES and soundly beaten by it in Japan and the US — but a genuine hit in Europe and Brazil, where it stayed on sale for decades.",
  },
  {
    name: "Sega Genesis",
    abbreviation: "Genesis",
    family: "sega",
    igdbPlatformId: 29,
    sortOrder: 61,
    releaseDate: "1988-10-29",
    summary:
      "The Mega Drive outside North America, and the console that made Sega a real rival to Nintendo. Blast processing, Sonic, and arcade ports that actually felt like the arcade.",
  },
  {
    name: "Sega Saturn",
    abbreviation: "Saturn",
    family: "sega",
    igdbPlatformId: 32,
    sortOrder: 62,
    releaseDate: "1994-11-22",
    summary:
      "A surprise early US launch and difficult dual-CPU hardware sank it against the PlayStation, but its 2D fighters and shmups are still sought after.",
  },
  {
    name: "Sega Dreamcast",
    abbreviation: "Dreamcast",
    family: "sega",
    igdbPlatformId: 23,
    sortOrder: 63,
    releaseDate: "1998-11-27",
    summary:
      "A built-in modem, the VMU memory card with its own screen, and arcade-perfect ports. Sega's last console, discontinued after barely two years.",
  },
  {
    name: "Sega Game Gear",
    abbreviation: "Game Gear",
    family: "sega",
    igdbPlatformId: 35,
    sortOrder: 64,
    releaseDate: "1990-10-06",
    summary:
      "A backlit colour screen years before Nintendo managed one, paid for with six AA batteries and about four hours of play.",
  },
];

async function main() {
  console.log(`Seeding ${PLATFORMS.length} platforms…`);
  for (const p of PLATFORMS) {
    await db
      .insert(schema.platforms)
      .values({
        // parents are linked in a second pass, once every row exists
        name: p.name,
        abbreviation: p.abbreviation,
        family: p.family,
        igdbPlatformId: p.igdbPlatformId,
        sortOrder: p.sortOrder,
        releaseDate: p.releaseDate,
        summary: p.summary,
      })
      .onConflictDoUpdate({
        target: schema.platforms.name,
        set: {
          abbreviation: p.abbreviation,
          family: p.family,
          igdbPlatformId: p.igdbPlatformId,
          sortOrder: p.sortOrder,
          releaseDate: p.releaseDate,
          // the curated copy wins over anything IGDB filled in earlier
          summary: p.summary,
        },
      });
  }

  // second pass: hang the storefronts off their parent platform
  const rows = await db
    .select({ id: schema.platforms.id, name: schema.platforms.name })
    .from(schema.platforms);
  const idByName = new Map(rows.map((r) => [r.name, r.id]));
  for (const p of PLATFORMS) {
    const parentId = p.parent ? (idByName.get(p.parent) ?? null) : null;
    await db
      .update(schema.platforms)
      .set({ parentPlatformId: parentId })
      .where(eq(schema.platforms.name, p.name));
  }

  console.log("Seed complete. (First registered account becomes admin.)");
  process.exit(0);
}

main().catch((err) => {
  console.error("Seed failed:", err);
  process.exit(1);
});
