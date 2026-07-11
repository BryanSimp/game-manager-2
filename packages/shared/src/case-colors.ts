import type { PlatformFamily } from "./constants.js";

/** Real-world retail case colors, keyed by platform name. */
const PLATFORM_CASE_COLORS: Record<string, string> = {
  // cartridge-era cardboard boxes were predominantly black
  NES: "#171717",
  "Super Nintendo": "#171717",
  "Nintendo 64": "#171717",
  "Game Boy": "#171717",
  "Game Boy Color": "#171717",
  "Game Boy Advance": "#5b5f66",
  "Nintendo Switch": "#e60012",
  "Nintendo Switch 2": "#e60012",
  Wii: "#ffffff",
  "Wii U": "#0096c8",
  GameCube: "#3b3178",
  "Nintendo DS": "#ffffff",
  "Nintendo 3DS": "#ffffff",
  "PlayStation": "#1a1a1a",
  "PlayStation 2": "#2e6db4",
  "PlayStation 3": "#1a1a1a",
  "PlayStation 4": "#003791",
  "PlayStation 5": "#ffffff",
  PSP: "#1a1a1a",
  "PS Vita": "#0059ac",
  Xbox: "#107c10",
  "Xbox 360": "#107c10",
  "Xbox One": "#0e5e0e",
  "Xbox Series X|S": "#0c3b0c",
  "Sega Genesis": "#1a1a1a",
  "Sega Saturn": "#1a1a1a",
  "Sega Dreamcast": "#f4f4f0",
};

/** How the physical box is constructed. */
export type BoxStyle = "cardboard" | "dvd" | "jewel";

export interface BoxSpec {
  /** millimetres — real retail box dimensions */
  w: number;
  h: number;
  d: number;
  style: BoxStyle;
  /** platform wordmark shown on the front banner / spine (disc-era cases) */
  wordmark: string | null;
}

/**
 * Real retail box dimensions per platform (width × height × depth, mm).
 * These drive proportionally-correct 3D boxes: an SNES box is landscape
 * cardboard, an N64 box is tall cardboard, a Switch case is slim and tall.
 */
const BOX_SPECS: Record<string, BoxSpec> = {
  NES: { w: 127, h: 178, d: 25, style: "cardboard", wordmark: null },
  "Super Nintendo": { w: 178, h: 127, d: 32, style: "cardboard", wordmark: null },
  // N64 retail boxes are landscape — wider than tall, like SNES
  "Nintendo 64": { w: 190, h: 137, d: 30, style: "cardboard", wordmark: null },
  "Game Boy": { w: 102, h: 127, d: 22, style: "cardboard", wordmark: null },
  "Game Boy Color": { w: 102, h: 127, d: 22, style: "cardboard", wordmark: null },
  "Game Boy Advance": { w: 127, h: 127, d: 22, style: "cardboard", wordmark: null },
  GameCube: { w: 104, h: 146, d: 14, style: "dvd", wordmark: "NINTENDO GAMECUBE" },
  Wii: { w: 135, h: 190, d: 14, style: "dvd", wordmark: "Wii" },
  "Wii U": { w: 135, h: 190, d: 14, style: "dvd", wordmark: "Wii U" },
  "Nintendo Switch": { w: 105, h: 170, d: 11, style: "dvd", wordmark: "NINTENDO SWITCH" },
  "Nintendo Switch 2": { w: 105, h: 170, d: 11, style: "dvd", wordmark: "NINTENDO SWITCH 2" },
  "Nintendo DS": { w: 124, h: 137, d: 16, style: "dvd", wordmark: "NINTENDO DS" },
  "Nintendo 3DS": { w: 124, h: 137, d: 16, style: "dvd", wordmark: "NINTENDO 3DS" },
  PlayStation: { w: 142, h: 125, d: 24, style: "jewel", wordmark: "PlayStation" },
  "PlayStation 2": { w: 135, h: 190, d: 14, style: "dvd", wordmark: "PlayStation.2" },
  "PlayStation 3": { w: 135, h: 172, d: 14, style: "dvd", wordmark: "PLAYSTATION 3" },
  "PlayStation 4": { w: 135, h: 172, d: 14, style: "dvd", wordmark: "PS4" },
  "PlayStation 5": { w: 135, h: 172, d: 14, style: "dvd", wordmark: "PS5" },
  PSP: { w: 105, h: 170, d: 14, style: "dvd", wordmark: "PSP" },
  "PS Vita": { w: 105, h: 135, d: 12, style: "dvd", wordmark: "PSVITA" },
  Xbox: { w: 135, h: 190, d: 14, style: "dvd", wordmark: "XBOX" },
  "Xbox 360": { w: 135, h: 190, d: 14, style: "dvd", wordmark: "XBOX 360" },
  "Xbox One": { w: 135, h: 172, d: 14, style: "dvd", wordmark: "XBOX ONE" },
  "Xbox Series X|S": { w: 135, h: 172, d: 14, style: "dvd", wordmark: "XBOX" },
  "Sega Master System": { w: 128, h: 178, d: 25, style: "cardboard", wordmark: null },
  "Sega Genesis": { w: 128, h: 178, d: 25, style: "jewel", wordmark: "GENESIS" },
  "Sega Saturn": { w: 142, h: 125, d: 24, style: "jewel", wordmark: "SATURN" },
  "Sega Dreamcast": { w: 142, h: 125, d: 24, style: "jewel", wordmark: "Dreamcast" },
  "Sega Game Gear": { w: 128, h: 178, d: 25, style: "cardboard", wordmark: null },
  PC: { w: 135, h: 190, d: 14, style: "dvd", wordmark: "PC DVD" },
};

const DEFAULT_BOX: BoxSpec = { w: 135, h: 190, d: 14, style: "dvd", wordmark: null };

export function boxSpecFor(platformName: string): BoxSpec {
  return BOX_SPECS[platformName] ?? DEFAULT_BOX;
}

const FAMILY_FALLBACK: Record<PlatformFamily, string> = {
  nintendo: "#8f8b85", // cartridge-era cardboard gray
  sony: "#003791",
  xbox: "#107c10",
  pc: "#4b5563",
  sega: "#1a1a1a",
  other: "#52525b",
};

/** Accent color used for platform badges (always saturated, never white). */
export const FAMILY_ACCENT: Record<PlatformFamily, string> = {
  nintendo: "#e60012",
  sony: "#0070d1",
  xbox: "#107c10",
  pc: "#4b5563",
  sega: "#0060a8",
  other: "#52525b",
};

export function caseColorFor(platformName: string, family: PlatformFamily): string {
  return PLATFORM_CASE_COLORS[platformName] ?? FAMILY_FALLBACK[family];
}

/** true when text/logos on this case color need to be dark. */
export function caseColorIsLight(hex: string): boolean {
  const r = parseInt(hex.slice(1, 3), 16);
  const g = parseInt(hex.slice(3, 5), 16);
  const b = parseInt(hex.slice(5, 7), 16);
  return 0.299 * r + 0.587 * g + 0.114 * b > 160;
}
