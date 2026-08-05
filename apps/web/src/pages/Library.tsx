import { useMemo, useState } from "react";
import { Link } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { BulkUpdateInput, LibraryEntry, OwnershipFormat } from "@gm/shared";
import { api } from "../lib/api.js";
import { Shell } from "../components/Shell.js";
import { GameCard } from "../components/GameCard.js";
import { ConsoleSelect } from "../components/ConsolePicker.js";
import { statusChip, statusLabel } from "../lib/format.js";
import { useCategories } from "../lib/categories.js";
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

/**
 * Covers per row, keyed by the preference. Tailwind only ships the classes it
 * can see in the source, so these are whole literal strings rather than
 * `grid-cols-${n}` built at runtime. Narrow screens keep their own counts —
 * eight covers on a phone is a wall of thumbnails — so the setting is the
 * widest step, and 1 and 2 apply everywhere because that's the whole point of
 * picking them.
 */
const COLUMN_CLASSES: Record<number, string> = {
  1: "grid-cols-1",
  2: "grid-cols-2",
  3: "grid-cols-2 sm:grid-cols-3",
  4: "grid-cols-2 sm:grid-cols-3 md:grid-cols-4",
  5: "grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5",
  6: "grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-6",
  7: "grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-7",
  8: "grid-cols-2 sm:grid-cols-3 md:grid-cols-5 lg:grid-cols-8",
};

const COLUMN_CHOICES = [1, 2, 3, 4, 5, 6, 7, 8];

/**
 * Covers are 3:4, so a one-per-row grid across the whole page would draw a
 * poster rather than a card. Below five, the grid is capped at what the cards
 * would have been anyway and simply stops early; five and up it's wider than
 * the page and does nothing.
 */
const MAX_CARD_PX = 260;
const GRID_GAP_PX = 16;

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
  const categories = useCategories();
  const queryClient = useQueryClient();
  const [statusFilter, setStatusFilter] = useState<string>("all");
  const [only100, setOnly100] = useState(false);
  const [platformFilter, setPlatformFilter] = useState<string>("all");
  const [tagFilter, setTagFilter] = useState<string>("all");
  const [sort, setSort] = useState<SortKey>("title");
  const [search, setSearch] = useState("");
  const [selectMode, setSelectMode] = useState(false);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [bulkPlatform, setBulkPlatform] = useState<string | null>(null);
  const [bulkFormat, setBulkFormat] = useState<OwnershipFormat>("digital");
  // null until you change it, so the saved preference shows through once it loads
  const [columnDraft, setColumnDraft] = useState<number | null>(null);
  const columns = columnDraft ?? prefs?.libraryColumns ?? 5;

  const library = useQuery({ queryKey: ["library"], queryFn: () => api.getLibrary() });

  const saveColumns = useMutation({
    mutationFn: (libraryColumns: number) => api.savePreferences({ libraryColumns }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["preferences"] }),
  });

  const bulkUpdate = useMutation({
    mutationFn: (patch: Omit<BulkUpdateInput, "ids">) =>
      api.bulkUpdateEntries({ ids: [...selected], ...patch }),
    onSuccess: () => {
      setSelected(new Set());
      queryClient.invalidateQueries({ queryKey: ["library"] });
      queryClient.invalidateQueries({ queryKey: ["dashboard"] });
      queryClient.invalidateQueries({ queryKey: ["consoles"] });
      queryClient.invalidateQueries({ queryKey: ["platforms"] });
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

  // Filter options derived from what's actually in the library. Storefronts
  // are listed under the platform they belong to, and picking the parent (PC)
  // matches its stores too — a Steam game is a PC game.
  const { platformOptions, tagOptions } = useMemo(() => {
    const parents = new Map<string, { label: string; children: Map<string, string> }>();
    const tags = new Map<string, string>();
    for (const e of library.data ?? []) {
      for (const p of e.platforms) {
        if (p.parentPlatformId && p.parentName) {
          const parent = parents.get(p.parentPlatformId) ?? {
            label: p.parentName,
            children: new Map(),
          };
          parent.children.set(p.platformId, p.name);
          parents.set(p.parentPlatformId, parent);
        } else {
          const existing = parents.get(p.platformId);
          parents.set(p.platformId, {
            label: p.abbreviation ?? p.name,
            children: existing?.children ?? new Map(),
          });
        }
      }
      for (const t of e.tags) tags.set(t.id, t.name);
    }
    const options: Array<[string, string]> = [];
    for (const [id, parent] of [...parents.entries()].sort((a, b) =>
      a[1].label.localeCompare(b[1].label),
    )) {
      options.push([id, parent.children.size > 0 ? `${parent.label} (all)` : parent.label]);
      for (const [childId, name] of [...parent.children.entries()].sort((a, b) =>
        a[1].localeCompare(b[1]),
      )) {
        options.push([childId, `   ↳ ${name}`]);
      }
    }
    return {
      platformOptions: options,
      tagOptions: [...tags.entries()].sort((a, b) => a[1].localeCompare(b[1])),
    };
  }, [library.data]);

  const entries = useMemo(() => {
    const filtered = (library.data ?? []).filter((e) => {
      if (statusFilter !== "all" && e.status !== statusFilter) return false;
      if (statusFilter === "finished" && only100 && !e.completed100) return false;
      // a parent platform matches its storefronts as well as itself
      if (
        platformFilter !== "all" &&
        !e.platforms.some(
          (p) => p.platformId === platformFilter || p.parentPlatformId === platformFilter,
        )
      )
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
        <select
          value={columns}
          onChange={(e) => {
            const next = Number(e.target.value);
            setColumnDraft(next);
            saveColumns.mutate(next);
          }}
          title="How many covers fit on a row"
          className="rounded-lg border border-zinc-700 bg-zinc-800 px-2 py-1.5 text-sm"
        >
          {COLUMN_CHOICES.map((n) => (
            <option key={n} value={n}>
              {n} per row
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
        {(categories ?? [])
          // an empty category is nothing to filter by — but keep the one
          // you're currently filtering by, so you can always click back out
          .filter((cat) => (counts.get(cat.key) ?? 0) > 0 || statusFilter === cat.key)
          .map((cat) => {
          const s = cat.key;
          const chip = statusChip(s, prefs, categories);
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
                {cat.label} ({counts.get(s) ?? 0})
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
          {(categories ?? []).map(({ key: s }) => (
            <button
              key={s}
              disabled={selected.size === 0 || bulkUpdate.isPending}
              onClick={() => bulkUpdate.mutate({ status: s })}
              className="rounded-full border border-zinc-700 px-2.5 py-1 text-xs font-medium text-zinc-300 hover:border-zinc-500 hover:text-white disabled:opacity-40"
            >
              {statusLabel(s, categories)}
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

          <div className="flex w-full flex-wrap items-center gap-2 border-t border-indigo-900/60 pt-3">
            <span className="text-xs text-zinc-400">Platform:</span>
            <ConsoleSelect
              value={bulkPlatform}
              onChange={setBulkPlatform}
              placeholder="Pick a console…"
            />
            <button
              onClick={() => setBulkFormat(bulkFormat === "digital" ? "physical" : "digital")}
              title="Toggle physical/digital"
              className="rounded-lg border border-zinc-700 px-2.5 py-1 text-xs text-zinc-300 hover:border-zinc-500 hover:text-white"
            >
              {bulkFormat === "physical" ? "📦 Physical" : "💾 Digital"}
            </button>
            {(
              [
                { mode: "add", label: "Add to platform", hint: "Keep any platforms they already have" },
                { mode: "replace", label: "Set as only platform", hint: "Replace every platform on these games" },
                { mode: "remove", label: "Remove platform", hint: "Take this platform off these games" },
              ] as const
            ).map((action) => (
              <button
                key={action.mode}
                disabled={selected.size === 0 || !bulkPlatform || bulkUpdate.isPending}
                title={action.hint}
                onClick={() =>
                  bulkUpdate.mutate({
                    platforms: [{ platformId: bulkPlatform!, format: bulkFormat }],
                    platformMode: action.mode,
                  })
                }
                className="rounded-lg border border-zinc-700 px-2.5 py-1 text-xs text-zinc-300 hover:border-zinc-500 hover:text-white disabled:opacity-40"
              >
                {action.label}
              </button>
            ))}
          </div>
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

      <div
        className={`grid gap-4 ${COLUMN_CLASSES[columns] ?? COLUMN_CLASSES[5]}`}
        style={{ maxWidth: columns * MAX_CARD_PX + (columns - 1) * GRID_GAP_PX }}
      >
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
