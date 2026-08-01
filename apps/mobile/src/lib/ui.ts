import type { GameStatus } from "@gm/shared";
import { API_URL } from "./config";

type StatusStyle = { bg: string; text: string; label: string };

export const STATUS_COLORS: Record<GameStatus, StatusStyle> = {
  uncategorized: { bg: "#27272a", text: "#a1a1aa", label: "Uncategorized" },
  wishlist: { bg: "#082f49", text: "#7dd3fc", label: "Wishlist" },
  backlog: { bg: "#451a03", text: "#fcd34d", label: "Backlog" },
  playing: { bg: "#1e1b4b", text: "#a5b4fc", label: "Playing" },
  finished: { bg: "#022c22", text: "#6ee7b7", label: "Finished" },
  shelved: { bg: "#2e1065", text: "#c4b5fd", label: "Shelved" },
  dropped: { bg: "#4c0519", text: "#fda4af", label: "Dropped" },
};

const UNKNOWN: StatusStyle = { bg: "#27272a", text: "#a1a1aa", label: "Other" };

/**
 * Style for a category key. Categories are user-extensible on web, so mobile
 * may see a custom id it has no entry for — fall back rather than crash.
 */
export function statusStyle(status: string): StatusStyle {
  return STATUS_COLORS[status as GameStatus] ?? UNKNOWN;
}

/** coverSrc from the API is relative for cached images, absolute for IGDB. */
export function resolveImage(src: string | null): string | null {
  if (!src) return null;
  return src.startsWith("http") ? src : `${API_URL}${src}`;
}

export function formatHours(seconds: number | null): string | null {
  if (!seconds) return null;
  const hours = seconds / 3600;
  if (hours < 1) return `${Math.round(seconds / 60)}m`;
  return `${Math.round(hours * 2) / 2}h`;
}
