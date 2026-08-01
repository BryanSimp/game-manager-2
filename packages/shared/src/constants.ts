/** Library statuses. Pinned to five — v1 had drift between docs and code. */
/**
 * Built-in categories. Everyone has these and they can't be deleted, but
 * users can add their own alongside (see `custom_categories`), so a stored
 * category is a *string*, not an enum: either one of these keys or the id of
 * one of the user's custom categories.
 *
 * 'uncategorized' is a real value rather than a null column — nullable status
 * would have rippled through every filter, dashboard and shelf query for no
 * gain. It renders as no badge at all.
 */
export const GAME_STATUSES = [
  "uncategorized",
  "wishlist",
  "backlog",
  "playing",
  "finished",
  "shelved",
  "dropped",
] as const;
export type GameStatus = (typeof GAME_STATUSES)[number];

/** Built-in labels and default colours, in display order. */
export const BUILTIN_CATEGORIES: Array<{ key: GameStatus; label: string; color: string }> = [
  { key: "uncategorized", label: "Uncategorized", color: "#71717a" },
  { key: "wishlist", label: "Wishlist", color: "#38bdf8" },
  { key: "backlog", label: "Backlog", color: "#fbbf24" },
  { key: "playing", label: "Playing", color: "#818cf8" },
  { key: "finished", label: "Finished", color: "#34d399" },
  { key: "shelved", label: "Shelved", color: "#a78bfa" },
  { key: "dropped", label: "Dropped", color: "#fb7185" },
];

export function isBuiltinCategory(key: string): key is GameStatus {
  return (GAME_STATUSES as readonly string[]).includes(key);
}

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

/**
 * Friend requests are accepted before anything is shared — a friend code
 * alone never grants access to a library.
 */
export const FRIENDSHIP_STATUSES = ["pending", "accepted"] as const;
export type FriendshipStatus = (typeof FRIENDSHIP_STATUSES)[number];

/** Which how-long-to-beat figure the remaining-time estimate is based on. */
export const PROGRESS_BASES = ["main", "main_extra", "completionist"] as const;
export type ProgressBasis = (typeof PROGRESS_BASES)[number];
