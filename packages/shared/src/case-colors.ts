import type { PlatformFamily } from "./constants.js";

/** Real-world retail case colors, keyed by platform name. */
const PLATFORM_CASE_COLORS: Record<string, string> = {
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
