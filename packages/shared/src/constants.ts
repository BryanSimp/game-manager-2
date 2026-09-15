/** Library statuses. Pinned to five — v1 had drift between docs and code. */
/**
 * Built-in categories. Everyone has these and they can't be deleted, but
 * users can add their own alongside (see `custom_categories`), so a stored
 * category is a *string*, not an enum: either one of these keys or the id of
 * one of the user's custom categories.
 *
 * 'uncategorized' is a real value rather than a null column — nullable status
 * would have rippled through every filter and dashboard query for no
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

/** Console families — groups the consoles page and every platform picker. */
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
 *                     chapters. The only kind the time estimate divides up,
 *                     and you get at most one per game.
 *  - 'side_quests'  — every other list you keep for a game (side quests,
 *                     collectibles, endings…). Unlimited, and deliberately
 *                     untimed: how much side content you do is up to you, so
 *                     pinning an estimate to it would be inventing a number.
 *                     The list's own title is what users see — the kind is
 *                     just "not the main story".
 *  - 'completion'   — the original free-form flavour. Migration 0020 folded
 *                     every one of these into 'side_quests', so the enum
 *                     value survives but backs nothing.
 */
export const CHECKLIST_KINDS = ["completion", "missions", "side_quests"] as const;
export type ChecklistKind = (typeof CHECKLIST_KINDS)[number];

/** The one timed list per game — what `estimateProgress` divides up. */
export const MAIN_LIST_KIND = "missions" as const;
/** Everything after it. New lists are always created as this kind. */
export const EXTRA_LIST_KIND = "side_quests" as const;

export function isMainList(kind: ChecklistKind): boolean {
  return kind === MAIN_LIST_KIND;
}

/**
 * Friend requests are accepted before anything is shared — a friend code
 * alone never grants access to a library.
 */
export const FRIENDSHIP_STATUSES = ["pending", "accepted"] as const;
export type FriendshipStatus = (typeof FRIENDSHIP_STATUSES)[number];

/** Which how-long-to-beat figure the remaining-time estimate is based on. */
export const PROGRESS_BASES = ["main", "main_extra", "completionist"] as const;
export type ProgressBasis = (typeof PROGRESS_BASES)[number];

/**
 * Where the source lives. The repo is public, so every claim the site makes
 * about self-hosting can link straight at the thing you'd clone — one
 * constant rather than a URL typed out on each page that mentions it.
 */
export const GITHUB_REPO_URL = "https://github.com/BryanSimp/game-manager-2";

/**
 * What happens to a list or collection the moment you create it.
 *
 *  - `manual`  — private until you press Publish. The original behaviour.
 *  - `never`   — private, and the publish control is gone: the API refuses to
 *                publish at all. For people who never intend to share.
 *  - `always`  — published on creation, so sharing isn't a second step.
 *
 * It governs what *you* create and nothing else. An adopted copy of someone
 * else's work starts private under every mode, because publishing their work
 * is their call — and switching modes never reaches back and republishes or
 * unpublishes what already exists.
 */
export const PUBLISH_MODES = ["manual", "never", "always"] as const;
export type PublishMode = (typeof PUBLISH_MODES)[number];

export const PUBLISH_MODE_LABELS: Record<PublishMode, { label: string; blurb: string }> = {
  manual: {
    label: "Ask me",
    blurb: "New lists and collections start private. Publish them one at a time.",
  },
  never: {
    label: "Never publish",
    blurb: "Nothing you make is ever shared, and the publish button is hidden.",
  },
  always: {
    label: "Publish automatically",
    blurb: "Everything you create is shared as soon as it exists.",
  },
};

/**
 * What a stored link between two games *is*. Each row is directional —
 * `game_id` is the base, `related_game_id` hangs off it:
 *
 *  - `dlc`    — the related game is DLC (or an expansion) for the base
 *  - `sequel` — the related game follows the base. There is no `prequel`
 *               kind: "A is the prequel to B" is the same fact as "B is the
 *               sequel to A", and storing it one way is what lets each game's
 *               page show its half without the two ever disagreeing.
 *  - `remake` — the related game remakes *or* remasters the base. One kind,
 *               because telling a rebuild from a polish was a decision to make
 *               every time you linked something, for a distinction nothing in
 *               the app acts on. Migration 0027 folded `remaster` into it.
 *
 * The UI never speaks in kinds — see `GAME_LINK_ROLES`.
 */
export const GAME_LINK_KINDS = ["dlc", "sequel", "remake"] as const;
export type GameLinkKind = (typeof GAME_LINK_KINDS)[number];

/**
 * What the *other* game is to the one you're looking at. A kind read from one
 * end: the same `dlc` row is a `dlc` role on the base game's page and a
 * `base_game` role on the DLC's page.
 *
 * In display order. The two that describe what a game *is* — DLC for
 * something, a remake of something — lead, and only appear when filled; the
 * four you add (`primary`) are always shown, in the order they were asked for.
 */
export const GAME_LINK_ROLES = [
  "base_game",
  "original",
  "dlc",
  "prequel",
  "sequel",
  "remake",
] as const;
export type GameLinkRole = (typeof GAME_LINK_ROLES)[number];

export interface GameLinkRoleMeta {
  kind: GameLinkKind;
  /**
   * Which column of the stored row holds the game whose page you're on:
   * `base` for the roles that hang things off it, `related` for the ones that
   * say what it hangs off.
   */
  side: "base" | "related";
  /** the same link as seen from the other game's page */
  inverse: GameLinkRole;
  /** always shown as a section, and first in the add menu */
  primary: boolean;
  /** section heading */
  section: string;
  /** add-menu label */
  singular: string;
  /** what picking this role says about the game you pick */
  hint: string;
}

export const GAME_LINK_ROLE_META: Record<GameLinkRole, GameLinkRoleMeta> = {
  dlc: {
    kind: "dlc",
    side: "base",
    inverse: "base_game",
    primary: true,
    section: "DLC",
    singular: "DLC",
    hint: "DLC or an expansion for this game",
  },
  prequel: {
    kind: "sequel",
    side: "related",
    inverse: "sequel",
    primary: true,
    section: "Prequels",
    singular: "Prequel",
    hint: "Comes before this game",
  },
  sequel: {
    kind: "sequel",
    side: "base",
    inverse: "prequel",
    primary: true,
    section: "Sequels",
    singular: "Sequel",
    hint: "Follows this game",
  },
  remake: {
    kind: "remake",
    side: "base",
    inverse: "original",
    primary: true,
    section: "Remakes & remasters",
    singular: "Remake / Remaster",
    hint: "A remake or remaster of this game",
  },
  base_game: {
    kind: "dlc",
    side: "related",
    inverse: "dlc",
    primary: false,
    section: "Base game",
    singular: "Base game",
    hint: "The game this one is DLC for",
  },
  original: {
    kind: "remake",
    side: "related",
    inverse: "remake",
    primary: false,
    section: "Original",
    singular: "Original",
    hint: "The game this one remakes or remasters",
  },
};

/**
 * How a section of linked games is ordered. `release` is by release date
 * (unknown dates last); `custom` is the order you set by hand. Chosen per
 * section, per game, and remembered — see `user_game_link_sorts`.
 */
export const GAME_LINK_SORTS = ["release", "custom"] as const;
export type GameLinkSort = (typeof GAME_LINK_SORTS)[number];
