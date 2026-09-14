import type {
  AddCollectionGameInput,
  AddCollectionToLibraryInput,
  AddCollectionToLibraryResult,
  AddGameInput,
  AdminAnalyticsOverview,
  AdminFeedbackPage,
  AdminFeedbackQuery,
  AdminSettings,
  AdminUserPage,
  AdminUserQuery,
  CatalogGame,
  BarcodeLookupResult,
  BulkAddItem,
  BulkAddResult,
  BulkUpdateInput,
  CategoryInput,
  CoverOptions,
  CategoryView,
  ChecklistDetail,
  ConsoleArtCandidate,
  ConsoleSummary,
  ContactMessageInput,
  FeedbackItem,
  FeedbackSubmission,
  FeedbackTriageInput,
  FriendLibrary,
  FriendsOverview,
  ChecklistKind,
  GameAchievements,
  GameChecklists,
  GameProgress,
  ImportMissionsInput,
  VoteCounts,
  SteamImportRule,
  SteamImportRuleInput,
  SteamStatus,
  CollectionDetail,
  CollectionLayoutInput,
  CollectionListImport,
  CollectionSummary,
  DashboardData,
  DemoAdminView,
  Health,
  ImportJobDetail,
  ImportJobSummary,
  LibraryEntry,
  OwnershipFormat,
  Platform,
  Preferences,
  PublicCollection,
  PublicCollectionPage,
  PublicCollectionQuery,
  SearchOptions,
  SearchResponse,
  Tag,
  TagInput,
  TimeToBeatInput,
  CommunityStats,
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

  /**
   * Whether this server has a seeded demo to tour. Unauthenticated — the
   * landing page asks before anyone has an account, and an instance that
   * never ran `db:seed-demo` answers false so the button can hide itself.
   */
  demoStatus(): Promise<{ available: boolean; name: string | null }> {
    return this.request("/api/demo/status");
  }

  // ---- demo administration ----

  /** What's in the demo library, and how the last rebuild went. */
  getAdminDemo(): Promise<DemoAdminView> {
    return this.request<DemoAdminView>("/api/admin/demo");
  }

  /**
   * Start a rebuild. Returns as soon as the job is running — poll
   * `getAdminDemo()` for progress; a minute of IGDB lookups is well past any
   * sensible request timeout.
   */
  seedDemo(): Promise<{ started: true }> {
    return this.request("/api/admin/demo/seed", { method: "POST" });
  }

  deleteDemo(): Promise<{ ok: true; removed: number }> {
    return this.request("/api/admin/demo", { method: "DELETE" });
  }

  // ---- password recovery (anonymous) ----

  requestPasswordReset(email: string): Promise<{ ok: true; message: string }> {
    return this.request("/api/auth/request-reset", {
      method: "POST",
      body: JSON.stringify({ email }),
    });
  }

  resetPassword(token: string, password: string): Promise<{ ok: true }> {
    return this.request("/api/auth/reset-password", {
      method: "POST",
      body: JSON.stringify({ token, password }),
    });
  }

  // ---- contact (anonymous) ----

  /** Public contact form. The recipient is resolved server-side. */
  sendContactMessage(input: ContactMessageInput): Promise<{ ok: true; message: string }> {
    return this.request("/api/contact", {
      method: "POST",
      body: JSON.stringify(input),
    });
  }

  // ---- catalog / search ----

  searchGames(q: string, options: SearchOptions = {}): Promise<SearchResponse> {
    const params = new URLSearchParams({ q });
    if (options.year) params.set("year", String(options.year));
    return this.request<SearchResponse>(`/api/games/search?${params}`);
  }

  /**
   * One catalog game, whether or not it's in your library. `userGameId` is
   * set when it is, so the caller can send you to your own copy instead.
   */
  getCatalogGame(gameId: string): Promise<CatalogGame> {
    return this.request<CatalogGame>(`/api/games/${gameId}`);
  }

  /** Every platform, each flagged with whether it's on your consoles list. */
  getPlatforms(): Promise<Platform[]> {
    return this.request<Platform[]>("/api/platforms");
  }

  // ---- consoles ----

  getConsoles(): Promise<ConsoleSummary[]> {
    return this.request<ConsoleSummary[]>("/api/consoles");
  }

  addConsole(platformId: string): Promise<{ ok: true }> {
    return this.request("/api/consoles", {
      method: "POST",
      body: JSON.stringify({ platformId }),
    });
  }

  /** Also unfiles your games from it — the response says how many. */
  removeConsole(platformId: string): Promise<{ ok: true; removedFromGames: number }> {
    return this.request(`/api/consoles/${platformId}`, { method: "DELETE" });
  }

  /** Your own art for a console, replacing the stock logo. */
  uploadConsoleImage(
    platformId: string,
    file: Blob,
    filename: string,
  ): Promise<{ imageId: string; customImageSrc: string }> {
    const form = new FormData();
    form.append("file", file, filename);
    return this.request(`/api/consoles/${platformId}/image`, { method: "POST", body: form });
  }

  removeConsoleImage(platformId: string): Promise<{ ok: true }> {
    return this.request(`/api/consoles/${platformId}/image`, { method: "DELETE" });
  }

  /** Logos to choose from, from IGDB and Wikimedia Commons. */
  getConsoleArt(platformId: string): Promise<{ images: ConsoleArtCandidate[] }> {
    return this.request(`/api/consoles/${platformId}/images`);
  }

  /** Use one of those, downloaded server-side. */
  setConsoleImageFromUrl(
    platformId: string,
    url: string,
  ): Promise<{ imageId: string; customImageSrc: string }> {
    return this.request(`/api/consoles/${platformId}/image/from-url`, {
      method: "POST",
      body: JSON.stringify({ url }),
    });
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

  /**
   * Record how long a game took you, in seconds. Yours alone — the average
   * of everyone's is what fills in games IGDB has no figure for.
   */
  saveTimeToBeat(entryId: string, input: TimeToBeatInput): Promise<{ ok: true }> {
    return this.request(`/api/library/${entryId}/time-to-beat`, {
      method: "PUT",
      body: JSON.stringify(input),
    });
  }

  /** Average score and play time across everyone who owns a game. */
  getCommunityStats(gameId: string): Promise<CommunityStats> {
    return this.request<CommunityStats>(`/api/games/${gameId}/community`);
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

  // ---- collections ----

  /**
   * Your collections. Pass a `gameId` and each one comes back flagged with
   * whether it already holds that game — what the add-to-collection control
   * on a game card needs to render a list of toggles rather than a list of
   * guesses.
   */
  getCollections(options: { gameId?: string } = {}): Promise<CollectionSummary[]> {
    const qs = options.gameId ? `?gameId=${encodeURIComponent(options.gameId)}` : "";
    return this.request<CollectionSummary[]>(`/api/collections${qs}`);
  }

  createCollection(input: { name: string; description?: string | null; accentColor?: string | null }): Promise<CollectionSummary> {
    return this.request("/api/collections", { method: "POST", body: JSON.stringify(input) });
  }

  updateCollection(
    id: string,
    input: Partial<{
      name: string;
      description: string | null;
      accentColor: string | null;
      isPublic: boolean;
    }>,
  ): Promise<CollectionSummary> {
    return this.request(`/api/collections/${id}`, { method: "PATCH", body: JSON.stringify(input) });
  }

  /**
   * Browse published collections — yours are flagged, not hidden.
   *
   * `q` searches game titles as well as collection names, which is how you
   * find "the Zelda games in order" without knowing it's called "Hyrule run";
   * `gameId` is the exact-match form a game's own page uses.
   */
  getPublicCollections(query: PublicCollectionQuery = {}): Promise<PublicCollectionPage> {
    const params = new URLSearchParams();
    for (const [key, value] of Object.entries(query)) {
      if (value !== undefined && value !== "") params.set(key, String(value));
    }
    const qs = params.toString();
    return this.request<PublicCollectionPage>(
      `/api/collections/public${qs ? `?${qs}` : ""}`,
    );
  }

  /** Take a private, independently editable copy of a public collection. */
  adoptCollection(id: string): Promise<{ id: string; name: string }> {
    return this.request(`/api/collections/${id}/adopt`, { method: "POST" });
  }

  /** Thumb a published collection: 1, -1, or 0 to take your vote back. */
  voteCollection(id: string, value: 1 | 0 | -1): Promise<VoteCounts> {
    return this.request<VoteCounts>(`/api/collections/${id}/vote`, {
      method: "PUT",
      body: JSON.stringify({ value }),
    });
  }

  deleteCollection(id: string): Promise<{ ok: true }> {
    return this.request(`/api/collections/${id}`, { method: "DELETE" });
  }

  getCollection(id: string): Promise<CollectionDetail> {
    return this.request<CollectionDetail>(`/api/collections/${id}`);
  }

  /**
   * Add a game to a collection. Pass `igdbId` for something not in the
   * catalog yet — a collection can list games you don't own, so this never
   * touches your library.
   */
  addCollectionGame(id: string, input: AddCollectionGameInput): Promise<{ ok: true; gameId: string }> {
    return this.request(`/api/collections/${id}/games`, {
      method: "POST",
      body: JSON.stringify(input),
    });
  }

  /**
   * Fill a collection from a pasted list of titles, one per line. Matching
   * happens server-side in the request — there is no job to poll — so expect
   * this to take a couple of seconds per title IGDB has to be asked about.
   */
  addCollectionGamesFromList(id: string, text: string): Promise<CollectionListImport> {
    return this.request<CollectionListImport>(`/api/collections/${id}/games/from-list`, {
      method: "POST",
      body: JSON.stringify({ text }),
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

  /**
   * Set the flat list order. Separate from the graph layout — the list is a
   * numbered run, the graph is branches. Games left out keep their place at
   * the end.
   */
  saveCollectionOrder(id: string, gameIds: string[]): Promise<{ ok: true; ordered: number }> {
    return this.request(`/api/collections/${id}/order`, {
      method: "PUT",
      body: JSON.stringify({ gameIds }),
    });
  }

  /** Add every game in a collection to your library, in one category. */
  addCollectionToLibrary(
    id: string,
    input: AddCollectionToLibraryInput,
  ): Promise<AddCollectionToLibraryResult> {
    return this.request(`/api/collections/${id}/add-to-library`, {
      method: "POST",
      body: JSON.stringify(input),
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

  /** Defaults to an extra list; 'missions' for the one timed main-story list. */
  createChecklist(
    gameId: string,
    title: string,
    kind: ChecklistKind = "side_quests",
  ): Promise<{ id: string }> {
    return this.request(`/api/games/${gameId}/checklists`, {
      method: "POST",
      body: JSON.stringify({ title, kind }),
    });
  }

  /** Rearrange your lists for a game; ids in the order you want them. */
  saveChecklistOrder(gameId: string, ids: string[]): Promise<{ ok: true; ordered: number }> {
    return this.request(`/api/games/${gameId}/checklists/order`, {
      method: "PUT",
      body: JSON.stringify({ ids }),
    });
  }

  // ---- mission lists + time remaining ----

  /** Create a list from pasted or generated entries. */
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

  /** Thumb a published list: 1, -1, or 0 to take your vote back. */
  voteChecklist(id: string, value: 1 | 0 | -1): Promise<VoteCounts> {
    return this.request<VoteCounts>(`/api/checklists/${id}/vote`, {
      method: "PUT",
      body: JSON.stringify({ value }),
    });
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

  /** Alternate covers for an entry, from SteamGridDB. */
  getCoverOptions(entryId: string): Promise<CoverOptions> {
    return this.request<CoverOptions>(`/api/library/${entryId}/covers`);
  }

  /** Set one of those covers; the server downloads it. */
  setCoverFromUrl(entryId: string, url: string): Promise<{ imageId: string; coverSrc: string }> {
    return this.request(`/api/library/${entryId}/cover/from-url`, {
      method: "POST",
      body: JSON.stringify({ url }),
    });
  }

  saveSteamGridDbApiKey(apiKey: string): Promise<{ ok: true }> {
    return this.request("/api/admin/settings/steamgriddb", {
      method: "PUT",
      body: JSON.stringify({ apiKey }),
    });
  }

  saveEmailSettings(apiKey: string, from?: string): Promise<{ ok: true }> {
    return this.request("/api/admin/settings/email", {
      method: "PUT",
      body: JSON.stringify({ apiKey, from }),
    });
  }

  testEmail(): Promise<{ ok: true }> {
    return this.request("/api/admin/settings/email/test", { method: "POST" });
  }

  // ---- categories ----

  /** Built-ins and your custom categories, resolved with counts. */
  getCategories(): Promise<CategoryView[]> {
    return this.request<CategoryView[]>("/api/categories");
  }

  createCategory(input: CategoryInput): Promise<{ id: string }> {
    return this.request("/api/categories", { method: "POST", body: JSON.stringify(input) });
  }

  updateCategory(id: string, input: Partial<CategoryInput>): Promise<{ ok: true }> {
    return this.request(`/api/categories/${id}`, {
      method: "PATCH",
      body: JSON.stringify(input),
    });
  }

  /** Games filed under it move to 'uncategorized' rather than vanishing. */
  deleteCategory(id: string): Promise<{ ok: true; movedToUncategorized: number }> {
    return this.request(`/api/categories/${id}`, { method: "DELETE" });
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

  /** Apps you've blocked from importing, or pinned to a particular game. */
  getSteamRules(): Promise<SteamImportRule[]> {
    return this.request<SteamImportRule[]>("/api/steam/rules");
  }

  saveSteamRule(
    input: SteamImportRuleInput,
  ): Promise<{ ok: true; gameId: string | null; replacedWithEntryId: string | null }> {
    return this.request("/api/steam/rules", { method: "POST", body: JSON.stringify(input) });
  }

  deleteSteamRule(steamAppId: number): Promise<{ ok: true }> {
    return this.request(`/api/steam/rules/${steamAppId}`, { method: "DELETE" });
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

  /** Funnel, DAU and engagement aggregates for the admin analytics page. */
  getAdminAnalytics(): Promise<AdminAnalyticsOverview> {
    return this.request<AdminAnalyticsOverview>("/api/admin/analytics/overview");
  }

  /** The account list behind the analytics page's Users tab. Read-only. */
  getAdminUsers(query: AdminUserQuery = {}): Promise<AdminUserPage> {
    return this.request<AdminUserPage>(`/api/admin/users${ApiClient.queryString(query)}`);
  }

  // ---- feedback ----

  /** File a bug report, feature request or opinion. */
  submitFeedback(input: FeedbackSubmission): Promise<{ id: string }> {
    return this.request("/api/feedback", {
      method: "POST",
      body: JSON.stringify(input),
    });
  }

  /** Your own reports and where they've got to. Admin notes are withheld. */
  getMyFeedback(): Promise<FeedbackItem[]> {
    return this.request<FeedbackItem[]>("/api/feedback/mine");
  }

  /** Admin queue: filtered, sorted, with counts across everything. */
  getAdminFeedback(query: AdminFeedbackQuery = {}): Promise<AdminFeedbackPage> {
    return this.request<AdminFeedbackPage>(
      `/api/admin/feedback${ApiClient.queryString(query)}`,
    );
  }

  updateFeedback(id: string, input: FeedbackTriageInput): Promise<{ ok: true }> {
    return this.request(`/api/admin/feedback/${id}`, {
      method: "PATCH",
      body: JSON.stringify(input),
    });
  }

  deleteFeedback(id: string): Promise<{ ok: true }> {
    return this.request(`/api/admin/feedback/${id}`, { method: "DELETE" });
  }

  /**
   * URL for the CSV export of a filtered queue.
   *
   * A URL rather than a fetch: the browser has to do the downloading for the
   * file to land in Downloads with its filename intact, and the session
   * cookie rides along on a same-origin link on its own.
   */
  feedbackExportUrl(query: AdminFeedbackQuery = {}): string {
    return `${this.opts.baseUrl}/api/admin/feedback/export.csv${ApiClient.queryString(query)}`;
  }

  /**
   * Filter objects → query string, dropping empties. "" has to go as well as
   * undefined: the admin filter selects use "" for "no filter", and sending
   * `?status=` would fail the enum on the server rather than be ignored.
   */
  private static queryString(query: object): string {
    const params = new URLSearchParams();
    for (const [key, value] of Object.entries(query)) {
      if (value !== undefined && value !== null && value !== "") params.set(key, String(value));
    }
    const qs = params.toString();
    return qs ? `?${qs}` : "";
  }
}

export type { Health, User, LibraryEntry, Platform, SearchResponse };
