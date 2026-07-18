import type { GameStatus, OwnershipFormat, PlatformFamily } from "../constants.js";

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
  status: GameStatus;
  rating: number | null;
  notes: string | null;
  ttbEnabled: boolean;
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
  status?: GameStatus;
}

export interface UpdateEntryInput {
  status?: GameStatus;
  rating?: number | null;
  notes?: string | null;
  ttbEnabled?: boolean;
}

export interface BulkAddItem {
  igdbId?: number;
  title?: string;
  status?: GameStatus;
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
}

export interface TagInput {
  name: string;
  color?: string | null;
  groupName?: string | null;
}

export interface Preferences {
  theme: "dark" | "light";
  statusColors: Partial<Record<GameStatus, string>> | null;
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
  status: GameStatus;
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
  status: GameStatus | null;
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
  isPublic: boolean;
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
  isPublic: boolean;
  mine: boolean;
  authorName: string | null;
  items: ChecklistItemView[];
}

export interface GameChecklists {
  mine: ChecklistSummary[];
  public: ChecklistSummary[];
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
  statusCounts: Partial<Record<GameStatus, number>>;
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
