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
