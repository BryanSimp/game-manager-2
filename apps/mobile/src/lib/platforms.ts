import type { ConsoleSummary, OwnedPlatform } from "@gm/shared";

/**
 * A game filed under a storefront (Steam) is still a game on its parent
 * platform (PC), so anything that counts or filters by platform rolls
 * children up into their parent — the same rule the web app applies.
 */
export function onPlatform(platforms: OwnedPlatform[], platformId: string): boolean {
  return platforms.some((p) => p.platformId === platformId || p.parentPlatformId === platformId);
}

export interface ConsoleGroup {
  console: ConsoleSummary;
  /** stores that sell for this platform — PC's Steam, GOG, Epic… */
  storefronts: ConsoleSummary[];
}

/**
 * Consoles as the UI wants them: one entry per real platform, with its
 * storefronts hanging off it. Sub-platforms are one level deep, so a
 * storefront whose parent isn't on your list is promoted rather than dropped.
 */
export function groupConsoles(rows: ConsoleSummary[]): ConsoleGroup[] {
  const parents = rows.filter((row) => !row.platform.parentPlatformId);
  const parentIds = new Set(parents.map((row) => row.platform.id));
  const orphans = rows.filter(
    (row) => row.platform.parentPlatformId && !parentIds.has(row.platform.parentPlatformId),
  );

  return [...parents, ...orphans].map((row) => ({
    console: row,
    storefronts: rows.filter((child) => child.platform.parentPlatformId === row.platform.id),
  }));
}

/** "1996-06-23" → "23 June 1996". */
export function formatReleaseDate(date: string | null): string | null {
  if (!date) return null;
  const parsed = new Date(`${date}T00:00:00Z`);
  if (Number.isNaN(parsed.getTime())) return date;
  return parsed.toLocaleDateString(undefined, {
    day: "numeric",
    month: "long",
    year: "numeric",
    timeZone: "UTC",
  });
}
