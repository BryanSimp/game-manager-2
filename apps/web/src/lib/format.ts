import type { CSSProperties } from "react";
import type { CategoryView, GameStatus, Preferences } from "@gm/shared";

/**
 * Built-in chip styling. Categories are arbitrary strings now (a built-in key
 * or a custom category id), so every lookup goes through a helper that falls
 * back rather than indexing this directly.
 */
export const STATUS_META: Record<GameStatus, { label: string; classes: string; dot: string }> = {
  uncategorized: {
    label: "Uncategorized",
    classes: "bg-zinc-800 text-zinc-400 border-zinc-700",
    dot: "bg-zinc-500",
  },
  shelved: {
    label: "Shelved",
    classes: "bg-violet-950 text-violet-300 border-violet-800",
    dot: "bg-violet-400",
  },
  wishlist: { label: "Wishlist", classes: "bg-sky-950 text-sky-300 border-sky-800", dot: "bg-sky-400" },
  backlog: { label: "Backlog", classes: "bg-amber-950 text-amber-300 border-amber-800", dot: "bg-amber-400" },
  playing: { label: "Playing", classes: "bg-indigo-950 text-indigo-300 border-indigo-800", dot: "bg-indigo-400" },
  finished: { label: "Finished", classes: "bg-emerald-950 text-emerald-300 border-emerald-800", dot: "bg-emerald-400" },
  dropped: { label: "Dropped", classes: "bg-rose-950 text-rose-300 border-rose-800", dot: "bg-rose-400" },
};

const NEUTRAL = { label: "Uncategorized", classes: "bg-zinc-800 text-zinc-400 border-zinc-700", dot: "bg-zinc-500" };

/** Display name for a category key, preferring the server's resolved list. */
export function statusLabel(status: string, categories?: CategoryView[]): string {
  const found = categories?.find((c) => c.key === status);
  if (found) return found.label;
  return STATUS_META[status as GameStatus]?.label ?? NEUTRAL.label;
}

function tinted(color: string): { className: string; style: CSSProperties } {
  return {
    className: "border",
    style: {
      backgroundColor: `${color}26`,
      color,
      borderColor: `${color}66`,
    },
  };
}

/**
 * Chip appearance for a category. A custom category's colour comes from the
 * resolved list; for built-ins a user-picked colour beats the default classes.
 */
export function statusChip(
  status: string,
  prefs: Preferences | undefined,
  categories?: CategoryView[],
): { className: string; style?: CSSProperties } {
  const found = categories?.find((c) => c.key === status);
  if (found && !found.builtIn) return tinted(found.color);

  const custom = prefs?.statusColors?.[status] ?? (found?.builtIn ? found.color : undefined);
  const builtin = STATUS_META[status as GameStatus];
  if (!custom) return { className: (builtin ?? NEUTRAL).classes };
  return tinted(custom);
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
