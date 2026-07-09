import type {
  AddGameInput,
  AdminSettings,
  BulkAddItem,
  BulkAddResult,
  DashboardData,
  Health,
  LibraryEntry,
  OwnershipFormat,
  Platform,
  Preferences,
  SearchResponse,
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

  bulkAdd(items: BulkAddItem[]): Promise<BulkAddResult> {
    return this.request("/api/library/bulk", {
      method: "POST",
      body: JSON.stringify({ items }),
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
