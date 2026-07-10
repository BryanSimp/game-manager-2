import { useMemo, useRef, useState } from "react";
import { Link } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { PlatformFamily, ShelfEntry, ShelfRow } from "@gm/shared";
import { api } from "../lib/api.js";
import { Shell } from "../components/Shell.js";

type SortMode = "custom" | "title" | "release" | "rating";

/** Real-world console case colors — the physical boxes wear them. */
const FAMILY_CASE: Record<PlatformFamily, { color: string; label: string }> = {
  nintendo: { color: "#e60012", label: "Nintendo" },
  sony: { color: "#0070d1", label: "PlayStation" },
  xbox: { color: "#107c10", label: "Xbox" },
  pc: { color: "#4b5563", label: "PC" },
  sega: { color: "#0060a8", label: "Sega" },
  other: { color: "#52525b", label: "Other" },
};

function sortEntries(entries: ShelfEntry[], mode: SortMode): ShelfEntry[] {
  const list = [...entries];
  switch (mode) {
    case "custom":
      return list.sort((a, b) => a.position - b.position || a.title.localeCompare(b.title));
    case "title":
      return list.sort((a, b) => a.title.localeCompare(b.title));
    case "release":
      return list.sort((a, b) => (a.releaseDate ?? "9999").localeCompare(b.releaseDate ?? "9999"));
    case "rating":
      return list.sort((a, b) => (b.rating ?? -1) - (a.rating ?? -1));
  }
}

export function ShelfPage() {
  const queryClient = useQueryClient();
  const [sortMode, setSortMode] = useState<SortMode>("custom");
  const shelf = useQuery({ queryKey: ["shelf"], queryFn: () => api.getShelf() });

  const saveOrder = useMutation({
    mutationFn: ({ platformId, ids }: { platformId: string; ids: string[] }) =>
      api.setShelfOrder(platformId, ids),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["shelf"] }),
  });

  const shelves = shelf.data ?? [];

  return (
    <Shell>
      <div className="mb-6 flex flex-wrap items-center gap-3">
        <h1 className="mr-auto text-xl font-bold">
          Shelf{" "}
          <span className="text-sm font-normal text-zinc-500">
            {shelves.reduce((acc, s) => acc + s.entries.length, 0)} copies across{" "}
            {shelves.length} consoles
          </span>
        </h1>
        <label className="flex items-center gap-2 text-sm text-zinc-400">
          Sort
          <select
            value={sortMode}
            onChange={(e) => setSortMode(e.target.value as SortMode)}
            className="rounded-lg border border-zinc-700 bg-zinc-800 px-2 py-1.5 text-sm text-zinc-200"
          >
            <option value="custom">Custom (drag to arrange)</option>
            <option value="title">Title A–Z</option>
            <option value="release">Release date</option>
            <option value="rating">Highest rated</option>
          </select>
        </label>
      </div>

      {shelf.isLoading && <p className="text-zinc-500">Loading shelf…</p>}

      {shelves.length === 0 && !shelf.isLoading && (
        <div className="rounded-2xl border border-dashed border-zinc-700 p-12 text-center">
          <p className="mb-2 text-lg font-semibold">Your shelf is empty</p>
          <p className="text-sm text-zinc-400">
            Mark which platforms you own games on (open a game → "Owned on") and they appear
            here as boxes on your consoles' shelves.
          </p>
        </div>
      )}

      <div className="space-y-8">
        {shelves.map((row) => (
          <ShelfRowView
            key={row.platform.id}
            row={row}
            sortMode={sortMode}
            onReorder={(ids) => saveOrder.mutate({ platformId: row.platform.id, ids })}
          />
        ))}
      </div>
    </Shell>
  );
}

function ShelfRowView({
  row,
  sortMode,
  onReorder,
}: {
  row: ShelfRow;
  sortMode: SortMode;
  onReorder: (orderedUserGameIds: string[]) => void;
}) {
  const caseStyle = FAMILY_CASE[row.platform.family];
  const [localOrder, setLocalOrder] = useState<string[] | null>(null);
  const dragId = useRef<string | null>(null);

  const entries = useMemo(() => {
    const sorted = sortEntries(row.entries, sortMode);
    if (sortMode === "custom" && localOrder) {
      const byId = new Map(sorted.map((e) => [e.userGameId, e]));
      const ordered = localOrder
        .map((id) => byId.get(id))
        .filter((e): e is ShelfEntry => !!e);
      const missing = sorted.filter((e) => !localOrder.includes(e.userGameId));
      return [...ordered, ...missing];
    }
    return sorted;
  }, [row.entries, sortMode, localOrder]);

  function handleDrop(targetId: string) {
    const sourceId = dragId.current;
    dragId.current = null;
    if (!sourceId || sourceId === targetId) return;
    const ids = entries.map((e) => e.userGameId);
    const from = ids.indexOf(sourceId);
    const to = ids.indexOf(targetId);
    if (from === -1 || to === -1) return;
    ids.splice(to, 0, ids.splice(from, 1)[0]!);
    setLocalOrder(ids);
    onReorder(ids);
  }

  return (
    <section>
      <div className="mb-2 flex items-baseline gap-3">
        <span
          className="rounded px-2 py-0.5 text-xs font-bold uppercase tracking-wide text-white"
          style={{ backgroundColor: caseStyle.color }}
        >
          {row.platform.abbreviation ?? row.platform.name}
        </span>
        <h2 className="font-semibold">{row.platform.name}</h2>
        <span className="text-sm text-zinc-500">{row.entries.length} games</span>
      </div>

      <div
        className="flex gap-3 overflow-x-auto rounded-xl border border-zinc-800 bg-gradient-to-b from-zinc-900 to-zinc-950 p-4 pb-2"
        style={{ boxShadow: "inset 0 -14px 18px -14px rgba(0,0,0,0.9)" }}
      >
        {entries.map((entry) => (
          <GameBox
            key={`${entry.userGameId}-${entry.format}`}
            entry={entry}
            caseColor={caseStyle.color}
            draggable={sortMode === "custom"}
            onDragStart={() => (dragId.current = entry.userGameId)}
            onDrop={() => handleDrop(entry.userGameId)}
          />
        ))}
        {/* shelf plank */}
      </div>
      <div
        className="h-2 rounded-b-lg"
        style={{
          background: "linear-gradient(180deg, #3f3f46 0%, #27272a 100%)",
          boxShadow: "0 4px 8px rgba(0,0,0,0.6)",
        }}
      />
    </section>
  );
}

function GameBox({
  entry,
  caseColor,
  draggable,
  onDragStart,
  onDrop,
}: {
  entry: ShelfEntry;
  caseColor: string;
  draggable: boolean;
  onDragStart: () => void;
  onDrop: () => void;
}) {
  const physical = entry.format === "physical";
  return (
    <Link
      to="/game/$id"
      params={{ id: entry.userGameId }}
      draggable={draggable}
      onDragStart={(e) => {
        e.dataTransfer.effectAllowed = "move";
        onDragStart();
      }}
      onDragOver={(e) => e.preventDefault()}
      onDrop={(e) => {
        e.preventDefault();
        onDrop();
      }}
      title={`${entry.title} (${physical ? "physical" : "digital"})`}
      className={`group w-24 flex-none select-none ${draggable ? "cursor-grab active:cursor-grabbing" : ""}`}
    >
      <div
        className={`relative aspect-[3/4] overflow-hidden bg-zinc-800 transition group-hover:-translate-y-1 ${
          physical ? "rounded-r-md rounded-l-sm" : "rounded-lg opacity-90"
        }`}
        style={
          physical
            ? {
                borderLeft: `6px solid ${caseColor}`,
                boxShadow: "2px 3px 6px rgba(0,0,0,0.55), inset -1px 0 2px rgba(255,255,255,0.08)",
              }
            : { boxShadow: "0 2px 4px rgba(0,0,0,0.4)" }
        }
      >
        {entry.coverSrc ? (
          <img
            src={entry.coverSrc}
            alt={entry.title}
            loading="lazy"
            className="h-full w-full object-cover"
          />
        ) : (
          <div className="flex h-full items-center justify-center p-1.5 text-center text-[10px] font-semibold text-zinc-400">
            {entry.title}
          </div>
        )}
        {!physical && (
          <span className="absolute bottom-1 right-1 rounded bg-black/70 px-1 text-[10px]">💾</span>
        )}
        {entry.status === "finished" && (
          <span className="absolute left-1 top-1 rounded bg-black/70 px-1 text-[10px]">✓</span>
        )}
      </div>
      <p className="mt-1 truncate text-center text-[11px] text-zinc-400 group-hover:text-zinc-200">
        {entry.title}
      </p>
    </Link>
  );
}
