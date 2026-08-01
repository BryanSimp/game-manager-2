import type {
  AddGameInput,
  AdminSettings,
  BarcodeLookupResult,
  BulkAddItem,
  BulkAddResult,
  BulkUpdateInput,
  ChecklistDetail,
  FriendLibrary,
  FriendsOverview,
  ChecklistKind,
  GameAchievements,
  GameChecklists,
  GameProgress,
  ImportMissionsInput,
  MissionSuggestion,
  SteamStatus,
  CollectionDetail,
  CollectionLayoutInput,
  CollectionSummary,
  DashboardData,
  Health,
  ImportJobDetail,
  ImportJobSummary,
  LibraryEntry,
  OwnershipFormat,
  Platform,
  Preferences,
  SearchResponse,
  ShelfRow,
  Tag,
  TagInput,
  UpdateEntryInput,
  User,
} from "@gm/shared";

export class ApiError extends Error {
  constructor(
    public status: number,
    message: string,
    public body?: unknown,
  ) {
    super(message);
    this.name = "ApiError";
  }
}

export interface ApiClientOptions {
  /** e.g. http://localhost:3001 (web uses "" for same-origin /api paths) */
  baseUrl: string;
  /**
   * Returns a bearer token, or null to rely on cookies.
   * Web: leave undefined (session cookie). Mobile: read from SecureStore.
   */
  getToken?: () => Promise<string | null> | string | null;
  /** Extra headers per request — e.g. the mobile app attaches its stored session cookie. */
  getHeaders?: () => Promise<Record<string, string>> | Record<string, string>;
  fetch?: typeof fetch;
}

export class ApiClient {
  constructor(private opts: ApiClientOptions) {}

  private async request<T>(path: string, init: RequestInit = {}): Promise<T> {
    const doFetch = this.opts.fetch ?? fetch;
    const headers = new Headers(init.headers);
    // FormData sets its own multipart boundary — only default JSON for string bodies
    if (typeof init.body === "string" && !headers.has("content-type")) {
      headers.set("content-type", "application/json");
    }
    const token = await this.opts.getToken?.();
    if (token) headers.set("authorization", `Bearer ${token}`);
    const extra = await this.opts.getHeaders?.();
    if (extra) {
      for (const [key, value] of Object.entries(extra)) {
        if (value) headers.set(key, value);
      }
    }

    const res = await doFetch(`${this.opts.baseUrl}${path}`, {
      credentials: "include",
      ...init,
      headers,
    });

    if (!res.ok) {
      let body: unknown;
      try {
        body = await res.json();
      } catch {
        /* non-JSON error body */
      }
      const message =
        typeof body === "object" && body !== null && "message" in body
          ? String((body as { message: unknown }).message)
          : `Request failed with status ${res.status}`;
      throw new ApiError(res.status, message, body);
    }
    if (res.status === 204) return undefined as T;
    return (await res.json()) as T;
  }

  health(): Promise<Health> {
    return this.request<Health>("/api/health");
  }

  me(): Promise<User> {
    return this.request<User>("/api/me");
  }

  // ---- catalog / search ----

  searchGames(q: string): Promise<SearchResponse> {
    return this.request<SearchResponse>(`/api/games/search?q=${encodeURIComponent(q)}`);
  }

  getPlatforms(): Promise<Platform[]> {
    return this.request<Platform[]>("/api/platforms");
  }

  lookupBarcode(code: string): Promise<BarcodeLookupResult> {
    return this.request<BarcodeLookupResult>(
      `/api/lookup/barcode/${encodeURIComponent(code)}`,
    );
  }

  // ---- library ----

  getLibrary(): Promise<LibraryEntry[]> {
    return this.request<LibraryEntry[]>("/api/library");
  }

  getEntry(id: string): Promise<LibraryEntry> {
    return this.request<LibraryEntry>(`/api/library/${id}`);
  }

  addToLibrary(input: AddGameInput): Promise<{ id: string; gameId: string }> {
    return this.request("/api/library", { method: "POST", body: JSON.stringify(input) });
  }

  bulkAdd(
    items: BulkAddItem[],
    platforms?: Array<{ platformId: string; format: OwnershipFormat }>,
  ): Promise<BulkAddResult> {
    return this.request("/api/library/bulk", {
      method: "POST",
      body: JSON.stringify({ items, platforms }),
    });
  }

  bulkUpdateEntries(input: BulkUpdateInput): Promise<{ updated: number }> {
    return this.request("/api/library/bulk-update", {
      method: "POST",
      body: JSON.stringify(input),
    });
  }

  updateEntry(id: string, input: UpdateEntryInput): Promise<{ ok: true }> {
    return this.request(`/api/library/${id}`, {
      method: "PATCH",
      body: JSON.stringify(input),
    });
  }

  setEntryPlatforms(
    id: string,
    platforms: Array<{ platformId: string; format: OwnershipFormat }>,
  ): Promise<{ ok: true }> {
    return this.request(`/api/library/${id}/platforms`, {
      method: "PUT",
      body: JSON.stringify({ platforms }),
    });
  }

  removeEntry(id: string): Promise<{ ok: true }> {
    return this.request(`/api/library/${id}`, { method: "DELETE" });
  }

  setEntryTags(id: string, tagIds: string[]): Promise<{ ok: true }> {
    return this.request(`/api/library/${id}/tags`, {
      method: "PUT",
      body: JSON.stringify({ tagIds }),
    });
  }

  uploadCover(id: string, file: Blob, filename: string): Promise<{ imageId: string; coverSrc: string }> {
    const form = new FormData();
    form.append("file", file, filename);
    return this.request(`/api/library/${id}/cover`, { method: "POST", body: form });
  }

  removeCover(id: string): Promise<{ ok: true }> {
    return this.request(`/api/library/${id}/cover`, { method: "DELETE" });
  }

  // ---- tags ----

  getTags(): Promise<Tag[]> {
    return this.request<Tag[]>("/api/tags");
  }

  createTag(input: TagInput): Promise<Tag> {
    return this.request("/api/tags", { method: "POST", body: JSON.stringify(input) });
  }

  updateTag(id: string, input: Partial<TagInput>): Promise<Tag> {
    return this.request(`/api/tags/${id}`, { method: "PATCH", body: JSON.stringify(input) });
  }

  deleteTag(id: string): Promise<{ ok: true }> {
    return this.request(`/api/tags/${id}`, { method: "DELETE" });
  }

  // ---- shelf ----

  getShelf(): Promise<ShelfRow[]> {
    return this.request<ShelfRow[]>("/api/shelf");
  }

  setShelfOrder(platformId: string, orderedUserGameIds: string[]): Promise<{ ok: true }> {
    return this.request(`/api/shelf/${platformId}/order`, {
      method: "PUT",
      body: JSON.stringify({ orderedUserGameIds }),
    });
  }

  // ---- collections ----

  getCollections(): Promise<CollectionSummary[]> {
    return this.request<CollectionSummary[]>("/api/collections");
  }

  createCollection(input: { name: string; description?: string | null; accentColor?: string | null }): Promise<CollectionSummary> {
    return this.request("/api/collections", { method: "POST", body: JSON.stringify(input) });
  }

  updateCollection(
    id: string,
    input: Partial<{ name: string; description: string | null; accentColor: string | null }>,
  ): Promise<CollectionSummary> {
    return this.request(`/api/collections/${id}`, { method: "PATCH", body: JSON.stringify(input) });
  }

  deleteCollection(id: string): Promise<{ ok: true }> {
    return this.request(`/api/collections/${id}`, { method: "DELETE" });
  }

  getCollection(id: string): Promise<CollectionDetail> {
    return this.request<CollectionDetail>(`/api/collections/${id}`);
  }

  addCollectionGame(id: string, gameId: string): Promise<{ ok: true }> {
    return this.request(`/api/collections/${id}/games`, {
      method: "POST",
      body: JSON.stringify({ gameId }),
    });
  }

  removeCollectionGame(id: string, gameId: string): Promise<{ ok: true }> {
    return this.request(`/api/collections/${id}/games/${gameId}`, { method: "DELETE" });
  }

  saveCollectionLayout(id: string, layout: CollectionLayoutInput): Promise<{ ok: true }> {
    return this.request(`/api/collections/${id}/layout`, {
      method: "PUT",
      body: JSON.stringify(layout),
    });
  }

  // ---- imports (OCR pipeline) ----

  createImageImport(
    file: Blob,
    filename: string,
    source: "screenshot" | "shelf_photo",
  ): Promise<ImportJobSummary> {
    const form = new FormData();
    form.append("source", source);
    form.append("file", file, filename);
    return this.request("/api/imports", { method: "POST", body: form });
  }

  createTextImport(text: string): Promise<ImportJobSummary> {
    return this.request("/api/imports", {
      method: "POST",
      body: JSON.stringify({ source: "text_paste", text }),
    });
  }

  getImports(): Promise<ImportJobSummary[]> {
    return this.request<ImportJobSummary[]>("/api/imports");
  }

  getImport(id: string): Promise<ImportJobDetail> {
    return this.request<ImportJobDetail>(`/api/imports/${id}`);
  }

  finishImport(id: string): Promise<{ ok: true }> {
    return this.request(`/api/imports/${id}`, {
      method: "PATCH",
      body: JSON.stringify({ status: "done" }),
    });
  }

  // ---- checklists ----

  getGameChecklists(gameId: string): Promise<GameChecklists> {
    return this.request<GameChecklists>(`/api/games/${gameId}/checklists`);
  }

  createChecklist(
    gameId: string,
    title: string,
    kind: ChecklistKind = "completion",
  ): Promise<{ id: string }> {
    return this.request(`/api/games/${gameId}/checklists`, {
      method: "POST",
      body: JSON.stringify({ title, kind }),
    });
  }

  // ---- mission lists + time remaining ----

  /** Parse a mission list off a wiki for review. Saves nothing. */
  suggestMissions(gameId: string, url?: string): Promise<MissionSuggestion> {
    return this.request<MissionSuggestion>(`/api/games/${gameId}/missions/suggest`, {
      method: "POST",
      body: JSON.stringify(url ? { url } : {}),
    });
  }

  /** Save a reviewed mission list as a 'missions' checklist. */
  importMissions(
    gameId: string,
    input: ImportMissionsInput,
  ): Promise<{ id: string; count: number }> {
    return this.request(`/api/games/${gameId}/missions`, {
      method: "POST",
      body: JSON.stringify(input),
    });
  }

  getEntryProgress(entryId: string): Promise<GameProgress> {
    return this.request<GameProgress>(`/api/library/${entryId}/progress`);
  }

  getChecklist(id: string): Promise<ChecklistDetail> {
    return this.request<ChecklistDetail>(`/api/checklists/${id}`);
  }

  updateChecklist(
    id: string,
    input: Partial<{ title: string; isPublic: boolean; sequential: boolean }>,
  ): Promise<{ ok: true }> {
    return this.request(`/api/checklists/${id}`, {
      method: "PATCH",
      body: JSON.stringify(input),
    });
  }

  deleteChecklist(id: string): Promise<{ ok: true }> {
    return this.request(`/api/checklists/${id}`, { method: "DELETE" });
  }

  adoptChecklist(id: string): Promise<{ id: string }> {
    return this.request(`/api/checklists/${id}/adopt`, { method: "POST" });
  }

  addChecklistItem(
    checklistId: string,
    input: { text: string; category?: string | null },
  ): Promise<{ id: string; position: number }> {
    return this.request(`/api/checklists/${checklistId}/items`, {
      method: "POST",
      body: JSON.stringify(input),
    });
  }

  updateChecklistItem(
    itemId: string,
    input: Partial<{ text: string; category: string | null; position: number }>,
  ): Promise<{ ok: true }> {
    return this.request(`/api/checklists/items/${itemId}`, {
      method: "PATCH",
      body: JSON.stringify(input),
    });
  }

  deleteChecklistItem(itemId: string): Promise<{ ok: true }> {
    return this.request(`/api/checklists/items/${itemId}`, { method: "DELETE" });
  }

  /** Tick several entries at once — one request for a sequential fill-in. */
  checkChecklistItems(
    checklistId: string,
    itemIds: string[],
    completed: boolean,
  ): Promise<{ ok: true; changed: number }> {
    return this.request(`/api/checklists/${checklistId}/items/check`, {
      method: "PUT",
      body: JSON.stringify({ itemIds, completed }),
    });
  }

  checkChecklistItem(itemId: string, completed: boolean): Promise<{ ok: true }> {
    return this.request(`/api/checklists/items/${itemId}/check`, {
      method: "PUT",
      body: JSON.stringify({ completed }),
    });
  }

  // ---- friends ----

  getFriends(): Promise<FriendsOverview> {
    return this.request<FriendsOverview>("/api/friends");
  }

  /** Send a friend request by code. Returns 'accepted' if they'd already asked. */
  sendFriendRequest(code: string): Promise<{ status: "pending" | "accepted"; name: string }> {
    return this.request("/api/friends/requests", {
      method: "POST",
      body: JSON.stringify({ code }),
    });
  }

  acceptFriendRequest(id: string): Promise<{ ok: true }> {
    return this.request(`/api/friends/requests/${id}/accept`, { method: "POST" });
  }

  /** Decline an incoming request, or withdraw one you sent. */
  cancelFriendRequest(id: string): Promise<{ ok: true }> {
    return this.request(`/api/friends/requests/${id}`, { method: "DELETE" });
  }

  removeFriend(userId: string): Promise<{ ok: true }> {
    return this.request(`/api/friends/${userId}`, { method: "DELETE" });
  }

  getFriendLibrary(userId: string): Promise<FriendLibrary> {
    return this.request<FriendLibrary>(`/api/friends/${userId}/library`);
  }

  // ---- Steam ----

  getSteamStatus(): Promise<SteamStatus> {
    return this.request<SteamStatus>("/api/steam");
  }

  linkSteam(steamId: string): Promise<{ ok: true; steamId: string; personaName: string | null }> {
    return this.request("/api/steam", { method: "PUT", body: JSON.stringify({ steamId }) });
  }

  unlinkSteam(): Promise<{ ok: true }> {
    return this.request("/api/steam", { method: "DELETE" });
  }

  startSteamImport(): Promise<{ queued: true }> {
    return this.request("/api/steam/import", { method: "POST" });
  }

  startSteamSync(): Promise<{ queued: true }> {
    return this.request("/api/steam/sync", { method: "POST" });
  }

  getEntryAchievements(entryId: string): Promise<GameAchievements> {
    return this.request<GameAchievements>(`/api/library/${entryId}/achievements`);
  }

  saveSteamApiKey(apiKey: string): Promise<{ ok: true }> {
    return this.request("/api/admin/settings/steam", {
      method: "PUT",
      body: JSON.stringify({ apiKey }),
    });
  }

  // ---- preferences & dashboard ----

  getPreferences(): Promise<Preferences> {
    return this.request<Preferences>("/api/preferences");
  }

  savePreferences(input: Partial<Preferences>): Promise<{ ok: true }> {
    return this.request("/api/preferences", { method: "PUT", body: JSON.stringify(input) });
  }

  getDashboard(): Promise<DashboardData> {
    return this.request<DashboardData>("/api/dashboard");
  }

  // ---- admin ----

  getAdminSettings(): Promise<AdminSettings> {
    return this.request<AdminSettings>("/api/admin/settings");
  }

  saveIgdbCredentials(clientId: string, clientSecret: string): Promise<{ ok: true }> {
    return this.request("/api/admin/settings/igdb", {
      method: "PUT",
      body: JSON.stringify({ clientId, clientSecret }),
    });
  }

  testIgdb(): Promise<{ ok: true }> {
    return this.request("/api/admin/settings/igdb/test", { method: "POST" });
  }
}

export type { Health, User, LibraryEntry, Platform, SearchResponse };
