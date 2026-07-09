import { useMemo, useState } from "react";
import { Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { GAME_STATUSES, type GameStatus, type LibraryEntry } from "@gm/shared";
import { api } from "../lib/api.js";
import { Shell } from "../components/Shell.js";
import { GameCard } from "../components/GameCard.js";
import { STATUS_META, statusChip } from "../lib/format.js";
import { usePreferences } from "../lib/prefs.js";

type SortKey = "title" | "rating" | "release" | "added" | "ttb";

const SORTS: Array<{ key: SortKey; label: string }> = [
  { key: "title", label: "Title A–Z" },
  { key: "rating", label: "Highest rated" },
  { key: "release", label: "Newest release" },
  { key: "added", label: "Recently added" },
  { key: "ttb", label: "Shortest first" },
];

function sortEntries(entries: LibraryEntry[], sort: SortKey): LibraryEntry[] {
  const list = [...entries];
  switch (sort) {
    case "title":
      return list.sort((a, b) => a.game.title.localeCompare(b.game.title));
    case "rating":
      return list.sort((a, b) => (b.rating ?? -1) - (a.rating ?? -1));
    case "release":
      return list.sort((a, b) => (b.game.releaseDate ?? "").localeCompare(a.game.releaseDate ?? ""));
    case "added":
      return list.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
    case "ttb":
      return list.sort(
        (a, b) => (a.game.ttbMain ?? Number.MAX_SAFE_INTEGER) - (b.game.ttbMain ?? Number.MAX_SAFE_INTEGER),
      );
  }
}

export function LibraryPage() {
  const prefs = usePreferences();
  const [statusFilter, setStatusFilter] = useState<GameStatus | "all">("all");
  const [platformFilter, setPlatformFilter] = useState<string>("all");
  const [tagFilter, setTagFilter] = useState<string>("all");
  const [sort, setSort] = useState<SortKey>("title");
  const [search, setSearch] = useState("");

  const library = useQuery({ queryKey: ["library"], queryFn: () => api.getLibrary() });

  // filter options derived from what's actually in the library
  const { platformOptions, tagOptions } = useMemo(() => {
    const platforms = new Map<string, string>();
    const tags = new Map<string, string>();
    for (const e of library.data ?? []) {
      for (const p of e.platforms) platforms.set(p.platformId, p.abbreviation ?? p.name);
      for (const t of e.tags) tags.set(t.id, t.name);
    }
    return {
      platformOptions: [...platforms.entries()].sort((a, b) => a[1].localeCompare(b[1])),
      tagOptions: [...tags.entries()].sort((a, b) => a[1].localeCompare(b[1])),
    };
  }, [library.data]);

  const entries = useMemo(() => {
    const filtered = (library.data ?? []).filter((e) => {
      if (statusFilter !== "all" && e.status !== statusFilter) return false;
      if (platformFilter !== "all" && !e.platforms.some((p) => p.platformId === platformFilter))
        return false;
      if (tagFilter !== "all" && !e.tags.some((t) => t.id === tagFilter)) return false;
      if (search && !e.game.title.toLowerCase().includes(search.toLowerCase())) return false;
      return true;
    });
    return sortEntries(filtered, sort);
  }, [library.data, statusFilter, platformFilter, tagFilter, search, sort]);

  const counts = new Map<string, number>();
  for (const e of library.data ?? []) {
    counts.set(e.status, (counts.get(e.status) ?? 0) + 1);
  }

  return (
    <Shell>
      <div className="mb-5 flex flex-wrap items-center gap-2">
        <h1 className="mr-auto text-xl font-bold">
          Library{" "}
          <span className="text-sm font-normal text-zinc-500">
            {entries.length === library.data?.length
              ? `${library.data?.length ?? 0} games`
              : `${entries.length} of ${library.data?.length ?? 0}`}
          </span>
        </h1>
        <input
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Filter by title…"
          className="w-44 rounded-lg border border-zinc-700 bg-zinc-800 px-3 py-1.5 text-sm outline-none focus:border-indigo-500"
        />
        {platformOptions.length > 0 && (
          <select
            value={platformFilter}
            onChange={(e) => setPlatformFilter(e.target.value)}
            className="rounded-lg border border-zinc-700 bg-zinc-800 px-2 py-1.5 text-sm"
          >
            <option value="all">All platforms</option>
            {platformOptions.map(([id, name]) => (
              <option key={id} value={id}>
                {name}
              </option>
            ))}
          </select>
        )}
        {tagOptions.length > 0 && (
          <select
            value={tagFilter}
            onChange={(e) => setTagFilter(e.target.value)}
            className="rounded-lg border border-zinc-700 bg-zinc-800 px-2 py-1.5 text-sm"
          >
            <option value="all">All tags</option>
            {tagOptions.map(([id, name]) => (
              <option key={id} value={id}>
                {name}
              </option>
            ))}
          </select>
        )}
        <select
          value={sort}
          onChange={(e) => setSort(e.target.value as SortKey)}
          className="rounded-lg border border-zinc-700 bg-zinc-800 px-2 py-1.5 text-sm"
        >
          {SORTS.map((s) => (
            <option key={s.key} value={s.key}>
              {s.label}
            </option>
          ))}
        </select>
      </div>

      <div className="mb-6 flex flex-wrap gap-2">
        <FilterChip
          label={`All (${library.data?.length ?? 0})`}
          active={statusFilter === "all"}
          onClick={() => setStatusFilter("all")}
        />
        {GAME_STATUSES.map((s) => {
          const chip = statusChip(s, prefs);
          return (
            <button
              key={s}
              onClick={() => setStatusFilter(statusFilter === s ? "all" : s)}
              className={`rounded-full border px-3 py-1 text-sm font-medium transition ${
                statusFilter === s
                  ? chip.className
                  : "border-zinc-700 text-zinc-400 hover:border-zinc-500 hover:text-zinc-200"
              }`}
              style={statusFilter === s ? chip.style : undefined}
            >
              {STATUS_META[s].label} ({counts.get(s) ?? 0})
            </button>
          );
        })}
      </div>

      {library.isLoading && <p className="text-zinc-500">Loading library…</p>}

      {library.data?.length === 0 && (
        <div className="rounded-2xl border border-dashed border-zinc-700 p-12 text-center">
          <p className="mb-2 text-lg font-semibold">Your library is empty</p>
          <p className="mb-6 text-sm text-zinc-400">
            Add your first game by searching, or paste your whole list at once.
          </p>
          <div className="flex justify-center gap-3">
            <Link
              to="/add"
              className="rounded-lg bg-indigo-600 px-4 py-2 text-sm font-semibold hover:bg-indigo-500"
            >
              Add a game
            </Link>
            <Link
              to="/import"
              className="rounded-lg border border-zinc-700 px-4 py-2 text-sm font-semibold hover:bg-zinc-800"
            >
              Import a list
            </Link>
          </div>
        </div>
      )}

      <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5">
        {entries.map((entry) => (
          <GameCard key={entry.id} entry={entry} />
        ))}
      </div>

      {library.data && library.data.length > 0 && entries.length === 0 && (
        <p className="text-zinc-500">No games match these filters.</p>
      )}
    </Shell>
  );
}

function FilterChip({
  label,
  active,
  onClick,
}: {
  label: string;
  active: boolean;
  onClick: () => void;
}) {
  return (
    <button
      onClick={onClick}
      className={`rounded-full border px-3 py-1 text-sm transition ${
        active
          ? "border-indigo-500 bg-indigo-600/20 text-indigo-200"
          : "border-zinc-700 text-zinc-400 hover:border-zinc-500 hover:text-zinc-200"
      }`}
    >
      {label}
    </button>
  );
}
