import { useMemo, useState } from "react";
import { Link } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { GAME_STATUSES, type BulkUpdateInput, type GameStatus, type LibraryEntry } from "@gm/shared";
import { api } from "../lib/api.js";
import { Shell } from "../components/Shell.js";
import { GameCard } from "../components/GameCard.js";
import { STATUS_META, statusChip } from "../lib/format.js";
import { usePreferences } from "../lib/prefs.js";

type SortKey = "title" | "rating" | "release" | "added" | "ttb" | "estimated";

const SORTS: Array<{ key: SortKey; label: string }> = [
  { key: "title", label: "Title A–Z" },
  { key: "rating", label: "Highest rated" },
  { key: "release", label: "Newest release" },
  { key: "added", label: "Recently added" },
  { key: "ttb", label: "Shortest first" },
  { key: "estimated", label: "Estimated shortest" },
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
    case "estimated":
      // games you've part-finished float up; anything without a mission list
      // has no estimate and sinks, rather than pretending to be 0h
      return list.sort(
        (a, b) =>
          (a.estimatedRemainingSeconds ?? Number.MAX_SAFE_INTEGER) -
          (b.estimatedRemainingSeconds ?? Number.MAX_SAFE_INTEGER),
      );
  }
}

export function LibraryPage() {
  const prefs = usePreferences();
  const queryClient = useQueryClient();
  const [statusFilter, setStatusFilter] = useState<GameStatus | "all">("all");
  const [only100, setOnly100] = useState(false);
  const [platformFilter, setPlatformFilter] = useState<string>("all");
  const [tagFilter, setTagFilter] = useState<string>("all");
  const [sort, setSort] = useState<SortKey>("title");
  const [search, setSearch] = useState("");
  const [selectMode, setSelectMode] = useState(false);
  const [selected, setSelected] = useState<Set<string>>(new Set());

  const library = useQuery({ queryKey: ["library"], queryFn: () => api.getLibrary() });

  const bulkUpdate = useMutation({
    mutationFn: (patch: Omit<BulkUpdateInput, "ids">) =>
      api.bulkUpdateEntries({ ids: [...selected], ...patch }),
    onSuccess: () => {
      setSelected(new Set());
      queryClient.invalidateQueries({ queryKey: ["library"] });
      queryClient.invalidateQueries({ queryKey: ["dashboard"] });
      queryClient.invalidateQueries({ queryKey: ["shelf"] });
    },
  });

  function toggleSelected(id: string) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

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
      if (statusFilter === "finished" && only100 && !e.completed100) return false;
      if (platformFilter !== "all" && !e.platforms.some((p) => p.platformId === platformFilter))
        return false;
      if (tagFilter !== "all" && !e.tags.some((t) => t.id === tagFilter)) return false;
      if (search && !e.game.title.toLowerCase().includes(search.toLowerCase())) return false;
      return true;
    });
    return sortEntries(filtered, sort);
  }, [library.data, statusFilter, only100, platformFilter, tagFilter, search, sort]);

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
        <button
          onClick={() => {
            setSelectMode(!selectMode);
            setSelected(new Set());
          }}
          className={`rounded-lg border px-3 py-1.5 text-sm font-medium transition ${
            selectMode
              ? "border-indigo-500 bg-indigo-600/20 text-indigo-200"
              : "border-zinc-700 text-zinc-300 hover:bg-zinc-800"
          }`}
        >
          {selectMode ? "Done selecting" : "Select"}
        </button>
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
            <span key={s} className="inline-flex items-center gap-1">
              <button
                onClick={() => {
                  setStatusFilter(statusFilter === s ? "all" : s);
                  setOnly100(false);
                }}
                className={`rounded-full border px-3 py-1 text-sm font-medium transition ${
                  statusFilter === s
                    ? chip.className
                    : "border-zinc-700 text-zinc-400 hover:border-zinc-500 hover:text-zinc-200"
                }`}
                style={statusFilter === s ? chip.style : undefined}
              >
                {STATUS_META[s].label} ({counts.get(s) ?? 0})
              </button>
              {s === "finished" && statusFilter === "finished" && (
                <button
                  onClick={() => setOnly100(!only100)}
                  title="Only games marked 100% completed"
                  className={`rounded-full border px-2.5 py-1 text-sm font-medium transition ${
                    only100
                      ? "border-amber-500 bg-amber-950 text-amber-300"
                      : "border-zinc-700 text-zinc-400 hover:border-zinc-500 hover:text-zinc-200"
                  }`}
                >
                  💯 ({(library.data ?? []).filter((e) => e.status === "finished" && e.completed100).length})
                </button>
              )}
            </span>
          );
        })}
      </div>

      {selectMode && (
        <div className="mb-6 flex flex-wrap items-center gap-2 rounded-xl border border-indigo-900 bg-indigo-950/40 px-4 py-3">
          <span className="text-sm font-semibold text-indigo-200">
            {selected.size} selected
          </span>
          <button
            onClick={() => setSelected(new Set(entries.map((e) => e.id)))}
            className="rounded-lg border border-zinc-700 px-2.5 py-1 text-xs text-zinc-300 hover:bg-zinc-800"
          >
            Select all shown
          </button>
          <button
            onClick={() => setSelected(new Set())}
            className="rounded-lg border border-zinc-700 px-2.5 py-1 text-xs text-zinc-300 hover:bg-zinc-800"
          >
            Clear
          </button>
          <span className="mx-1 h-5 w-px bg-zinc-700" />
          <span className="text-xs text-zinc-400">Set status:</span>
          {GAME_STATUSES.map((s) => (
            <button
              key={s}
              disabled={selected.size === 0 || bulkUpdate.isPending}
              onClick={() => bulkUpdate.mutate({ status: s })}
              className="rounded-full border border-zinc-700 px-2.5 py-1 text-xs font-medium text-zinc-300 hover:border-zinc-500 hover:text-white disabled:opacity-40"
            >
              {STATUS_META[s].label}
            </button>
          ))}
          <span className="mx-1 h-5 w-px bg-zinc-700" />
          <button
            disabled={selected.size === 0 || bulkUpdate.isPending}
            onClick={() => bulkUpdate.mutate({ ttbEnabled: false })}
            title="Exclude from backlog-time math (multiplayer / endless games)"
            className="rounded-lg border border-zinc-700 px-2.5 py-1 text-xs text-zinc-300 hover:border-zinc-500 hover:text-white disabled:opacity-40"
          >
            ∞ Mark endless
          </button>
          <button
            disabled={selected.size === 0 || bulkUpdate.isPending}
            onClick={() => bulkUpdate.mutate({ completed100: true })}
            className="rounded-lg border border-zinc-700 px-2.5 py-1 text-xs text-zinc-300 hover:border-zinc-500 hover:text-white disabled:opacity-40"
          >
            💯 Mark 100%
          </button>
          {bulkUpdate.isPending && <span className="text-xs text-zinc-400">Saving…</span>}
        </div>
      )}

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
          <GameCard
            key={entry.id}
            entry={entry}
            selectable={selectMode}
            selected={selected.has(entry.id)}
            onToggleSelect={() => toggleSelected(entry.id)}
          />
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
