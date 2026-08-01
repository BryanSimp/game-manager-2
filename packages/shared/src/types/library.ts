import type {
  ChecklistKind,
  OwnershipFormat,
  PlatformFamily,
  ProgressBasis,
} from "../constants.js";
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
  ttbSource: "igdb" | "manual" | null;
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
  /** real retail box scan for this platform, when found */
  boxArtSrc?: string | null;
  boxArtW?: number | null;
  boxArtH?: number | null;
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
export interface CollectionSummary {
  id: string;
  name: string;
  description: string | null;
  accentColor: string | null;
  total: number;
  finished: number;
}
export interface CollectionNode {
  gameId: string;
  title: string;
  coverSrc: string | null;
  x: number;
  y: number;
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
  games: CollectionNode[];
  links: CollectionLink[];
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
  /** wiki page a scraped mission list came from — attribution, CC-BY-SA */
  sourceUrl: string | null;
  /** played in order: ticking an entry implies everything before it */
  sequential: boolean;
  /** author display name — set on public templates from other users */
  authorName: string | null;
  mine: boolean;
  itemCount: number;
  doneCount: number;
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
/** One wiki page that looks like it holds a mission/chapter list. */
export interface MissionSourceCandidate {
  wikiName: string;
  /** e.g. "metalgear.fandom.com" */
  domain: string;
  pageTitle: string;
  url: string;
}
/**
 * A parsed mission list, returned for review. Nothing is saved until the
 * user confirms — wiki parsing is heuristic and picks up stray rows.
 */
export interface MissionSuggestion {
  sourceUrl: string;
  wikiName: string;
  pageTitle: string;
  /** heading the list was pulled from, e.g. "Main missions" */
  sectionTitle: string | null;
  missions: string[];
  /** other pages worth trying if this one parsed badly */
  alternatives: MissionSourceCandidate[];
}
export interface ImportMissionsInput {
  title: string;
  missions: string[];
  sourceUrl?: string | null;
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
