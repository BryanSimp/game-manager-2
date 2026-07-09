import type { GameStatus } from "@gm/shared";

export const STATUS_META: Record<GameStatus, { label: string; classes: string; dot: string }> = {
  wishlist: { label: "Wishlist", classes: "bg-sky-950 text-sky-300 border-sky-800", dot: "bg-sky-400" },
  backlog: { label: "Backlog", classes: "bg-amber-950 text-amber-300 border-amber-800", dot: "bg-amber-400" },
  playing: { label: "Playing", classes: "bg-indigo-950 text-indigo-300 border-indigo-800", dot: "bg-indigo-400" },
  finished: { label: "Finished", classes: "bg-emerald-950 text-emerald-300 border-emerald-800", dot: "bg-emerald-400" },
  dropped: { label: "Dropped", classes: "bg-rose-950 text-rose-300 border-rose-800", dot: "bg-rose-400" },
};

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
