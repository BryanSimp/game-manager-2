import { db, schema } from "../src/db/index.js";
import type { PlatformFamily } from "@gm/shared";

/**
 * Curated platform seed with IGDB platform ids where known.
 * `family` drives virtual-shelf grouping; `sortOrder` is rough release order.
 */
const PLATFORMS: Array<{
  name: string;
  abbreviation?: string;
  family: PlatformFamily;
  igdbPlatformId?: number;
  sortOrder: number;
}> = [
  // Nintendo
  { name: "NES", family: "nintendo", igdbPlatformId: 18, sortOrder: 10 },
  { name: "Super Nintendo", abbreviation: "SNES", family: "nintendo", igdbPlatformId: 19, sortOrder: 11 },
  { name: "Nintendo 64", abbreviation: "N64", family: "nintendo", igdbPlatformId: 4, sortOrder: 12 },
  { name: "GameCube", abbreviation: "GCN", family: "nintendo", igdbPlatformId: 21, sortOrder: 13 },
  { name: "Wii", family: "nintendo", igdbPlatformId: 5, sortOrder: 14 },
  { name: "Wii U", family: "nintendo", igdbPlatformId: 41, sortOrder: 15 },
  { name: "Nintendo Switch", abbreviation: "Switch", family: "nintendo", igdbPlatformId: 130, sortOrder: 16 },
  { name: "Nintendo Switch 2", abbreviation: "Switch 2", family: "nintendo", sortOrder: 17 },
  { name: "Game Boy", abbreviation: "GB", family: "nintendo", igdbPlatformId: 33, sortOrder: 20 },
  { name: "Game Boy Color", abbreviation: "GBC", family: "nintendo", igdbPlatformId: 22, sortOrder: 21 },
  { name: "Game Boy Advance", abbreviation: "GBA", family: "nintendo", igdbPlatformId: 24, sortOrder: 22 },
  { name: "Nintendo DS", abbreviation: "DS", family: "nintendo", igdbPlatformId: 20, sortOrder: 23 },
  { name: "Nintendo 3DS", abbreviation: "3DS", family: "nintendo", igdbPlatformId: 37, sortOrder: 24 },
  // Sony
  { name: "PlayStation", abbreviation: "PS1", family: "sony", igdbPlatformId: 7, sortOrder: 30 },
  { name: "PlayStation 2", abbreviation: "PS2", family: "sony", igdbPlatformId: 8, sortOrder: 31 },
  { name: "PlayStation 3", abbreviation: "PS3", family: "sony", igdbPlatformId: 9, sortOrder: 32 },
  { name: "PlayStation 4", abbreviation: "PS4", family: "sony", igdbPlatformId: 48, sortOrder: 33 },
  { name: "PlayStation 5", abbreviation: "PS5", family: "sony", igdbPlatformId: 167, sortOrder: 34 },
  { name: "PSP", family: "sony", igdbPlatformId: 38, sortOrder: 35 },
  { name: "PS Vita", abbreviation: "Vita", family: "sony", igdbPlatformId: 46, sortOrder: 36 },
  // Xbox
  { name: "Xbox", family: "xbox", igdbPlatformId: 11, sortOrder: 40 },
  { name: "Xbox 360", family: "xbox", igdbPlatformId: 12, sortOrder: 41 },
  { name: "Xbox One", family: "xbox", igdbPlatformId: 49, sortOrder: 42 },
  { name: "Xbox Series X|S", abbreviation: "Series X|S", family: "xbox", igdbPlatformId: 169, sortOrder: 43 },
  // PC
  { name: "PC", family: "pc", igdbPlatformId: 6, sortOrder: 50 },
  // Sega
  { name: "Sega Master System", abbreviation: "SMS", family: "sega", igdbPlatformId: 64, sortOrder: 60 },
  { name: "Sega Genesis", abbreviation: "Genesis", family: "sega", igdbPlatformId: 29, sortOrder: 61 },
  { name: "Sega Saturn", abbreviation: "Saturn", family: "sega", igdbPlatformId: 32, sortOrder: 62 },
  { name: "Sega Dreamcast", abbreviation: "Dreamcast", family: "sega", igdbPlatformId: 23, sortOrder: 63 },
  { name: "Sega Game Gear", abbreviation: "Game Gear", family: "sega", igdbPlatformId: 35, sortOrder: 64 },
];

async function main() {
  console.log(`Seeding ${PLATFORMS.length} platforms…`);
  for (const p of PLATFORMS) {
    await db
      .insert(schema.platforms)
      .values({
        name: p.name,
        abbreviation: p.abbreviation,
        family: p.family,
        igdbPlatformId: p.igdbPlatformId,
        sortOrder: p.sortOrder,
      })
      .onConflictDoUpdate({
        target: schema.platforms.name,
        set: {
          abbreviation: p.abbreviation,
          family: p.family,
          igdbPlatformId: p.igdbPlatformId,
          sortOrder: p.sortOrder,
        },
      });
  }
  console.log("Seed complete. (First registered account becomes admin.)");
  process.exit(0);
}

main().catch((err) => {
  console.error("Seed failed:", err);
  process.exit(1);
});
