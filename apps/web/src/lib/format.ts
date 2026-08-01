import type { CSSProperties } from "react";
import { BUILTIN_CATEGORIES, type CategoryView, type GameStatus, type Preferences } from "@gm/shared";

/**
 * Built-in category labels and dot colours. Categories are arbitrary strings
 * now (a built-in key or a custom category id), so every lookup goes through a
 * helper that falls back rather than indexing this directly. Chip colours live
 * in `statusChip`, which honours the user's colour and opacity preferences.
 */
export const STATUS_META: Record<GameStatus, { label: string; dot: string }> = {
  uncategorized: { label: "Uncategorized", dot: "bg-zinc-500" },
  shelved: { label: "Shelved", dot: "bg-violet-400" },
  wishlist: { label: "Wishlist", dot: "bg-sky-400" },
  backlog: { label: "Backlog", dot: "bg-amber-400" },
  playing: { label: "Playing", dot: "bg-indigo-400" },
  finished: { label: "Finished", dot: "bg-emerald-400" },
  dropped: { label: "Dropped", dot: "bg-rose-400" },
};

const NEUTRAL = { label: "Uncategorized", dot: "bg-zinc-500" };

/** Display name for a category key, preferring the server's resolved list. */
export function statusLabel(status: string, categories?: CategoryView[]): string {
  const found = categories?.find((c) => c.key === status);
  if (found) return found.label;
  return STATUS_META[status as GameStatus]?.label ?? NEUTRAL.label;
}

const DEFAULT_HEX: Record<string, string> = Object.fromEntries(
  BUILTIN_CATEGORIES.map((c) => [c.key, c.color]),
);

/** `#rrggbb` plus an alpha byte, clamped. */
function withAlpha(color: string, alpha: number): string {
  const byte = Math.round(Math.min(1, Math.max(0, alpha)) * 255);
  return `${color}${byte.toString(16).padStart(2, "0")}`;
}

/** Badge opacity as a 0–1 multiplier; full strength until a preference says otherwise. */
export function badgeAlpha(prefs: Preferences | undefined): number {
  return (prefs?.badgeOpacity ?? 100) / 100;
}

/** The colour a category is drawn in — custom list first, then user override, then the built-in default. */
export function categoryColor(
  status: string,
  prefs: Preferences | undefined,
  categories?: CategoryView[],
): string {
  const found = categories?.find((c) => c.key === status);
  if (found && !found.builtIn) return found.color;
  return prefs?.statusColors?.[status] ?? found?.color ?? DEFAULT_HEX[status] ?? "#71717a";
}

/**
 * Chip appearance for a category: a tint of its colour, faded by the badge
 * opacity preference. Everything that draws a category badge goes through
 * here, which is what keeps the setting consistent across every page.
 */
export function statusChip(
  status: string,
  prefs: Preferences | undefined,
  categories?: CategoryView[],
): { className: string; style?: CSSProperties } {
  const color = categoryColor(status, prefs, categories);
  const alpha = badgeAlpha(prefs);
  return {
    className: "border",
    style: {
      backgroundColor: withAlpha(color, 0.15 * alpha),
      color: withAlpha(color, alpha),
      borderColor: withAlpha(color, 0.4 * alpha),
    },
  };
}

export function formatHours(seconds: number | null): string | null {
  if (!seconds) return null;
  const hours = seconds / 3600;
  if (hours < 1) return `${Math.round(seconds / 60)}m`;
  return `${Math.round(hours * 2) / 2}h`;
}

/** Light title cleanup for pasted lists (full OCR noise filter arrives in Phase 3). */
export function cleanTitle(raw: string): string {
  return raw
    .replace(/[™®©]/g, "")
    .replace(/\s+/g, " ")
    .trim();
}
