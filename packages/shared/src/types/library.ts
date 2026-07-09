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

export interface LibraryEntry {
  id: string;
  status: GameStatus;
  rating: number | null;
  notes: string | null;
  ttbEnabled: boolean;
  startedAt: string | null;
  finishedAt: string | null;
  createdAt: string;
  game: GameSummary;
  platforms: OwnedPlatform[];
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
