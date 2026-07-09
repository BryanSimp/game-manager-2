import type { GameStatus } from "@gm/shared";
import { API_URL } from "./config";

export const STATUS_COLORS: Record<GameStatus, { bg: string; text: string; label: string }> = {
  wishlist: { bg: "#082f49", text: "#7dd3fc", label: "Wishlist" },
  backlog: { bg: "#451a03", text: "#fcd34d", label: "Backlog" },
  playing: { bg: "#1e1b4b", text: "#a5b4fc", label: "Playing" },
  finished: { bg: "#022c22", text: "#6ee7b7", label: "Finished" },
  dropped: { bg: "#4c0519", text: "#fda4af", label: "Dropped" },
};

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
