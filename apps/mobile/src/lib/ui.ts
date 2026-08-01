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

/** `#rrggbb` plus an alpha byte — React Native accepts 8-digit hex. */
function withAlpha(color: string, alpha: number): string {
  const byte = Math.round(Math.min(1, Math.max(0, alpha)) * 255);
  return `${color}${byte.toString(16).padStart(2, "0")}`;
}

/**
 * Style for a category key. Categories are user-extensible on web, so mobile
 * may see a custom id it has no entry for — fall back rather than crash.
 * `opacity` is the badge-opacity preference in percent, so a badge looks the
 * same here as it does on the web app.
 */
export function statusStyle(status: string, opacity = 100): StatusStyle {
  const base = STATUS_COLORS[status as GameStatus] ?? UNKNOWN;
  if (opacity >= 100) return base;
  const alpha = opacity / 100;
  return {
    ...base,
    bg: withAlpha(base.bg, alpha),
    text: withAlpha(base.text, alpha),
  };
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
