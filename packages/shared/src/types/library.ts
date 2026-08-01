import type {
  ChecklistKind,
  OwnershipFormat,
  PlatformFamily,
  ProgressBasis,
} from "../constants.js";
export interface GameSummary {
  id: string;
  igdbId: number | null;
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
export interface AddGameInput {
  igdbId?: number;
  gameId?: string;
  title?: string;
  status?: string;
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
  showPlatformBadge: boolean;
  showTimeBadge: boolean;
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
export interface ShelfEntry {
  userGameId: string;
  gameId: string;
  title: string;
  coverSrc: string | null;
  /** real retail box scan for this shelf's platform, when found */
  boxArtSrc: string | null;
  boxArtW?: number | null;
  boxArtH?: number | null;
  format: OwnershipFormat;
  status: string;
  rating: number | null;
  releaseDate: string | null;
  position: number;
}
export interface ShelfRow {
  platform: {
    id: string;
    name: string;
    abbreviation: string | null;
    family: PlatformFamily;
    sortOrder: number;
  };
  entries: ShelfEntry[];
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
