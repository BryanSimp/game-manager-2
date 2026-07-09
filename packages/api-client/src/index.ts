import type {
  AddGameInput,
  AdminSettings,
  BulkAddItem,
  BulkAddResult,
  Health,
  LibraryEntry,
  OwnershipFormat,
  Platform,
  SearchResponse,
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
    if (init.body != null && !headers.has("content-type")) {
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
