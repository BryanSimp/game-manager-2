import type {
  ChecklistKind,
  GameLinkKind,
  OwnershipFormat,
  PlatformFamily,
  ProgressBasis,
  PublishMode,
} from "../constants.js";
import type { TtbSource } from "../progress.js";
export interface GameSummary {
  id: string;
  igdbId: number | null;
  /** set when a Steam import linked this game to an app */
  steamAppId: number | null;
  title: string;
  summary: string | null;
  releaseDate: string | null;
  coverSrc: string | null;
  ttbMain: number | null;
  ttbMainExtra: number | null;
  ttbCompletionist: number | null;
  /**
   * Where these times came from — resolved per request, so 'yours' and
   * 'community' appear here even though the catalog column only stores
   * 'igdb' and 'manual'. See `resolveTtb`.
   */
  ttbSource: TtbSource | null;
  /** players averaged, when `ttbSource` is 'community' */
  ttbCount: number | null;
}
export interface OwnedPlatform {
  platformId: string;
  name: string;
  abbreviation: string | null;
  family: PlatformFamily;
  /** set when this is a storefront (Steam…): the platform it sells for (PC) */
  parentPlatformId: string | null;
  parentName: string | null;
  format: OwnershipFormat;
}
export interface Tag {
  id: string;
  name: string;
  color: string | null;
  groupName: string | null;
}
export interface LibraryEntry {
  id: string;
  status: string;
  rating: number | null;
  notes: string | null;
  ttbEnabled: boolean;
  completed100: boolean;
  /** which how-long-to-beat figure the remaining-time estimate divides up */
  progressBasis: ProgressBasis;
  /**
   * Play time left, from the mission checklist. null when the game has no
   * mission list or no time for the chosen basis — the library sort treats
   * that as "unknown" rather than "zero".
   */
  estimatedRemainingSeconds: number | null;
  missionsTotal: number;
  missionsDone: number;
  startedAt: string | null;
  finishedAt: string | null;
  createdAt: string;
  hasCustomCover: boolean;
  game: GameSummary;
  platforms: OwnedPlatform[];
  tags: Tag[];
}
/**
 * A game in the shared catalog, seen by someone who may not own it.
 *
 * The page behind this exists because a collection can list games you don't
 * have. Following one used to drop you in the add-game search with the title
 * pre-typed, which made you find a game the app had already identified. This
 * is the game itself, with adding reduced to one button.
 */
export interface CatalogGame {
  game: GameSummary;
  /** your library entry for it, when you have one — the page redirects there */
  userGameId: string | null;
  /** everyone's average rating, subject to the same minimum as elsewhere */
  communityRating: { average: number; count: number } | null;
  minRatings: number;
}
export interface Platform {
  id: string;
  name: string;
  abbreviation: string | null;
  family: PlatformFamily;
  sortOrder: number;
  /** first-region hardware launch, or the day a storefront opened */
  releaseDate: string | null;
  summary: string | null;
  logoUrl: string | null;
  /**
   * Sub-platform link. The PC storefronts (Steam, Epic, GOG…) are children of
   * PC: a game filed under one is still a PC game, and anything that counts or
   * filters by platform rolls children up into their parent.
   */
  parentPlatformId: string | null;
  parentName: string | null;
  /** true when this platform is on your consoles list */
  owned: boolean;
}
/**
 * A console on your list, with how much of your library sits on it. The
 * preview covers come from the same query so the page needs one request.
 */
export interface ConsoleSummary {
  platform: Platform;
  addedAt: string;
  /** your own art for this console, replacing the stock logo */
  customImageSrc: string | null;
  /** includes games filed under this platform's storefronts */
  gameCount: number;
  /** how many of those came from a storefront rather than the platform itself */
  storefrontCount: number;
  physicalCount: number;
  digitalCount: number;
  /** a handful of covers for the card, newest additions first */
  preview: Array<{
    entryId: string;
    title: string;
    coverSrc: string | null;
    status: string;
  }>;
}
export interface SearchResult {
  igdbId: number | null;
  gameId: string | null;
  title: string;
  releaseYear: number | null;
  coverSrc: string | null;
  platforms: string[];
  summary: string | null;
  inLibrary: boolean;
}
export interface SearchResponse {
  igdb: boolean;
  results: SearchResult[];
}
export interface SearchOptions {
  /** narrow to games first released in this year */
  year?: number | null;
}
export interface AddGameInput {
  igdbId?: number;
  gameId?: string;
  title?: string;
  status?: string;
  /**
   * Ownership to file the new game under. Omitted, the default platform
   * preference applies; an empty array deliberately means "no platform".
   */
  platforms?: Array<{ platformId: string; format: OwnershipFormat }>;
}
/**
 * How long a game took **you**, in seconds, matching the columns they land in.
 * Yours alone: your figure drives your own estimate, and the average of
 * everyone's fills in games IGDB has no data for. A null clears that figure;
 * clearing all three removes your submission. See `resolveTtb` for which one
 * a game actually displays.
 */
export interface TimeToBeatInput {
  ttbMain?: number | null;
  ttbMainExtra?: number | null;
  ttbCompletionist?: number | null;
}
/** Aggregates across everyone who owns a game. */
export interface CommunityStats {
  /** null until `minRatings` people have rated it */
  rating: { average: number; count: number } | null;
  /** average of submitted play times, in seconds; null when nobody has said */
  timeToBeat: {
    ttbMain: number | null;
    ttbMainExtra: number | null;
    ttbCompletionist: number | null;
    count: number;
  } | null;
  /** your own submission, so the editor can show what you said */
  yours: {
    ttbMain: number | null;
    ttbMainExtra: number | null;
    ttbCompletionist: number | null;
  } | null;
  minRatings: number;
}
export interface UpdateEntryInput {
  status?: string;
  rating?: number | null;
  notes?: string | null;
  ttbEnabled?: boolean;
  completed100?: boolean;
  progressBasis?: ProgressBasis;
}
export interface BulkUpdateInput {
  ids: string[];
  status?: string;
  ttbEnabled?: boolean;
  completed100?: boolean;
  /** platform ownership to apply, interpreted by `platformMode` */
  platforms?: Array<{ platformId: string; format: OwnershipFormat }>;
  /**
   * 'add' keeps existing ownership, 'replace' wipes it first, 'remove' takes
   * the listed platforms off (whatever format they were owned in).
   */
  platformMode?: "add" | "replace" | "remove";
}
export interface BulkAddItem {
  igdbId?: number;
  title?: string;
  status?: string;
}
export interface BulkAddResult {
  added: number;
  skipped: number;
  errors: string[];
}
export interface AdminSettings {
  igdbConfigured: boolean;
  igdbClientId: string | null;
  steamConfigured: boolean;
  steamGridDbConfigured: boolean;
  emailConfigured: boolean;
  emailFrom: string | null;
}
export interface AdminAnalyticsOverview {
  /** distinct users who reached each step, in funnel order */
  funnel: Array<{ step: string; users: number }>;
  /** daily active users, last 30 days, gap days filled with 0 */
  dau: Array<{ day: string; users: number }>;
  engagement: {
    dauToday: number;
    wau: number;
    mau: number;
    totalUsers: number;
    totalLibraryEntries: number;
    avgGamesPerUser: number;
    avgSessionMinutes: number;
    sessions30d: number;
  };
}
// ---- admin: the account list ----
/**
 * Sort orders for the admin user list. Text, validated by zod, for the same
 * reason `user_games.status` is — adding one is a constant here and nothing
 * else.
 */
export const ADMIN_USER_SORTS = ["newest", "oldest", "name", "games", "active"] as const;
export type AdminUserSort = (typeof ADMIN_USER_SORTS)[number];

export const ADMIN_USER_SORT_LABELS: Record<AdminUserSort, string> = {
  newest: "Newest first",
  oldest: "Oldest first",
  name: "Name (A–Z)",
  games: "Most games",
  active: "Recently active",
};

/** Which slice of the account list to show. */
export const ADMIN_USER_FILTERS = ["all", "admins", "banned", "demo"] as const;
export type AdminUserFilter = (typeof ADMIN_USER_FILTERS)[number];

export const ADMIN_USER_FILTER_LABELS: Record<AdminUserFilter, string> = {
  all: "Everyone",
  admins: "Admins",
  banned: "Banned",
  demo: "Demo accounts",
};

/** One row of the admin account list. */
export interface AdminUserRow {
  id: string;
  name: string;
  email: string;
  role: string;
  emailVerified: boolean;
  banned: boolean;
  banReason: string | null;
  /** seeded showcase account behind /demo, not a person */
  isDemo: boolean;
  isPremium: boolean;
  /** whether they've turned on two-factor sign-in */
  twoFactorEnabled: boolean;
  /** whether they've linked a Steam account */
  steamLinked: boolean;
  games: number;
  collections: number;
  friends: number;
  createdAt: string;
  /** most recent analytics ping, or null if they've done nothing since it started logging */
  lastActiveAt: string | null;
  /** live (unexpired) sessions — a rough "signed in on N devices" */
  sessions: number;
}

export interface AdminUserQuery {
  q?: string;
  filter?: AdminUserFilter;
  sort?: AdminUserSort;
  limit?: number;
  offset?: number;
}

export interface AdminUserPage {
  users: AdminUserRow[];
  /** rows matching the current filters, before paging */
  total: number;
  /** counts across everything, so the tiles don't move when a filter changes */
  counts: { all: number; admins: number; banned: number; demo: number };
}

/** What the admin demo page reads: what's in the demo, and how the last build went. */
export interface DemoAdminView {
  stats: {
    exists: boolean;
    userId: string | null;
    name: string | null;
    games: number;
    collections: number;
    lists: number;
    tags: number;
    friends: number;
    consoles: number;
  };
  seed: {
    running: boolean;
    startedAt: string | null;
    finishedAt: string | null;
    error: string | null;
    /** the same lines the CLI prints, newest last */
    log: string[];
  };
  /** without IGDB the seed still runs, it just produces games with no art */
  igdbConfigured: boolean;
}
export interface TagInput {
  name: string;
  color?: string | null;
  groupName?: string | null;
}
export interface Preferences {
  theme: "dark" | "light";
  /** category a newly added game lands in */
  defaultStatus: string;
  /** keyed by category key — built-in or custom */
  statusColors: Record<string, string> | null;
  /** platform a newly added game is filed under; null = none */
  defaultPlatformId: string | null;
  defaultPlatformFormat: OwnershipFormat;
  showPlatformBadge: boolean;
  showTimeBadge: boolean;
  /** star ratings on library cards */
  showRating: boolean;
  /** category-badge opacity in percent, applied wherever badges render */
  badgeOpacity: number;
  /**
   * Covers per row on the web library grid at full width, 1–8. Narrow
   * breakpoints keep their own smaller counts — this is the widest step.
   */
  libraryColumns: number;
  /**
   * Category the library opens filtered to — a built-in key, a custom
   * category id, or `'all'`. It's the starting point, not a lock: picking a
   * different chip overrides it for as long as you stay on the page.
   */
  defaultLibraryFilter: string;
  /**
   * What happens to a list or collection the moment you create it, so sharing
   * (or not) isn't a button press every time. Governs only what you create:
   * an adopted copy of someone else's work starts private under every mode,
   * and changing the mode never republishes or unpublishes what exists.
   */
  publishMode: PublishMode;
}
/**
 * A game on the other end of a link, with just enough to render a row and
 * click through to it.
 */
export interface LinkedGame {
  id: string;
  title: string;
  coverSrc: string | null;
  releaseDate: string | null;
  /** your library entry, when you own it — null means "linked, not owned" */
  userGameId: string | null;
  status: string | null;
}
export interface GameLink {
  id: string;
  kind: GameLinkKind;
  /** the game at the other end — never the one you asked about */
  game: LinkedGame;
}
/**
 * Both ends of a game's links, because the relationship reads differently
 * from each side. `children` are the things that hang off this game — its
 * DLC, the remake of it. `parents` are what it hangs off: the base game a DLC
 * belongs to, the original a remaster polished.
 *
 * A game can have both at once, and that isn't a mistake worth preventing: an
 * expansion can itself have been remastered.
 */
export interface GameLinks {
  children: GameLink[];
  parents: GameLink[];
}
/** Link a game to another. `igdbId` pulls one into the catalog first. */
export interface AddGameLinkInput {
  kind: GameLinkKind;
  relatedGameId?: string;
  igdbId?: number;
  /**
   * Which way round. `child` (the default) means the game you're posting to
   * is the base and the related game hangs off it — "this has DLC". `parent`
   * flips it: the related game is the base — "this **is** DLC for that".
   */
  direction?: "child" | "parent";
}
export type ImportSource = "screenshot" | "shelf_photo" | "text_paste" | "steam";
export type ImportJobStatus = "pending" | "ocr" | "matching" | "review" | "done" | "failed";
export type ImportItemResolution = "pending" | "auto" | "manual" | "skipped";
export interface ImportCandidate {
  igdbId: number | null;
  gameId: string | null;
  title: string;
  releaseYear: number | null;
  coverSrc: string | null;
}
export interface ImportJobSummary {
  id: string;
  source: ImportSource;
  status: ImportJobStatus;
  error: string | null;
  createdAt: string;
}
export interface ImportItem {
  id: string;
  rawText: string;
  cleanedTitle: string;
  candidates: ImportCandidate[];
  confidence: number | null;
  resolution: ImportItemResolution;
}
export interface ImportJobDetail extends ImportJobSummary {
  items: ImportItem[];
}
/**
 * Thumbs on a published list or collection — the only signal for whether
 * someone else's is worth copying.
 */
export interface VoteCounts {
  up: number;
  down: number;
  /** up − down; what "best first" sorts by */
  score: number;
  /** your own vote: 1, -1, or 0 for none */
  mine: number;
}
/**
 * A collection's play time, rolled up.
 *
 * `totalSeconds` is the whole run — how long the collection takes to beat in
 * full, finished games included, because that is a fact about the list rather
 * than about your progress through it. `remainingSeconds` is what you have
 * left: a finished game contributes nothing, a game with a part-ticked mission
 * list contributes its pro-rated remainder, and everything else contributes
 * its full length.
 *
 * The three counts explain any gap between the total and the number of games:
 * lengths nobody knows (`unknown`) and games marked endless (`endless`) are
 * deliberately left out of both figures rather than counted as zero.
 */
export interface CollectionTime {
  totalSeconds: number;
  remainingSeconds: number;
  /** games whose length went into the totals */
  counted: number;
  /** games with no known length, here or in the community figures */
  unknown: number;
  /** games marked endless — excluded from both totals on purpose */
  endless: number;
  /** games you have finished or marked 100% */
  finished: number;
}

export interface CollectionSummary {
  id: string;
  name: string;
  description: string | null;
  accentColor: string | null;
  total: number;
  finished: number;
  /** how long the whole run takes, and how much of it you have left */
  time: CollectionTime;
  /** listed for everyone to browse and adopt */
  isPublic: boolean;
  /** set when this is your copy of someone else's public collection */
  adoptedFromId: string | null;
  /** a few covers for the card, in play order */
  preview: Array<{ gameId: string; title: string; coverSrc: string | null }>;
  /**
   * Whether this collection already holds the game you asked about — only
   * present when the list was fetched with a `gameId`, so `false` always
   * means "asked, and no" rather than "never checked".
   */
  containsGame?: boolean;
}
/**
 * A public collection as it appears in the browse list. Deliberately narrower
 * than your own: no per-game status, because that's the author's business.
 */
export interface PublicCollection {
  id: string;
  name: string;
  description: string | null;
  accentColor: string | null;
  authorName: string;
  total: number;
  /** true when you've already taken a copy */
  adopted: boolean;
  /** true when it's yours */
  mine: boolean;
  votes: VoteCounts;
  /** how long the run is — and, against your own library, what's left of it */
  time: CollectionTime;
  preview: Array<{ gameId: string; title: string; coverSrc: string | null }>;
}
export interface CollectionNode {
  gameId: string;
  title: string;
  coverSrc: string | null;
  /** node position on the play-order graph */
  x: number;
  y: number;
  /** 1-based place in the flat list view's custom order */
  sortOrder: number;
  /** so the list can sort by release date without a second request */
  releaseDate: string | null;
  /** resolved play time — catalog, then yours, then the community average */
  ttbMain: number | null;
  /** the figure this game contributes to the collection total, for its basis */
  ttbSeconds: number | null;
  /** what's left of it: 0 when finished, pro-rated against mission progress */
  remainingSeconds: number | null;
  /** finished or marked 100% */
  finished: boolean;
  /** marked endless, so it counts toward neither total */
  endless: boolean;
  /** null when the game isn't in your library — the list says so and links to add it */
  userGameId: string | null;
  status: string | null;
}
export interface CollectionLink {
  id: string;
  fromGameId: string;
  toGameId: string;
  label: string | null;
}
export interface CollectionDetail {
  id: string;
  name: string;
  description: string | null;
  accentColor: string | null;
  isPublic: boolean;
  adoptedFromId: string | null;
  /** false when you're looking at someone else's published collection */
  isOwner: boolean;
  /** set only when it isn't yours */
  authorName: string | null;
  votes: VoteCounts;
  /** summed from `games`, so the header can't disagree with the rows */
  time: CollectionTime;
  games: CollectionNode[];
  links: CollectionLink[];
}
/** How the public browse list is filtered and ordered. */
export interface PublicCollectionQuery {
  /** matches collection names, descriptions, *and* the titles of games inside */
  q?: string;
  /** collections containing this exact game */
  gameId?: string;
  sort?: "top" | "new";
  limit?: number;
  offset?: number;
}
export interface PublicCollectionPage {
  items: PublicCollection[];
  hasMore: boolean;
}
/**
 * Adding a game to a collection. `gameId` for something already in the
 * catalog, `igdbId` to pull one in — a collection can list games you don't
 * own, so this deliberately doesn't touch your library.
 */
export interface AddCollectionGameInput {
  gameId?: string;
  igdbId?: number;
}
/**
 * One line of a pasted list, and what became of it.
 *
 * Every line comes back, matched or not, with the score behind the decision —
 * there is no review step before the games are filed, so the response *is*
 * the review. A wrong row is one click to remove from the collection.
 */
export interface CollectionListImportResult {
  /** the line as it was read out of the pasted text */
  input: string;
  /** the game it was filed as, or null when nothing scored high enough */
  matched: { gameId: string; title: string; coverSrc: string | null } | null;
  /** 0..1 title similarity against the top candidate */
  confidence: number;
  status: "added" | "duplicate" | "unmatched" | "failed";
}
export interface CollectionListImport {
  added: number;
  /** already in the collection — a re-paste doesn't double anything up */
  duplicates: number;
  /** lines nothing matched, or whose lookup failed */
  unmatched: number;
  results: CollectionListImportResult[];
}
/**
 * Pull a whole collection into your library — the point of browsing someone
 * else's. Games you already own are left alone rather than re-filed, except
 * for the platform, which is applied to them too (the same rule
 * `POST /api/library/bulk` follows).
 */
export interface AddCollectionToLibraryInput {
  /** category the new entries land in — a built-in key or a custom category id */
  status: string;
  platforms?: Array<{ platformId: string; format: OwnershipFormat }>;
}
export interface AddCollectionToLibraryResult {
  added: number;
  /** already in your library */
  skipped: number;
  errors: string[];
}
export interface CollectionLayoutInput {
  nodes: Array<{ gameId: string; x: number; y: number }>;
  links: Array<{ fromGameId: string; toGameId: string; label?: string | null }>;
}
// ---- completionist checklists (Phase 7) ----
export interface ChecklistSummary {
  id: string;
  title: string;
  kind: ChecklistKind;
  isPublic: boolean;
  /**
   * Wiki page a mission list was scraped from, back when the app scraped —
   * kept for CC-BY-SA attribution on lists that predate phase 16, and still
   * rendered as a link. Nothing writes it any more.
   */
  sourceUrl: string | null;
  /** played in order: ticking an entry implies everything before it */
  sequential: boolean;
  /** author display name — set on public templates from other users */
  authorName: string | null;
  mine: boolean;
  itemCount: number;
  doneCount: number;
  /** where this list sits among your lists for the game, 1-based */
  position: number;
  /** set when this is your copy of someone else's published list */
  adoptedFromId: string | null;
  votes: VoteCounts;
}
export interface ChecklistItemView {
  id: string;
  position: number;
  text: string;
  category: string | null;
  completedAt: string | null;
}
export interface ChecklistDetail {
  id: string;
  gameId: string;
  title: string;
  kind: ChecklistKind;
  isPublic: boolean;
  sourceUrl: string | null;
  sequential: boolean;
  mine: boolean;
  authorName: string | null;
  items: ChecklistItemView[];
}
export interface GameChecklists {
  mine: ChecklistSummary[];
  public: ChecklistSummary[];
}
// ---- mission progress + time remaining ----
export interface ImportMissionsInput {
  title: string;
  missions: string[];
  /** defaults to 'missions' (the timed main-story list) */
  kind?: Extract<ChecklistKind, "missions" | "side_quests">;
}
/** Time-remaining estimate for one library entry. */
export interface GameProgress {
  basis: ProgressBasis;
  /** the mission checklist driving the estimate, if any */
  checklistId: string | null;
  checklistTitle: string | null;
  total: number;
  done: number;
  percent: number;
  totalSeconds: number | null;
  perItemSeconds: number | null;
  remainingSeconds: number | null;
}
// ---- Steam (Phase 8) ----
export interface SteamStatus {
  configured: boolean; // server has an API key
  linked: boolean;
  steamId: string | null;
  personaName: string | null;
  lastImportAt: string | null;
  lastSyncAt: string | null;
  importing: boolean;
  syncing: boolean;
}
/**
 * A per-user override for one Steam app. Title matching can't separate two
 * games with the same name, so these are the manual last word on an import.
 */
export interface SteamImportRule {
  steamAppId: number;
  action: "block" | "map";
  /** Steam's own name for the app, when we knew it */
  appName: string | null;
  /** for 'map': the game this app always imports as */
  gameId: string | null;
  gameTitle: string | null;
  createdAt: string;
}
export interface SteamImportRuleInput {
  steamAppId: number;
  action: "block" | "map";
  gameId?: string;
  igdbId?: number;
  appName?: string;
  /** a mis-matched entry to replace with the pinned game, keeping playtime */
  replaceEntryId?: string;
}
/** One piece of art you could use for a console. */
export interface ConsoleArtCandidate {
  id: string;
  url: string;
  thumbUrl: string;
  source: "igdb" | "wikimedia";
  label: string | null;
}
export interface AchievementView {
  id: string;
  name: string;
  description: string | null;
  iconUrl: string | null;
  iconGrayUrl: string | null;
  unlockedAt: string | null;
  unlocked: boolean;
}
export interface GameAchievements {
  total: number;
  unlocked: number;
  achievements: AchievementView[];
  steamPlaytimeMinutes: number | null;
}
export interface BarcodeLookupResult {
  found: boolean;
  product: string | null;
  query: string | null;
  platformHint: { id: string; name: string; abbreviation: string | null } | null;
  candidates: ImportCandidate[];
  confidence: number;
}
export interface DashboardData {
  total: number;
  statusCounts: Record<string, number>;
  platformCounts: Array<{
    name: string;
    abbreviation: string | null;
    family: PlatformFamily;
    count: number;
  }>;
  backlogSeconds: number;
  recentlyFinished: Array<{
    id: string;
    title: string;
    finishedAt: string | null;
    rating: number | null;
    coverSrc: string | null;
  }>;
}
// ---- friends ----
export interface FriendSummary {
  userId: string;
  name: string;
  friendedAt: string | null;
  /** games you both have in your libraries */
  gamesInCommon: number;
  libraryCount: number;
}
/** A request awaiting a decision — incoming to you, or sent by you. */
export interface FriendRequest {
  id: string;
  userId: string;
  name: string;
  createdAt: string;
}
export interface FriendsOverview {
  /** your own code, generated on first view */
  friendCode: string;
  friends: FriendSummary[];
  incoming: FriendRequest[];
  outgoing: FriendRequest[];
}
/**
 * One game in a friend's library. Deliberately narrower than LibraryEntry:
 * notes are private and never leave their owner's account.
 */
export interface FriendLibraryEntry {
  gameId: string;
  title: string;
  coverSrc: string | null;
  releaseDate: string | null;
  status: string;
  rating: number | null;
  completed100: boolean;
  platforms: string[];
  /** true when this game is in your library too */
  inCommon: boolean;
  /** your status for it, when you have it */
  myStatus: string | null;
  /**
   * your `user_games.id` for it, when you have it — the card links straight to
   * your own copy rather than bouncing through the catalog page's redirect.
   * null means the card offers the catalog page instead, where one button
   * adds it.
   */
  myUserGameId: string | null;
}
export interface FriendLibrary {
  friend: { userId: string; name: string };
  entries: FriendLibraryEntry[];
  total: number;
  inCommon: number;
}
// ---- categories ----
/**
 * A category as the UI needs it: built-ins and custom ones resolved into the
 * same shape, so chips and filters don't care which kind they're rendering.
 */
export interface CategoryView {
  /** stored in user_games.status — a built-in key, or a custom category id */
  key: string;
  label: string;
  color: string;
  builtIn: boolean;
  sortOrder: number;
  /** how many of your games are in it */
  count: number;
}
/** One alternate cover offered by SteamGridDB. */
export interface CoverCandidate {
  id: number;
  url: string;
  thumbUrl: string;
  width: number;
  height: number;
  style: string | null;
  author: string | null;
}

export interface CoverOptions {
  /** false when no SteamGridDB key is set — the UI hides the browser */
  configured: boolean;
  covers: CoverCandidate[];
}

export interface CategoryInput {
  name: string;
  color?: string | null;
}
