/** Library statuses. Pinned to five — v1 had drift between docs and code. */
export const GAME_STATUSES = [
  "wishlist",
  "backlog",
  "playing",
  "finished",
  "dropped",
] as const;
export type GameStatus = (typeof GAME_STATUSES)[number];

/** How a game is owned on a platform. */
export const OWNERSHIP_FORMATS = ["physical", "digital"] as const;
export type OwnershipFormat = (typeof OWNERSHIP_FORMATS)[number];

/** Console families — drives virtual-shelf grouping. */
export const PLATFORM_FAMILIES = [
  "nintendo",
  "sony",
  "xbox",
  "pc",
  "sega",
  "other",
] as const;
export type PlatformFamily = (typeof PLATFORM_FAMILIES)[number];

export const USER_ROLES = ["admin", "user"] as const;
export type UserRole = (typeof USER_ROLES)[number];
