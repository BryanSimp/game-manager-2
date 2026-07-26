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

/**
 * Checklist flavour. 'missions' lists are the ordered main-story beats
 * (missions/chapters/episodes) and are what the time-remaining estimate
 * divides up; 'completion' is the free-form collectibles/endings kind.
 */
export const CHECKLIST_KINDS = ["completion", "missions"] as const;
export type ChecklistKind = (typeof CHECKLIST_KINDS)[number];

/** Which how-long-to-beat figure the remaining-time estimate is based on. */
export const PROGRESS_BASES = ["main", "main_extra", "completionist"] as const;
export type ProgressBasis = (typeof PROGRESS_BASES)[number];
