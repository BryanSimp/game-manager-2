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
 * Checklist flavour.
 *  - 'missions'     — ordered main-story beats, optionally grouped into
 *                     chapters. The only kind the time estimate divides up.
 *  - 'side_quests'  — optional content, tracked but deliberately untimed:
 *                     how much side content you do is up to you, so pinning
 *                     an estimate to it would be inventing a number.
 *  - 'completion'   — free-form collectibles/endings lists.
 */
export const CHECKLIST_KINDS = ["completion", "missions", "side_quests"] as const;
export type ChecklistKind = (typeof CHECKLIST_KINDS)[number];

/** Lists shown on the Progress tab, in order, with their headings. */
export const MISSION_LIST_KINDS = [
  { kind: "missions" as const, label: "Main story", timed: true },
  { kind: "side_quests" as const, label: "Side quests", timed: false },
];

/** Which how-long-to-beat figure the remaining-time estimate is based on. */
export const PROGRESS_BASES = ["main", "main_extra", "completionist"] as const;
export type ProgressBasis = (typeof PROGRESS_BASES)[number];
